"""
Contender schemas (``app.models.contender``): what a candidate looks like on the wire.

The ``Contender`` shape is shared by every endpoint that lists people/films.
It deliberately has *no* Academy fields: whether a contender was nominated or
won is the game's hidden answer and only ever appears inside ``PickResult``
(after the ballot is complete) or on the catalog-browse endpoint, which uses
the ``BrowseContender`` extension below.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.enums import Category


class ContenderMetrics(BaseModel):
    """The four *visible* strength metrics, 0-100. All null in cinephile mode."""

    acclaim: float | None = None
    popularity: float | None = None
    box_office: float | None = None
    prestige: float | None = None


class ContenderStats(BaseModel):
    """Raw numbers behind the metrics, shown on the card in classic mode."""

    imdb_rating: float | None = None
    imdb_votes: int | None = None
    box_office_usd: float | None = None
    rt_critic: int | None = None
    rt_audience: int | None = None
    metascore: int | None = None


class Contender(BaseModel):
    """One entry in a candidate pool. Person fields are null for Best Picture."""

    contender_id: str = Field(description='"picture:tt0111161" or "actor:nm0000209:tt0111161"')
    category: Category
    year: int
    film_id: str
    film_title: str
    person_id: str | None = None
    person_name: str | None = None
    character: str | None = None
    genres: list[str] = Field(default_factory=list)
    runtime_minutes: int | None = None
    archetype: str | None = None
    metrics: ContenderMetrics
    stats: ContenderStats


class AcademyOutcome(BaseModel):
    """The ground truth for one contender in one category."""

    nominated: bool
    won: bool


class BrowseContender(Contender):
    """
    ``Contender`` plus the Academy outcome, for ``GET /api/catalog/years/{year}``.

    This endpoint exists for browsing history outside a game, so it has
    nothing to hide: metrics and stats are always filled and ``academy`` says
    whether the contender was nominated / won in this category. It is the
    only place the outcome rides along with a ``Contender`` shape; every
    in-game endpoint uses the plain ``Contender`` and cannot leak it.
    """

    academy: AcademyOutcome | None = None
