"""
Application entrypoint (``app.main``).

Run it with::

    cd backend && uvicorn app.main:app --reload --port 8000

Architecture note
-----------------
The lifespan is where the "data is a build artifact" rule from
docs/ARCHITECTURE.md is enforced: the seed tables are read from parquet
*once*, into an in-memory :class:`~app.data.catalog.Catalog`, and the raw
IMDb files are never touched at request time. Everything the handlers need
(settings, catalog, database) is attached to ``app.state`` so the routers can
reach it through dependencies and the tests can swap it out.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analytics, catalog, games, grid, leaderboard, meta, recast
from app.core.config import get_settings
from app.core.db import Database
from app.data.catalog import Catalog
from app.data.people import PeopleCatalog

logger = logging.getLogger("clean_sweep")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the catalog and open the database once, release them at shutdown."""
    settings = get_settings()
    app.state.settings = settings

    started = time.perf_counter()
    app.state.catalog = Catalog.load(settings.seed_dir)
    logger.info(
        "catalog loaded: %d contenders, years %d-%d, ml scores %s, in %.2fs",
        len(app.state.catalog),
        app.state.catalog.min_year,
        app.state.catalog.max_year,
        "present" if app.state.catalog.has_ml_scores else "absent",
        time.perf_counter() - started,
    )

    # The side modes are optional: an empty people catalog disables them
    # rather than stopping the app from starting.
    app.state.people = PeopleCatalog.load(settings.seed_dir)
    logger.info(
        "people catalog: %d actors, side modes %s",
        len(app.state.people),
        "enabled" if app.state.people.is_available else "disabled",
    )

    database = Database(settings.db_url)
    database.create_tables()
    app.state.database = database
    try:
        yield
    finally:
        database.dispose()


app = FastAPI(
    title="Clean Sweep",
    version="0.1.0",
    summary="Draft an Oscar ballot, then see how much of the awards season it would have swept.",
    lifespan=lifespan,
)

# The frontend runs on its own origin in development (Vite on :5173), so the
# browser needs explicit permission to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers are included in the order they appear on the front page: the menu
# first, then the Oscars mode, then the two side modes, then the read-only
# screens.
for module in (meta, games, grid, recast, leaderboard, catalog, analytics):
    app.include_router(module.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe used by CI and the Vite dev proxy."""
    return {"status": "ok"}
