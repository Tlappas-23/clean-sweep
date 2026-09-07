"""
Six Degrees schemas (``app.models.grid``).

Mirrors ``docs/API.md``. The board's answer key is absent from ``GridState`` by
construction — a cell carries only the actor the player put in it — and appears
only in ``GridResults`` once the round is over.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.people import ActorCard, FilmCard


class GridLink(BaseModel):
    """
    One route through a cell: who, the two films that prove it, and its score.

    ``films`` is always exactly two, ordered the way the chain reads — the film
    shared with the row actor, then the film shared with the column actor. They
    travel with the actor rather than alongside them because a name on its own
    is an assertion; the pair of films is what makes it checkable.
    """

    actor: ActorCard
    films: list[FilmCard] = Field(min_length=2, max_length=2)
    score: float = Field(description="0-100; the rarer the connector, the higher")


class GridCell(BaseModel):
    """
    One intersection of the board.

    ``link`` is absent until the cell is answered, and carries the proof as
    soon as it is: naming someone correctly should show you *why* they count,
    while the board is still in front of you, not only in the reveal.
    """

    row: int = Field(ge=0)
    column: int = Field(ge=0)
    link: GridLink | None = Field(default=None, description="What the player put here, if anything")


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
    """
    A cell after the reveal: what was played, and the two ends of the range.

    ``obvious`` and ``rarest`` answer different questions — the connection most
    people would name is the one worth remembering, and the deepest cut that
    still works is the one that was worth 100. On a cell with a single
    connector the two are the same actor.
    """

    row: int
    column: int
    row_actor: str
    column_actor: str
    played: GridLink | None = Field(default=None, description="What the player put here, if anything")
    n_possible: int = Field(description="How many actors actually connect that pair")
    obvious: GridLink = Field(description="The best-known actor who links them, worth the least")
    rarest: GridLink = Field(description="The most obscure actor who links them, worth 100")
    found_rarest: bool


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
