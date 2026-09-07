"""
``app.api`` — the HTTP layer.

Architecture note
-----------------
One router per resource, each a thin translation between HTTP and a pure
engine (docs/ARCHITECTURE.md). A handler loads state, calls the engine,
persists what comes back and serialises it. No game rule is decided here:
if a router is choosing what something scores or whether a move is legal,
the rule is in the wrong place.

    deps.py         app-state dependencies, the two repositories, shared guards
    meta.py         GET  /api/meta and /api/modes (the game-mode menu)
    games.py        the Oscars mode: the round loop, results, submit
    grid.py         the Co-star Grid
    recast.py       Recast
    leaderboard.py  GET  /api/leaderboard
    catalog.py      GET  /api/catalog/years/{year}
    analytics.py    GET  /api/analytics/{clusters,ranker,validation}
"""
