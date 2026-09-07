"""
Clean Sweep backend package (``backend/app``).

Architecture note
-----------------
This is the request-path half of the project. Everything under ``app`` is
served by FastAPI at runtime; the offline halves (``backend/pipeline`` for the
data build and ``backend/ml`` for model training) never get imported here.

    app/core     settings + SQLite persistence
    app/models   Pydantic schemas mirroring docs/API.md
    app/data     the in-memory Catalog built from data/seed/*.parquet
    app/engine   pure game logic (slot machine, scoring, season simulation)
    app/api      HTTP routers wiring the engine and catalog together
    app/main.py  application factory + lifespan
"""
