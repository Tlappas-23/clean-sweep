"""
``app.engine`` — pure game logic.

Architecture note
-----------------
"Engine is pure": no I/O, no database, no FastAPI. Every function takes state
plus a catalog-like lookup and returns new state or a result. That is what
makes the rules unit-testable against a hand-built fake catalog, and what makes
every seeded mode reproducible.

Each mode owns a module, and each owns the whole of its rules — what a round
is, which moves are legal, what they score, and what the finished round is
worth:

    game.py          the Oscars mode: spin, reroll, skip, pick, results
    grid.py          the Co-star Grid: board search, answers, scoring
    recast.py        Recast: shortlists, casting fit, scoring
    slot_machine.py  the seeded decade/year reels the Oscars mode draws from
    scoring.py       metric weights -> a contender's pick score
    season.py        the 30-ceremony circuit and its simulation
    calibrate.py     offline script that justifies the season's constants
    errors.py        GameError, the one way a rule refuses something
"""

from app.engine.errors import GameError

__all__ = ["GameError"]
