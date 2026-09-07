"""
Game-state schemas and request bodies (``app.models.game``).

``GameState`` is exactly the object the contract describes. ``StoredGame``
extends it with the bookkeeping the engine needs between requests (how far
the seeded RNG has been advanced) and is what gets serialised into the
``games.state_json`` column; the API responds with the ``GameState`` view of
it so the extra field never reaches the client.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.contender import Contender
from app.models.enums import Category, GameStatus, Mode, SkipKind


class Spin(BaseModel):
    """Result of the slot machine: the year (with its decade reel) and the category."""

    year: int
    category: Category
    decade: str = Field(description='Decade reel label, e.g. "1990s"')


class Pick(BaseModel):
    """A filled ballot slot. The contender is stored as it was shown (still masked)."""

    round: int = Field(ge=1, le=6)
    category: Category
    year: int
    contender: Contender


class SkipsRemaining(BaseModel):
    """How many of each skip the player still has (one of each per game)."""

    year: int = 1
    category: int = 1


class GameState(BaseModel):
    """Public game state, returned by every mutating game endpoint."""

    id: str
    mode: Mode
    seed: str | None = None
    status: GameStatus
    round: int = Field(ge=1, le=6, description="1-6, stays 6 once complete")
    category_order: list[Category]
    current_spin: Spin | None = None
    skips_remaining: SkipsRemaining
    picks: list[Pick] = Field(default_factory=list)
    created_at: str = Field(description="ISO-8601")


class StoredGame(GameState):
    """
    ``GameState`` + engine bookkeeping. Persisted; never sent to the client.

    ``rng_draws`` counts how many numbers have been taken from the game's
    seeded random stream. Re-seeding with the game seed and skipping that
    many draws reproduces the stream exactly, which is what makes a daily
    seeded game identical for every player (see ``app.engine.slot_machine``).
    """

    rng_draws: int = 0

    def public(self) -> GameState:
        """Strip the internal fields for the HTTP response."""
        return GameState.model_validate(self.model_dump(exclude={"rng_draws"}))


# --- request bodies ---------------------------------------------------------


class CreateGameRequest(BaseModel):
    """``POST /api/games``. ``seed`` is optional; the daily challenge passes today's date."""

    mode: Mode = Mode.CLASSIC
    seed: str | None = Field(default=None, max_length=64)


class SkipRequest(BaseModel):
    """``POST /api/games/{id}/skip``."""

    kind: SkipKind


class PickRequest(BaseModel):
    """``POST /api/games/{id}/pick``."""

    contender_id: str


class SubmitRequest(BaseModel):
    """``POST /api/games/{id}/submit``."""

    player_name: str = Field(min_length=1, max_length=40)
