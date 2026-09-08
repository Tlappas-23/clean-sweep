"""
The people catalog (``app.data.people``): actors, casting types, co-star graph.

Architecture note
-----------------
``app.data.catalog`` indexes *performances* for the Oscars mode. The two side
modes need people instead, so this loads the tables ``pipeline.people_graph``
and ``ml.actors`` produce and builds the indexes each mode asks for:

* Recast needs "who else is this kind of actor", so actors are grouped by
  casting-type cluster and kept sorted by reach.
* Six Degrees needs "who has worked with both of these", so the pair table
  is indexed both ways round and every pair's films are pre-ordered by how
  well known they are.
* The Chain walks from film to film through shared cast, so the same edges are
  also indexed film to actor.

Like the film catalog this is loaded once at startup and is read-only
afterwards. Both side modes are optional: if the tables have not been built
the catalog loads empty and the API reports the modes as unavailable rather
than failing to start.
"""

from __future__ import annotations

import logging
import time
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from app.data.seedfile import read_table
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


@dataclass(slots=True, frozen=True)
class Resolution:
    """
    What a typed name turned into.

    ``actor`` is ``None`` on a miss, and ``ambiguous`` says which kind of miss
    it was: nobody of that name at all, or several people and no way to tell
    which was meant. The two need different things from the player (check the
    spelling; give a fuller name), so they are not collapsed into one answer.
    """

    actor: Actor | None
    ambiguous: bool


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

        # Films each actor appears in, derived from the pair table so the side
        # modes cannot disagree about who was in what.
        self.films_of: dict[str, set[str]] = {}
        # And the same edges read the other way round: who was in each film.
        # The Chain walks film to film, so it needs the inverse constantly and
        # materialising it once is much cheaper than filtering per query.
        self.actors_of: dict[str, set[str]] = {}
        for pairing in self.pairings.values():
            for person in (pairing.actor_a, pairing.actor_b):
                self.films_of.setdefault(person, set()).update(pairing.film_ids)
            for film in pairing.film_ids:
                self.actors_of.setdefault(film, set()).update((pairing.actor_a, pairing.actor_b))

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

    def resolve_actor(self, typed: str) -> Resolution:
        """
        Turn a name a player typed into the actor they meant, or ``None``.

        There is no autocomplete in this mode on purpose: a dropdown that
        lists matching actors as you type hands over the answer, since the
        cell's connectors are exactly the names worth suggesting. The player
        types the whole name from memory. That only works if the game is
        forgiving about *how* it is typed, which is what this does. There are
        four passes, strictest first, each one a different kind of near-miss:

        1. **Exactly right**, once case, accents, punctuation and spacing are
           normalised away. "samuel l jackson" is "Samuel L. Jackson".
        2. **Right words, missing one.** Every word typed appears in the
           actor's name, so a dropped middle initial or a shortened stage name
           still lands: "samuel jackson", "philip hoffman".
        3. **Misspelt.** Close enough on the whole string, by ratio, which
           covers a transposed or dropped letter: "leonardo dicapro".
        4. **Misspelt in one word only.** The surname is right and the
           forename is mangled, or the other way round.

        Ambiguity is refused rather than guessed at. If a partial name fits
        two actors ("jackson" alone fits Samuel L. and Glenda), the caller is
        told to be more specific, because silently picking the more famous one
        would score a cell the player did not actually answer.
        """
        needle = _normalise(typed)
        if not needle:
            return Resolution(None, ambiguous=False)

        # 1. Exact, after normalising. Ties (two actors of the same name) are
        # broken by reach, since there is nothing else to go on.
        exact = [a for a in self.actors.values() if _normalise(a.name) == needle]
        if exact:
            return Resolution(max(exact, key=lambda a: a.fame), ambiguous=False)

        words = needle.split()

        # 2. Every word typed is one of theirs: a dropped middle initial.
        subset = [a for a in self.actors.values() if set(words) <= set(_normalise(a.name).split())]
        if len(subset) == 1:
            return Resolution(subset[0], ambiguous=False)
        if subset:
            return Resolution(None, ambiguous=True)

        # 3 and 4. Misspelt, either overall or in a single word.
        scored = [
            (score, actor)
            for actor in self.actors.values()
            if (score := _name_similarity(words, needle, _normalise(actor.name))) >= _FUZZY_THRESHOLD
        ]
        if not scored:
            return Resolution(None, ambiguous=False)
        best = max(score for score, _ in scored)
        # Two actors equally close to a typo is the same ambiguity as above.
        closest = [actor for score, actor in scored if score >= best - 1e-9]
        if len(closest) == 1:
            return Resolution(closest[0], ambiguous=False)
        return Resolution(None, ambiguous=True)

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
        actors_table = read_table(seed_dir, "actors")
        costars_table = read_table(seed_dir, "costars")
        if actors_table is None or costars_table is None:
            log.warning("people catalog: actors/costars tables missing; side modes disabled")
            return cls([], [])

        actors = [
            Actor(
                person_id=str(person_id),
                name=str(name),
                n_films=int(n_films),
                fame=float(fame),
                mean_rating=_opt_float(mean_rating),
                mean_billing=_opt_float(mean_billing),
                lead_share=float(lead_share),
                first_year=int(first_year),
                last_year=int(last_year),
                median_year=float(median_year),
                top_genres=tuple(str(g) for g in (top_genres or ())),
                casting_type=_opt_str(casting_type),
                cluster_id=_opt_int(cluster_id),
            )
            for (
                person_id,
                name,
                n_films,
                fame,
                mean_rating,
                mean_billing,
                lead_share,
                first_year,
                last_year,
                median_year,
                top_genres,
                casting_type,
                cluster_id,
            ) in actors_table.rows(
                "person_id",
                "name",
                "n_films",
                "fame",
                "mean_rating",
                "mean_billing",
                "lead_share",
                "first_year",
                "last_year",
                "median_year",
                "top_genres",
                "casting_type",
                "cluster_id",
            )
        ]

        pairings = [
            Pairing(
                actor_a=str(actor_a),
                actor_b=str(actor_b),
                film_ids=tuple(str(f) for f in (film_ids or ())),
            )
            for actor_a, actor_b, film_ids in costars_table.rows("actor_a", "actor_b", "film_ids")
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


# How alike two names must be before a typo is forgiven. Tuned so that a
# dropped or transposed letter still resolves while two different actors with
# similar names never collapse into one: "chris pine" must not become "Chris
# Pratt", and at 0.86 it does not.
_FUZZY_THRESHOLD = 0.86


def _normalise(name: str) -> str:
    """
    Casefold, strip accents and punctuation, collapse spacing.

    This is what makes "Penelope Cruz" find "Penélope Cruz" and "Samuel L
    Jackson" find "Samuel L. Jackson". Those are the differences a player
    cannot be expected to reproduce from memory on a three-minute clock.
    """
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in stripped).split())


def _name_similarity(words: list[str], needle: str, candidate: str) -> float:
    """
    How close a typed name is to a real one, 0-1.

    Two views, because a typo shows up differently depending on where it
    falls. Compared whole, a misspelt surname is diluted by a correct
    forename; compared word by word, the mangled word is isolated and its own
    similarity is what decides. The better of the two is used, and the
    word-wise view is only trusted when the word counts match. Otherwise
    "Tom" would score highly against "Tom Hanks".
    """
    whole = SequenceMatcher(None, needle, candidate).ratio()
    parts = candidate.split()
    if len(parts) != len(words):
        return whole
    pairwise = min(SequenceMatcher(None, w, p).ratio() for w, p in zip(words, parts, strict=True))
    return max(whole, pairwise)


# As in app.data.catalog: the packed seed hands back Python natives with a
# real ``null`` for every missing cell, so these only widen a null.


def _opt_float(value) -> float | None:
    return None if value is None else float(value)


def _opt_int(value) -> int | None:
    return None if value is None else int(value)


def _opt_str(value) -> str | None:
    return None if value is None else str(value)
