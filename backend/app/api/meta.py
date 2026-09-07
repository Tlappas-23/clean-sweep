"""
Reference-data route (``app.api.meta``).

``GET /api/meta`` is the first call the frontend makes: it supplies the enum
labels, the year range the slot machine can land on and the full ceremony
table, so the client never hard-codes a label or a threshold that the engine
owns. Everything here is derived from the same constants the engine uses,
which is what stops the two from drifting apart.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CatalogDep, PeopleDep
from app.engine.scoring import METRIC_INFO
from app.engine.season import CEREMONIES
from app.engine.slot_machine import SlotMachine
from app.models.enums import CATEGORY_LABELS, Category, Mode
from app.models.menu import ModeCard
from app.models.meta import CategoryInfo, CeremonyInfo, Meta, MetricInfo, ModeInfo, YearRange

router = APIRouter(prefix="/api", tags=["meta"])

# Mode blurbs shown on the home screen (docs/GAME_DESIGN.md §5).
_MODE_INFO: list[ModeInfo] = [
    ModeInfo(
        id=Mode.CLASSIC,
        label="Classic",
        description="Full metrics on every card. Draft on the numbers.",
    ),
    ModeInfo(
        id=Mode.CINEPHILE,
        label="Cinephile",
        description="Metrics hidden. Draft on film knowledge alone.",
    ),
]


# The game-mode menu. Kept beside the Oscars metadata so one call tells the
# client everything it needs to draw the front page.
def _game_menu(people_available: bool) -> list[ModeCard]:
    """
    Every mode the client can offer, and whether its data exists.

    The two side modes depend on tables the core pipeline does not build, so a
    checkout that has only run ``build_seed`` should see them listed and
    disabled rather than have them fail on click.
    """
    return [
        ModeCard(
            id="oscars",
            label="The Oscars",
            tagline="Build the best ballot in history",
            description=(
                "Three years are dealt each round and you draft one contender per category. "
                "Winning the Oscar is what scores highest, but the ballot is yours - if you "
                "think someone should have won, put them on it and see how the season judges "
                "the call."
            ),
            available=True,
            path="/",
        ),
        ModeCard(
            id="recast",
            label="Recast",
            tagline="Who else could have played the part?",
            description=(
                "A film comes up with its principal roles. Replace each one from a shortlist "
                "drawn by clustering actors into casting types, and the round scores how "
                "defensible your casting is on stature, role size, era and genre."
            ),
            available=people_available,
            path="/recast",
        ),
        ModeCard(
            id="grid",
            label="Co-star Grid",
            tagline="Name a film they were both in",
            description=(
                "Three actors down the side, three across the top. Every cell wants a film "
                "both of them appeared in, and every pairing on the board is checked to have "
                "one. Three minutes, or hand it in early."
            ),
            available=people_available,
            path="/grid",
        ),
    ]


@router.get("/modes", response_model=list[ModeCard])
def get_modes(people: PeopleDep) -> list[ModeCard]:
    """The game-mode menu."""
    return _game_menu(people.is_available)


@router.get("/meta", response_model=Meta)
def get_meta(catalog: CatalogDep) -> Meta:
    """Static reference data: labels, year range, decades, ceremonies and metric definitions."""
    # Built through the slot machine so the decade list is exactly the set of
    # decades the reels can actually land on.
    machine = SlotMachine.from_seed("meta", 0, catalog.min_year, catalog.max_year)
    return Meta(
        categories=[CategoryInfo(id=c, label=CATEGORY_LABELS[c]) for c in Category],
        modes=_MODE_INFO,
        years=YearRange(min=catalog.min_year, max=catalog.max_year),
        decades=machine.decades,
        ceremonies=[CeremonyInfo(index=c.index, name=c.name, threshold=c.threshold) for c in CEREMONIES],
        metrics=[MetricInfo(**info) for info in METRIC_INFO],
    )
