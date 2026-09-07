"""
Shapes shared by the two side modes (``app.models.people``).

Both Recast and the Co-star Grid deal in people and films rather than in
performances, so they need cards for those rather than the Oscars mode's
``Contender``. Keeping them in one module means the two modes cannot drift
apart on what an actor looks like on the wire.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ActorCard(BaseModel):
    """An actor as the side modes show them."""

    person_id: str
    name: str
    n_films: int
    first_year: int
    last_year: int
    lead_share: float = Field(description="Share of their credits that are leading parts, 0-1")
    top_genres: list[str] = Field(default_factory=list)
    casting_type: str | None = Field(default=None, description="Cluster label from ml.actors")


class FilmCard(BaseModel):
    """A film as the side modes show them."""

    film_id: str
    title: str
    year: int
    poster_url: str | None = None
    genres: list[str] = Field(default_factory=list)
