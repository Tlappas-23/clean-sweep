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

from app.api.deps import CatalogDep
from app.engine.scoring import METRIC_INFO
from app.engine.season import CEREMONIES
from app.engine.slot_machine import SlotMachine
from app.models.enums import CATEGORY_LABELS, Category, Mode
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
