"""
The people catalog (``app.data.people``): actors, casting types, co-star graph.

Architecture note
-----------------
``app.data.catalog`` indexes *performances* for the Oscars mode. The two side
modes need people instead, so this loads the tables ``pipeline.people_graph``
and ``ml.actors`` produce and builds the indexes each mode asks for:

* Recast needs "who else is this kind of actor", so actors are grouped by
  casting-type cluster and kept sorted by reach.
* The Co-star Grid needs "which films do these two share", so the pair table
  is indexed both ways round and every pair's films are pre-ordered by how
  well known they are.

Like the film catalog this is loaded once at startup and is read-only
afterwards. Both side modes are optional: if the tables have not been built
the catalog loads empty and the API reports the modes as unavailable rather
than failing to start.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.models.people import ActorCard

log = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class Actor:
    """One actor's casting profile."""

    person_id: str
    name: str
    n_films: int
    fame: float
    mean_rating: float | None
    mean_billing: float | None
    lead_share: float
    first_year: int
    last_year: int
    median_year: float
    top_genres: tuple[str, ...]
    casting_type: str | None
    cluster_id: int | None


@dataclass(slots=True, frozen=True)
class Pairing:
    """Two actors and every film they appeared in together, best known first."""

    actor_a: str
    actor_b: str
    film_ids: tuple[str, ...]

    @property
    def n_films(self) -> int:
        return len(self.film_ids)


def _key(left: str, right: str) -> tuple[str, str]:
    """Order-independent pair key, so a lookup never has to try both ways."""
    return (left, right) if left <= right else (right, left)


class PeopleCatalog:
    """Read-only index over ``actors.parquet`` and ``costars.parquet``."""

    def __init__(self, actors: list[Actor], pairings: list[Pairing]) -> None:
        self.actors: dict[str, Actor] = {a.person_id: a for a in actors}
        self.pairings: dict[tuple[str, str], Pairing] = {_key(p.actor_a, p.actor_b): p for p in pairings}

        # Who each actor has ever appeared with. The grid generator walks this
        # constantly, so it is materialised rather than filtered per query.
        self.partners: dict[str, set[str]] = {}
        for left, right in self.pairings:
            self.partners.setdefault(left, set()).add(right)
            self.partners.setdefault(right, set()).add(left)

        # Actors grouped by casting type, most reach first: the recast pool.
        self.by_cluster: dict[int, list[Actor]] = {}
        for actor in actors:
            if actor.cluster_id is not None:
                self.by_cluster.setdefault(actor.cluster_id, []).append(actor)
        for members in self.by_cluster.values():
            members.sort(key=lambda a: -a.fame)

        # Films each actor appears in, derived from the pair table so the two
        # side modes cannot disagree about who was in what.
        self.films_of: dict[str, set[str]] = {}
        for pairing in self.pairings.values():
            for person in (pairing.actor_a, pairing.actor_b):
                self.films_of.setdefault(person, set()).update(pairing.film_ids)

    # -- lookups ---------------------------------------------------------

    def get(self, person_id: str) -> Actor | None:
        return self.actors.get(person_id)

    def shared_films(self, left: str, right: str) -> tuple[str, ...]:
        """Films both actors appear in, best known first. Empty if they never did."""
        pairing = self.pairings.get(_key(left, right))
        return pairing.film_ids if pairing else ()

    def have_worked_together(self, left: str, right: str) -> bool:
        return bool(self.shared_films(left, right))

    def cluster_members(self, cluster_id: int) -> list[Actor]:
        return self.by_cluster.get(cluster_id, [])

    @property
    def is_available(self) -> bool:
        """False when the side-mode tables were never built."""
        return bool(self.actors) and bool(self.pairings)

    def __len__(self) -> int:
        return len(self.actors)

    # -- loading ---------------------------------------------------------

    @classmethod
    def load(cls, seed_dir: Path) -> PeopleCatalog:
        """
        Build from the seed, or return an empty catalog if it has not been made.

        Empty rather than raising: the Oscars mode must keep working on a
        checkout where only the core pipeline has run.
        """
        started = time.perf_counter()
        actors_path = seed_dir / "actors.parquet"
        costars_path = seed_dir / "costars.parquet"
        if not (actors_path.exists() and costars_path.exists()):
            log.warning("people catalog: actors/costars parquet missing; side modes disabled")
            return cls([], [])

        frame = pd.read_parquet(actors_path)
        actors = [
            Actor(
                person_id=str(row.person_id),
                name=str(row.name),
                n_films=int(row.n_films),
                fame=float(row.fame),
                mean_rating=_opt_float(row.mean_rating),
                mean_billing=_opt_float(row.mean_billing),
                lead_share=float(row.lead_share),
                first_year=int(row.first_year),
                last_year=int(row.last_year),
                median_year=float(row.median_year),
                top_genres=tuple(row.top_genres) if row.top_genres is not None else (),
                casting_type=_opt_str(getattr(row, "casting_type", None)),
                cluster_id=_opt_int(getattr(row, "cluster_id", None)),
            )
            for row in frame.itertuples(index=False)
        ]

        pairs_frame = pd.read_parquet(costars_path)
        pairings = [
            Pairing(
                actor_a=str(row.actor_a),
                actor_b=str(row.actor_b),
                film_ids=tuple(row.film_ids),
            )
            for row in pairs_frame.itertuples(index=False)
        ]

        catalog = cls(actors, pairings)
        log.info(
            "people catalog: %d actors, %d pairs, %d casting types, loaded in %.2fs",
            len(catalog),
            len(catalog.pairings),
            len(catalog.by_cluster),
            time.perf_counter() - started,
        )
        return catalog


# --- outbound conversion -----------------------------------------------------
#
# The wire shapes live beside the catalog that owns the objects, matching how
# ``app.data.catalog`` turns a ContenderRecord into a Contender. Routers then
# never construct a payload by hand.


def actor_card(actor: Actor) -> ActorCard:
    """An :class:`Actor` as the side modes send it to the client."""
    return ActorCard(
        person_id=actor.person_id,
        name=actor.name,
        n_films=actor.n_films,
        first_year=actor.first_year,
        last_year=actor.last_year,
        lead_share=round(actor.lead_share, 3),
        top_genres=list(actor.top_genres),
        casting_type=actor.casting_type,
    )


def _opt_float(value) -> float | None:
    return None if value is None or pd.isna(value) else float(value)


def _opt_int(value) -> int | None:
    return None if value is None or pd.isna(value) else int(value)


def _opt_str(value) -> str | None:
    return None if value is None or pd.isna(value) else str(value)
