"""
Engine error type (``app.engine.errors``).

The engine does not know about HTTP, but its rule violations map naturally
onto 4xx responses ("spin is only valid while spinning" is a 409 conflict,
"unknown contender" is a 404). ``GameError`` carries the intended status so
the API layer can translate it with one line and the engine tests can
assert on the exact rule that fired.
"""

from __future__ import annotations


class GameError(Exception):
    """A rule violation raised by the engine; the API maps it to ``HTTPException``."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
