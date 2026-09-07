"""
Co-star Grid schemas (``app.models.grid``).

Mirrors ``docs/API.md``. The board's answer key is absent from ``GridState``
by construction - a cell carries only what the player put in it - and appears
only in ``GridResults`` once the round is over.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.people import ActorCard, FilmCard


class GridCell(BaseModel):
    """One intersection of the board."""

    row: int = Field(ge=0)
    column: int = Field(ge=0)
    film: FilmCard | None = Field(default=None, description="What the player named, if anything")
    score: float | None = Field(default=None, description="0-100 once answered")


class GridState(BaseModel):
    """``POST /api/grid/games`` and every mutating grid endpoint."""

    id: str
    seed: str | None = None
    status: str = Field(description='"playing" or "complete"')
    rows: list[ActorCard]
    columns: list[ActorCard]
    cells: list[GridCell]
    seconds_remaining: int = Field(description="Clamped at 0; the board locks itself at 0")
    round_seconds: int
    created_at: str


class GridCellResult(BaseModel):
    """A cell after the reveal: what was named, and the best answer available."""

    row: int
    column: int
    row_actor: str
    column_actor: str
    film: FilmCard | None
    score: float | None
    n_possible: int = Field(description="How many films that pair actually share")
    best_answer: FilmCard = Field(description="Their best-known collaboration")
    found_best: bool


class GridResults(BaseModel):
    """``GET /api/grid/games/{id}/results``."""

    game: GridState
    filled: int
    total: int
    score: float = Field(description="Sum of the cell scores, 0-900")
    perfect: bool = Field(description="Every cell answered with the pair's best film")
    cells: list[GridCellResult]


class GridAnswerRequest(BaseModel):
    """``POST /api/grid/games/{id}/answer``."""

    row: int = Field(ge=0)
    column: int = Field(ge=0)
    film_id: str
