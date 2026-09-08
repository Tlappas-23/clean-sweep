"""
Persistence tests (``tests.test_storage``).

Two things are checked here that the rest of the suite takes for granted.

**Retention.** Every visitor is anonymous and creates a row by pressing Play,
so the tables only grow. The sweep is what stops a half-gigabyte free tier
filling with abandoned rounds, and it has one rule that must never break: a
submitted score is kept forever.

**Portability.** The app runs on SQLite locally and Postgres in production,
which means the code is only ever exercised against one of them at a time.
The URL handling is pinned here, and the schema round trip runs against a real
Postgres whenever ``CLEAN_SWEEP_TEST_POSTGRES`` names one.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core.db import Database, GameRow, LeaderboardRow, SideGameRow, normalise_url, utcnow


def _fresh(tmp_path) -> Database:
    db = Database(f"sqlite:///{tmp_path / 'sweep.db'}")
    db.create_tables()
    return db


def _game(db: Database, game_id: str, *, age_days: float) -> None:
    with db.session() as session:
        session.add(
            GameRow(
                id=game_id,
                mode="classic",
                seed=None,
                state_json=json.dumps({"id": game_id}),
                created_at=utcnow() - timedelta(days=age_days),
            )
        )


def _side_game(db: Database, game_id: str, kind: str, *, age_days: float) -> None:
    with db.session() as session:
        session.add(
            SideGameRow(
                id=game_id,
                kind=kind,
                seed=None,
                state_json=json.dumps({"id": game_id}),
                created_at=utcnow() - timedelta(days=age_days),
            )
        )


# --- URL handling ------------------------------------------------------------
@pytest.mark.parametrize(
    ("given", "want"),
    [
        # What Render and Neon actually print. SQLAlchemy 2 rejects the first
        # outright, so accepting it is the difference between "paste the
        # connection string" and a confusing failure on first boot.
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite:///./local.db", "sqlite:///./local.db"),
    ],
)
def test_provider_connection_strings_are_accepted_as_given(given: str, want: str):
    assert normalise_url(given) == want


def test_a_query_string_survives_normalisation():
    """Neon requires ``sslmode=require``; dropping it would break the connection."""
    got = normalise_url("postgres://u:p@host/db?sslmode=require")
    assert got.endswith("/db?sslmode=require")
    assert got.startswith("postgresql+psycopg://")


# --- retention ---------------------------------------------------------------
def test_the_sweep_removes_abandoned_rounds(tmp_path):
    db = _fresh(tmp_path)
    _game(db, "old", age_days=30)
    _game(db, "new", age_days=1)
    _side_game(db, "old-chain", "chain", age_days=30)
    _side_game(db, "new-chain", "chain", age_days=1)

    removed = db.sweep(days=14)
    assert removed == {"games": 1, "side_games": 1}

    with db.session() as session:
        assert session.get(GameRow, "old") is None
        assert session.get(GameRow, "new") is not None
        assert session.get(SideGameRow, "old-chain") is None
        assert session.get(SideGameRow, "new-chain") is not None


def test_a_submitted_score_is_never_swept(tmp_path):
    """
    The one thing here that is meant to last.

    Deleting it would also break the foreign key, so this is both a promise to
    the player and the reason the sweep cannot be a blanket delete by date.
    """
    db = _fresh(tmp_path)
    _game(db, "ancient", age_days=400)
    with db.session() as session:
        session.add(
            LeaderboardRow(
                id="entry",
                game_id="ancient",
                player_name="Someone",
                mode="classic",
                seed=None,
                wins=30,
                ballot_strength=91.2,
                clean_sweep=True,
                created_at=utcnow() - timedelta(days=400),
            )
        )

    removed = db.sweep(days=14)
    assert removed["games"] == 0, "a submitted game was swept"
    with db.session() as session:
        assert session.get(GameRow, "ancient") is not None
        assert session.scalar(select(func.count()).select_from(LeaderboardRow)) == 1


def test_the_sweep_is_safe_to_run_on_an_empty_database(tmp_path):
    """It runs on every boot, including the very first one."""
    assert _fresh(tmp_path).sweep() == {"games": 0, "side_games": 0}


def test_the_sweep_is_idempotent(tmp_path):
    db = _fresh(tmp_path)
    _game(db, "old", age_days=30)
    assert db.sweep(days=14)["games"] == 1
    assert db.sweep(days=14)["games"] == 0


# --- the real thing ----------------------------------------------------------
POSTGRES_URL = os.environ.get("CLEAN_SWEEP_TEST_POSTGRES")


@pytest.mark.skipif(not POSTGRES_URL, reason="set CLEAN_SWEEP_TEST_POSTGRES to run")
def test_the_schema_round_trips_on_postgres():
    """
    Production runs Postgres and everything else here runs SQLite, so without
    this the two only meet on the deployed instance. Opt-in rather than
    skipped silently in CI: the URL is the switch.
    """
    db = Database(POSTGRES_URL)
    db.create_tables()
    assert db.dialect == "postgresql"

    # Unique per run, and cleaned up either way. A test pointed at a shared
    # database cannot assume it starts empty, and must not leave anything
    # behind for the next one to trip over.
    tag = uuid.uuid4().hex[:8]
    old_id, new_id, chain_id = f"old-{tag}", f"new-{tag}", f"chain-{tag}"
    try:
        _game(db, old_id, age_days=30)
        _game(db, new_id, age_days=1)
        _side_game(db, chain_id, "chain", age_days=30)

        removed = db.sweep(days=14)
        assert removed["games"] >= 1 and removed["side_games"] >= 1

        with db.session() as session:
            assert session.get(GameRow, old_id) is None, "the old game survived the sweep"
            assert session.get(GameRow, new_id) is not None, "a recent game was swept"
            assert session.get(SideGameRow, chain_id) is None
    finally:
        with db.session() as session:
            for row_id in (old_id, new_id):
                session.execute(GameRow.__table__.delete().where(GameRow.id == row_id))
            session.execute(SideGameRow.__table__.delete().where(SideGameRow.id == chain_id))
        db.dispose()
