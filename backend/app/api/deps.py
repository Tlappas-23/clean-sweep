"""
Shared API plumbing (``app.api.deps``): dependencies and the game repository.

Architecture note
-----------------
The routers stay thin because everything stateful lives here:

* the singletons built during the app lifespan (settings, catalog, database)
  are exposed through FastAPI dependencies that read ``request.app.state``,
  so tests can swap in a temp database and a fake catalog without patching
  module globals;
* :class:`GameRepository` is the only code that knows a game is stored as a
  JSON blob in SQLite. It hands the engine a ``StoredGame`` and writes back
  whatever the engine returns, which keeps the "engine is pure" boundary
  intact.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from app.core.config import Settings
from app.core.db import Database, GameRow
from app.data.catalog import Catalog
from app.engine import game as engine
from app.engine.errors import GameError
from app.models.game import StoredGame
from app.models.results import GameResults


# --- app-state dependencies --------------------------------------------------
def get_settings(request: Request) -> Settings:
    """Settings resolved once at startup."""
    return request.app.state.settings


def get_catalog(request: Request) -> Catalog:
    """The in-memory contender catalog loaded during the lifespan."""
    return request.app.state.catalog


def get_database(request: Request) -> Database:
    """Engine + session factory."""
    return request.app.state.database


CatalogDep = Annotated[Catalog, Depends(get_catalog)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
DatabaseDep = Annotated[Database, Depends(get_database)]


def to_http(error: GameError) -> HTTPException:
    """Translate an engine rule violation into the HTTP error the contract promises."""
    return HTTPException(status_code=error.status_code, detail=error.detail)


def new_id() -> str:
    """Short, URL-safe, collision-resistant identifier for games and leaderboard rows."""
    return uuid.uuid4().hex


def utc_iso() -> str:
    """Current UTC time as the ISO-8601 string the contract uses for ``created_at``."""
    return datetime.now(UTC).isoformat()


# --- persistence -------------------------------------------------------------


class GameRepository:
    """
    Load and store games. The state travels as JSON so the schema can evolve
    without a migration, and the computed results are cached next to it
    because they are deterministic (same ballot, same record).
    """

    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, stored: StoredGame) -> None:
        with self.database.session() as session:
            session.add(
                GameRow(
                    id=stored.id,
                    mode=stored.mode.value,
                    seed=stored.seed,
                    state_json=stored.model_dump_json(),
                )
            )

    def load(self, game_id: str) -> StoredGame:
        """Fetch a game or raise 404."""
        with self.database.session() as session:
            row = session.get(GameRow, game_id)
            if row is None:
                raise HTTPException(status_code=404, detail=f"game '{game_id}' not found")
            return StoredGame.model_validate_json(row.state_json)

    def save(self, stored: StoredGame) -> None:
        with self.database.session() as session:
            row = session.get(GameRow, stored.id)
            if row is None:  # pragma: no cover - only reachable if a row is deleted mid-request
                raise HTTPException(status_code=404, detail=f"game '{stored.id}' not found")
            row.state_json = stored.model_dump_json()

    def results(self, stored: StoredGame, catalog: Catalog) -> GameResults:
        """
        Return the cached results, computing and storing them on first request.

        Caching is safe precisely because ``engine.results`` is pure; the cache
        is an optimisation, never a source of truth.
        """
        with self.database.session() as session:
            row = session.get(GameRow, stored.id)
            if row is not None and row.results_json:
                return GameResults.model_validate_json(row.results_json)
            try:
                computed = engine.results(stored, catalog)
            except GameError as exc:
                raise to_http(exc) from exc
            if row is not None:
                row.results_json = computed.model_dump_json()
            return computed

    def submitted_game_ids(self, game_id: str) -> bool:
        """True when this game already has a leaderboard row (one entry per game)."""
        from app.core.db import LeaderboardRow

        with self.database.session() as session:
            found = session.scalar(select(LeaderboardRow.id).where(LeaderboardRow.game_id == game_id))
            return found is not None


def get_repository(database: DatabaseDep) -> GameRepository:
    """Repository bound to the request's database."""
    return GameRepository(database)


RepositoryDep = Annotated[GameRepository, Depends(get_repository)]


def load_json_artifact(path, what: str) -> dict:
    """
    Read one of the ML artifacts, or explain how to produce it.

    The analytics endpoints are optional: a clone of the repo that has not run
    the training scripts should get a helpful 404 rather than a stack trace.
    """
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"{what} not available - run `python -m ml.train_ranker` and `python -m ml.cluster` first",
        )
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:  # pragma: no cover - corrupt artifact
        raise HTTPException(status_code=500, detail=f"{what} is not valid JSON: {exc}") from exc
