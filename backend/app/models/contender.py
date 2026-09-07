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
    """
    The strength metrics, 0-100. All null in cinephile mode.

    ``acclaim``, ``popularity`` and ``box_office`` are scored. ``prestige`` is
    **not**: it is the ranker's estimated probability that a contender won, and
    a player's record should not depend on what a model guessed. It is carried
    here as an informational hint and shown labelled as a model estimate; the
    evidence that it is worth showing at all is in data/models/validation.json.
    ``box_office`` is computed from measured revenue only.
    """

    acclaim: float | None = None
    popularity: float | None = None
    box_office: float | None = None
    prestige: float | None = Field(default=None, description="Model estimate; not scored")


class ContenderStats(BaseModel):
    """Raw numbers behind the metrics, shown on the card in classic mode."""

    imdb_rating: float | None = None
    imdb_votes: int | None = None
    box_office_usd: float | None = Field(default=None, description="Measured revenue, or null")
    box_office_est_usd: float | None = Field(
        default=None,
        description=(
            "Estimated revenue, present only where no measurement exists. Shown to the "
            "player as an estimate and never scored (see pipeline/boxoffice.py)."
        ),
    )
    budget_usd: float | None = None
    rt_critic: int | None = None
    rt_audience: int | None = None
    metascore: int | None = None


class CareerContext(BaseModel):
    """
    What the person had already done *before* this film year.

    Strictly historical, so it never leaks the outcome of the round being
    played: a 1994 pick sees only nominations earned up to 1993. It is a real
    edge for a player - Academy voters reward familiar names - which is why it
    is shown on the card in classic mode and hidden in cinephile.
    """

    prior_nominations: int = 0
    prior_wins: int = 0
    billing: int | None = Field(
        default=None, description="Cast billing in this film, 1 = top billed; null off the cast list"
    )


class Contender(BaseModel):
    """One entry in a candidate pool. Person fields are null for film categories."""

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
    poster_url: str | None = Field(
        default=None,
        description="Fully-qualified TMDB poster image, or null when the film has none",
    )
    metrics: ContenderMetrics
    stats: ContenderStats
    career: CareerContext = Field(
        description="Track record of the person before this film year; zeros for film categories"
    )


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
