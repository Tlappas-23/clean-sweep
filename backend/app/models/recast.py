"""
Recast schemas (``app.models.recast``).

Mirrors ``docs/API.md``. ``RecastState`` describes the film and the roles;
what each casting was *worth* appears only in ``RecastResults``.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.people import ActorCard, FilmCard


class RoleCard(BaseModel):
    """A part in the source film, as originally cast."""

    billing: int
    character: str | None
    original: ActorCard
    is_lead: bool


class CastingPick(BaseModel):
    """One filled role."""

    billing: int
    character: str | None
    original: ActorCard
    replacement: ActorCard


class RecastState(BaseModel):
    """``POST /api/recast/games`` and every mutating recast endpoint."""

    id: str
    seed: str | None = None
    status: str = Field(description='"casting" or "complete"')
    film: FilmCard
    roles: list[RoleCard]
    current_role: int = Field(description="Index into roles; equals len(roles) when complete")
    picks: list[CastingPick]
    created_at: str


class FitBreakdown(BaseModel):
    """Why a casting scored what it did, each component 0-100."""

    stature: float
    role_fit: float
    genre: float
    era: float


class CastingResult(BaseModel):
    """One role after the reveal."""

    billing: int
    character: str | None
    original: ActorCard
    replacement: ActorCard
    fit: float = Field(description="0-100")
    breakdown: FitBreakdown
    best_available: ActorCard | None
    best_fit: float | None


class RecastResults(BaseModel):
    """``GET /api/recast/games/{id}/results``."""

    game: RecastState
    score: float = Field(description="Mean fit across the roles, 0-100")
    castings: list[CastingResult]
    strongest: int | None = Field(default=None, description="Billing of the best-fitting choice")
    weakest: int | None = Field(default=None, description="Billing of the worst-fitting choice")


class CastRequest(BaseModel):
    """``POST /api/recast/games/{id}/cast``."""

    person_id: str
