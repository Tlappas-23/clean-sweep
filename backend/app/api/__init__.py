"""
``app.api`` — the HTTP layer.

Architecture note
-----------------
One router per resource, each a thin translation between HTTP and the pure
engine (see docs/ARCHITECTURE.md). Handlers load state, call the engine,
persist the result and serialise it; no game rule is decided here.

    deps.py         app-state dependencies + the game repository
    meta.py         GET  /api/meta
    games.py        the round loop and the results/submit endpoints
    leaderboard.py  GET  /api/leaderboard
    catalog.py      GET  /api/catalog/years/{year}
    analytics.py    GET  /api/analytics/{clusters,ranker}
"""
