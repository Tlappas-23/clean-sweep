"""
Six Degrees schemas (``app.models.grid``).

Mirrors ``docs/API.md``. The board's answer key is absent from ``GridState`` by
construction — a cell carries only the actor the player put in it — and appears
only in ``GridResults`` once the round is over.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.people import ActorCard, FilmCard


class GridCell(BaseModel):
    """One intersection of the board."""

    row: int = Field(ge=0)
    column: int = Field(ge=0)
    actor: ActorCard | None = Field(default=None, description="The connector the player named, if any")
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
    """A cell after the reveal: who was named, and the best connector available."""

    row: int
    column: int
    row_actor: str
    column_actor: str
    actor: ActorCard | None = Field(default=None, description="The connector the player named, if any")
    score: float | None = None
    n_possible: int = Field(description="How many actors actually connect that pair")
    best_answer: ActorCard = Field(description="The best-known actor who connects them")
    best_link_films: list[FilmCard] = Field(
        description="The two films proving it: with the row actor, then the column actor",
    )
    found_best: bool


class GridResults(BaseModel):
    """``GET /api/grid/games/{id}/results``."""

    game: GridState
    filled: int
    total: int
    score: float = Field(description="Sum of the cell scores, 0-900")
    perfect: bool = Field(description="Every cell answered with the pair's best connector")
    cells: list[GridCellResult]


class GridAnswerRequest(BaseModel):
    """``POST /api/grid/games/{id}/answer``."""

    row: int = Field(ge=0)
    column: int = Field(ge=0)
    #: The name as the player typed it. The server resolves it, forgiving
    #: case, accents, punctuation, a dropped middle initial and a misspelling
    #: — there is no autocomplete to lean on, so the typing has to be
    #: forgiven instead.
    name: str = Field(min_length=2, max_length=64)
