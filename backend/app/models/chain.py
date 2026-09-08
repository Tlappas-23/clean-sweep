"""
The Chain schemas (``app.models.chain``).

Mirrors ``docs/API.md``. The board's shortest route is absent from
``ChainState`` by construction: a round in play carries only where you started,
where you are going, and where you have been, so the answer cannot leak while
the stopwatch is running. It appears in ``ChainResults`` and nowhere else.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.people import ActorCard, FilmCard


class ChainStep(BaseModel):
    """
    One move: the actor who carried you, and the film you arrived at.

    The actor is the part worth showing. The film is the player's answer, but
    the actor is why it counted, and on the reveal it is what makes a route
    checkable rather than asserted.
    """

    actor: ActorCard
    film: FilmCard


class ChainState(BaseModel):
    """``POST /api/chain/games`` and every mutating chain endpoint."""

    id: str
    seed: str | None = None
    status: str = Field(description='"playing" or "complete"')
    start: FilmCard
    target: FilmCard
    #: Where you are standing. The start film until the first move lands.
    here: FilmCard
    route: list[ChainStep] = Field(default_factory=list, description="Moves so far, in order")
    steps: int
    seconds: int = Field(description="Stopwatch, counting up, capped at the round limit")
    max_seconds: int
    created_at: str


class ChainResults(BaseModel):
    """``GET /api/chain/games/{id}/results``."""

    game: ChainState
    solved: bool
    steps: int
    par: int = Field(description="Length of the shortest route the board was built on")
    seconds: int
    ended: str = Field(description='Why it stopped: "solved", "gave_up" or "time"')
    route: list[ChainStep] = Field(description="The route the player walked")
    shortest: list[ChainStep] = Field(
        description="A shortest route. There may be others; this is one of them."
    )


class ChainMoveRequest(BaseModel):
    """``POST /api/chain/games/{id}/move``."""

    #: The film being named. Resolved from a title the same way Six Degrees
    #: resolves an actor's name, so spelling is forgiven.
    title: str = Field(min_length=2, max_length=120)


class ChainLeaderboardEntry(BaseModel):
    """One finished chain on the board."""

    id: str
    seed: str | None
    solved: bool
    steps: int
    par: int
    seconds: int
    created_at: str
