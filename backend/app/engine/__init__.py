"""
``app.engine`` — pure game logic.

Architecture note
-----------------
"Engine is pure": no I/O, no database, no FastAPI. Every function takes a
game state (a Pydantic object) plus a catalog-like lookup and returns a new
state or a result. That makes the rules unit-testable with a hand-built
fake catalog and, because the only randomness comes from a seeded
``random.Random``, makes the daily challenge reproducible.

    slot_machine.py  decade/year reels driven by a seeded RNG
    scoring.py       metric weights -> a contender's pick score
    season.py        the 30-ceremony circuit and its simulation
    game.py          state transitions: new_game, spin, skip, pick, results
    calibrate.py     offline script that justifies the season thresholds
"""

from app.engine.errors import GameError

__all__ = ["GameError"]
