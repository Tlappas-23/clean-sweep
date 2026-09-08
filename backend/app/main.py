"""
Application entrypoint (``app.main``).

Run it with::

    cd backend && uvicorn app.main:app --reload --port 8000

Architecture note
-----------------
The lifespan is where the "data is a build artifact" rule from
docs/ARCHITECTURE.md is enforced: the seed tables are read from parquet
*once*, into an in-memory :class:`~app.data.catalog.Catalog`, and the raw
IMDb files are never touched at request time. The seed is read from the
packed, gzipped columnar tables that ``pipeline.pack`` writes, not from
parquet, which is what keeps pandas and pyarrow out of the deployed image. Everything the handlers need
(settings, catalog, database) is attached to ``app.state`` so the routers can
reach it through dependencies and the tests can swap it out.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import analytics, catalog, chain, games, grid, leaderboard, meta, recast
from app.core.config import get_settings
from app.core.db import Database
from app.core.limits import limiter
from app.core.middleware import RateLimitMiddleware, SecurityHeadersMiddleware
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
    # Every visitor is anonymous and creates a row by pressing Play, so the
    # tables only grow. Startup is the right moment to prune: a free instance
    # sleeps when idle and wakes on the next request, so this runs often, and
    # it is the one point where a little extra work costs a waking player
    # nothing. Submitted leaderboard scores are never swept.
    swept = database.sweep()
    logger.info(
        "database ready on %s; swept %d games and %d side games past retention",
        database.dialect,
        swept.get("games", 0),
        swept.get("side_games", 0),
    )
    if database.dialect == "sqlite":
        # Correct and intended locally; almost certainly a mistake anywhere
        # else. A managed instance has no persistent disk, so this stores
        # every game in a file that is deleted on the next deploy or the next
        # wake from sleep, while looking completely healthy.
        logger.warning(
            "database is SQLite at %s. Games will NOT survive a restart. "
            "Set CLEAN_SWEEP_DB_URL to a Postgres connection string if this is deployed.",
            settings.db_url,
        )
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

# Middleware, registered innermost-first. Starlette applies these in reverse,
# so the last one registered is the outermost and sees the request first.
#
# 1. Security headers and the caching policy, closest to the handlers, so they
#    can read the path that was actually matched.
app.add_middleware(SecurityHeadersMiddleware)

# 2. The rate limiter, outside the handlers so a refused caller costs nothing
#    but before compression, since there is no point compressing a 429.
app.add_middleware(RateLimitMiddleware)

# 3. Compression, outermost on the way out so it wraps every response. This is
#    the single biggest thing done for the phone: the catalog and analytics
#    payloads are repetitive JSON and give up roughly 80% of their bytes.
#    Below 500 bytes the header costs more than it saves.
app.add_middleware(GZipMiddleware, minimum_size=500)

# 4. CORS. The frontend is served from a different origin in every
#    environment: Vite on :5173 locally, GitHub Pages in production. The
#    allowed list is configuration rather than a wildcard, because a wildcard
#    would let any site on the internet drive this API from a visitor's
#    browser.
#
#    `allow_credentials` is False deliberately. The API has no cookies, no
#    sessions and no auth of any kind, so there is nothing for a browser to
#    attach, and turning it on would forbid the wildcard fallback while buying
#    nothing. If auth is ever added, this flips and the origin list stops
#    being allowed to contain "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=3600,  # cache the preflight, so a move is one request not two
)

# Routers are included in the order they appear on the front page: the menu
# first, then the Oscars mode, then the three side modes, then the read-only
# screens.
for module in (meta, games, grid, chain, recast, leaderboard, catalog, analytics):
    app.include_router(module.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, object]:
    """
    Liveness probe used by CI, the Vite dev proxy and the host's supervisor.

    Deliberately more than ``{"ok": true}``. On a free tier the interesting
    question is not whether the process is up, it is whether it came up
    *with its data*: an instance serving an empty catalog would answer every
    request with a 503 and look healthy doing it. The counts make that
    visible from outside without a login.

    Kept cheap enough to poll: every field is a length or a flag already held
    in memory. It is exempt from rate limiting, since limiting the thing that
    decides whether to restart the service is how a service gets restarted.
    """
    catalog = getattr(app.state, "catalog", None)
    people = getattr(app.state, "people", None)
    database = getattr(app.state, "database", None)
    return {
        "status": "ok",
        "contenders": len(catalog) if catalog else 0,
        "actors": len(people) if people else 0,
        "side_modes": bool(people and people.is_available),
        # Which database, and whether it is one that survives a restart.
        # A deployment whose connection string never arrived falls back to a
        # SQLite file on the instance's own disk, which is wiped on every
        # redeploy and every wake from sleep. It serves every request
        # perfectly and loses everything, so it cannot be caught by watching
        # for errors: the only way to see it is to ask. Hence this field.
        "database": database.dialect if database else "none",
        "durable": bool(database and database.dialect != "sqlite"),
        "rate_limiter": limiter.snapshot(),
    }
