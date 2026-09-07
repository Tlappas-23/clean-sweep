"""
Results schemas (``app.models.results``): the reveal at the end of a game.

Everything hidden during play surfaces here: the picks come back with their
metrics unmasked, each is paired with its Academy outcome and the real
winner, and the 30-ceremony season record is spelled out stop by stop.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.contender import Contender
from app.models.enums import Category
from app.models.game import GameState, Pick


class CeremonyResult(BaseModel):
    """One stop on the awards circuit and whether the ballot cleared it."""

    name: str
    index: int = Field(ge=1, le=30, description="1-30, ascending difficulty")
    threshold: float
    weighted_strength: float = Field(description="Ballot strength under this ceremony's emphasis")
    emphasis: dict[Category, float]
    won: bool


class PickResult(BaseModel):
    """A pick with the answer key attached."""

    pick: Pick = Field(description="Contender now fully unmasked")
    academy: int = Field(description="0 / 60 / 100")
    nominated: bool
    won_oscar: bool
    actual_winner: Contender | None = Field(description="Who really won that year/category")
    metric_breakdown: dict[str, float | None] = Field(description="All five metrics (null when unavailable)")
    pick_score: float = Field(description="0-100")


class GameResults(BaseModel):
    """``GET /api/games/{id}/results``."""

    game: GameState
    ballot_strength: float = Field(description="Sum of the eight pick scores, 0-800")
    wins: int = Field(ge=0, le=30)
    losses: int = Field(ge=0, le=30)
    clean_sweep: bool = Field(description="wins == 30")
    ceremonies: list[CeremonyResult]
    picks: list[PickResult]
    weakest_category: Category | None
