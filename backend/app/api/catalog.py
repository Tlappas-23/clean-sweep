"""
Catalog-browse route (``app.api.catalog``).

This is the one endpoint outside a game, so it has nothing to hide: it
returns the pool for a year with metrics, stats *and* the Academy outcome
attached (:class:`~app.models.contender.BrowseContender`). It powers the
"browse the history" screen, and it is also the quickest way to sanity-check
the seed data by hand::

    curl 'localhost:8000/api/catalog/years/1994?category=actor'
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CatalogDep
from app.data.catalog import browse_contender
from app.models.contender import BrowseContender
from app.models.enums import CandidateSort, Category

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/years/{year}", response_model=list[BrowseContender])
def browse_year(
    year: int,
    catalog: CatalogDep,
    category: Category | None = Query(default=None, description="Restrict to one ballot category"),
    sort: CandidateSort = Query(default=CandidateSort.PRESTIGE),
    q: str | None = Query(default=None, max_length=64),
) -> list[BrowseContender]:
    """Every contender of a film year, unmasked, with who was nominated and who won."""
    from app.data.catalog import search_pool

    if not (catalog.min_year <= year <= catalog.max_year):
        raise HTTPException(
            status_code=404,
            detail=f"year {year} is outside the catalog ({catalog.min_year}-{catalog.max_year})",
        )

    records = catalog.pool(year, category) if category else catalog.year_pool(year)
    if not records:
        raise HTTPException(status_code=404, detail=f"no contenders for {year}")

    return [browse_contender(r) for r in search_pool(records, q, sort)]
