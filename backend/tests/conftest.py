"""
Shared pytest fixtures (``tests.conftest``).

Two worlds are set up here, matching the two layers being tested:

* :func:`fake_catalog` is a hand-built catalog of a few dozen contenders. The
  engine only depends on the ``CatalogLike`` protocol, so its rules can be
  tested without touching parquet, which keeps the unit tests instant and
  makes the expected scores easy to reason about by hand.
* :func:`client` is a ``TestClient`` over the real application with the real
  seed data, pointed at a throwaway SQLite file. This is the integration
  layer: it proves the routers, persistence and masking behave as the
  contract says against 68k real contenders.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import Database, GameRow, LeaderboardRow, SideGameRow
from app.core.limits import limiter
from app.data.catalog import Catalog, ContenderRecord
from app.data.people import PeopleCatalog
from app.models.enums import Category

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "data" / "seed"


def make_record(
    category: Category,
    year: int,
    key: str,
    *,
    won: bool = False,
    nominated: bool = False,
    acclaim: float | None = 50.0,
    critics: float | None = 50.0,
    award_standing: float | None = 0.0,
    popularity: float | None = 50.0,
    prestige: float | None = 50.0,
    box_office: float | None = None,
) -> ContenderRecord:
    """
    Build one contender for the fake catalog.

    Defaults are deliberately mid-range so a test only has to state the fields
    it actually cares about (usually ``won`` and one metric).
    """
    is_picture = category is Category.PICTURE
    return ContenderRecord(
        contender_id=f"{category.value}:{key}:{year}",
        category=category,
        year=year,
        film_id=f"tt{key}",
        film_title=f"Film {key} ({year})",
        person_id=None if is_picture else f"nm{key}",
        person_name=None if is_picture else f"Person {key}",
        character=None if is_picture else f"Role {key}",
        genres=("Drama",),
        runtime_minutes=120,
        billing=1,
        imdb_rating=7.5,
        imdb_votes=10_000,
        box_office_usd=None,
        rt_critic=None,
        rt_audience=None,
        metascore=None,
        budget_usd=None,
        poster_path=f"/{key}{year}.jpg",
        box_office_est_usd=None,
        audience=acclaim,
        critics=critics,
        award_standing=award_standing,
        popularity=popularity,
        box_office=box_office,
        prestige=prestige,
        archetype="Prestige Drama",
        cluster_id=0,
        nominated=nominated or won,
        won=won,
        prior_nominations=0,
        prior_wins=0,
    )


@pytest.fixture(autouse=True)
def _fresh_rate_limiter() -> Iterator[None]:
    """
    Give every test the full rate-limit allowance.

    The limiter is process-wide and keyed by caller, and every test arrives as
    the same unnamed local caller, so without this the hundredth test in a
    file inherits the ninety-ninth's spent budget and fails with a 429 that
    has nothing to do with what it was checking. Resetting per test keeps the
    production limits real (they are not raised or disabled here) while
    stopping them leaking between unrelated cases.

    The limiter's own behaviour is tested deliberately, in tests/test_limits.py.
    """
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def fake_catalog() -> Catalog:
    """
    A small catalog covering five years in every category.

    Each (year, category) pool holds a winner, a nominee and an also-ran, so a
    test can build a perfect ballot, a one-snub ballot or anything between.
    Five years is deliberately more than ``YEARS_PER_ROUND``: a round must not
    be able to put every year on the board, or "a year that was not dealt"
    would be untestable.
    """
    records: list[ContenderRecord] = []
    for year in (1980, 1990, 2000, 2010, 2020):
        for category in Category:
            records.append(
                make_record(category, year, "win", won=True, acclaim=95.0, popularity=90.0, prestige=98.0)
            )
            records.append(
                make_record(
                    category, year, "nom", nominated=True, acclaim=80.0, popularity=75.0, prestige=70.0
                )
            )
            records.append(make_record(category, year, "also", acclaim=60.0, popularity=55.0, prestige=30.0))
    return Catalog(records)


@pytest.fixture(scope="session")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    """
    The real app over the real seed, with an isolated database.

    Session-scoped because loading 68k contenders from parquet takes a second
    or two; the throwaway database keeps the tests independent of any
    ``clean_sweep.db`` sitting in the repo.
    """
    if not (SEED_DIR / "contenders.parquet").exists():  # pragma: no cover
        pytest.skip("seed data missing - run `python -m pipeline.build_seed`")

    # Production runs Postgres and the suite runs SQLite, so the two would
    # otherwise only ever meet on the deployed instance. Pointing
    # CLEAN_SWEEP_TEST_POSTGRES at a database runs this entire suite against
    # it, which is how the portability claim gets checked rather than assumed.
    postgres = os.environ.get("CLEAN_SWEEP_TEST_POSTGRES")
    db_url = postgres or f"sqlite:///{tmp_path_factory.mktemp('db') / 'test.db'}"
    settings = Settings(
        seed_dir=SEED_DIR,
        models_dir=REPO_ROOT / "data" / "models",
        db_url=db_url,
    )

    from app.main import app

    # Override the lifespan's singletons with test-scoped ones. Assigning to
    # ``app.state`` before the context manager runs is not enough (the lifespan
    # would overwrite them), so the database and catalog are injected after
    # startup instead.
    with TestClient(app) as test_client:
        app.state.settings = settings
        app.state.catalog = Catalog.load(SEED_DIR)
        app.state.people = PeopleCatalog.load(SEED_DIR)
        database = Database(settings.db_url)
        database.create_tables()
        if postgres:
            # A shared Postgres is not thrown away between runs the way a temp
            # SQLite file is, so it starts empty or the leaderboard assertions
            # inherit the last run's rows.
            with database.session() as session:
                for table in (LeaderboardRow, SideGameRow, GameRow):
                    session.execute(table.__table__.delete())
        app.state.database = database
        yield test_client
        database.dispose()
