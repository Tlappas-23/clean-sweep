"""
Recast (``app.engine.recast``): who else could have played this part?

A film comes up with its principal roles. One at a time you replace the actor
in each part, choosing from a shortlist, and the round scores how defensible
your casting is.

Why a cluster draws the shortlist
---------------------------------
The pool for a role is the original actor's casting type, from ``ml.actors``.
That choice is the game. Offering the whole catalog would turn each round into
a search box, and offering a random sample would put a 1950s character player
up for a modern franchise lead - not a decision, just a mismatch. Drawing from
the cluster guarantees everyone on the shortlist plausibly does this *kind* of
work, so the round is a judgement about which of them fits this particular
part.

How a replacement is scored
---------------------------
Four things decide whether a recast reads as sane, and each is scored on its
own 0-100 scale before being blended (:data:`FIT_WEIGHTS`):

* **Stature.** A part that carried a film needs a name that can carry a film.
  Compared on reach, which is log vote count, so the gap that matters is
  order-of-magnitude rather than absolute.
* **Role fit.** Whether they actually play parts of this size, from the share
  of their credits that are leads. A career supporting player taking over a
  lead is a bolder call than the reverse, and scores lower.
* **Era.** Contemporaries are more plausible than actors separated by
  generations. Deliberately the lightest weight of the four - a knowingly
  anachronistic recast should cost something, not everything.
* **Genre.** Whether they work in the kind of film this is.

The round reveals the highest-scoring actor in each shortlist afterwards, so
there is always a "best available" to compare against rather than a bare
number.

Gender is deliberately not a factor
-----------------------------------
The seed does carry a gender signal - the Academy splits its acting awards -
and it would be easy to require a like-for-like swap. The mode does not,
because gender-swapped casting is a real creative decision rather than an
error, and scoring it as a mismatch would build an opinion into the maths that
the data cannot support. A recast is judged on stature, role size, era and
genre; who the part was written for is left to the player.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Protocol

from app.engine.errors import GameError

# Roles offered per film, in billing order. Beyond about five the parts stop
# being recognisable enough to have an opinion about.
MAX_ROLES = 5
MIN_ROLES = 3

# Shortlist size per role. Large enough to be a real choice, small enough to
# read at a glance.
SHORTLIST = 18

# Billing at or above which a part counts as a lead.
LEAD_BILLING = 2

# How the four components blend into one fit score.
FIT_WEIGHTS: dict[str, float] = {
    "stature": 0.35,
    "role_fit": 0.30,
    "genre": 0.20,
    "era": 0.15,
}
assert abs(sum(FIT_WEIGHTS.values()) - 1.0) < 1e-9, FIT_WEIGHTS

# Reach difference, in log-votes, at which stature scores zero. Roughly two
# orders of magnitude of audience: a straight-to-video name replacing a
# household one.
STATURE_TOLERANCE = 4.0

# Years apart at which the era term scores zero.
ERA_TOLERANCE = 40.0


class ActorLike(Protocol):
    person_id: str
    name: str
    fame: float
    lead_share: float
    median_year: float
    top_genres: tuple[str, ...]
    cluster_id: int | None
    casting_type: str | None


@dataclass(frozen=True, slots=True)
class Role:
    """One part in the source film, as it was originally cast."""

    person_id: str
    person_name: str
    character: str | None
    billing: int

    @property
    def is_lead(self) -> bool:
        return self.billing <= LEAD_BILLING


def _closeness(difference: float, tolerance: float) -> float:
    """Map a distance onto 0-100, hitting zero at ``tolerance``."""
    return max(0.0, 100.0 * (1.0 - abs(difference) / tolerance))


def fit_breakdown(
    candidate: ActorLike, original: ActorLike, role: Role, film_genres: tuple[str, ...]
) -> dict[str, float]:
    """The four components of a candidate's fit for one role, each 0-100."""
    stature = _closeness(candidate.fame - original.fame, STATURE_TOLERANCE)

    # A lead part wants someone who leads; a supporting part wants someone who
    # supports. Scored against the role, not against the original actor, so a
    # supporting turn by a huge star does not demand another huge star.
    wanted = 1.0 if role.is_lead else 0.35
    role_fit = 100.0 * (1.0 - min(1.0, abs(candidate.lead_share - wanted)))

    era = _closeness(candidate.median_year - original.median_year, ERA_TOLERANCE)

    overlap = set(candidate.top_genres) & set(film_genres)
    genre = 100.0 * len(overlap) / max(1, min(len(film_genres), 3)) if film_genres else 50.0

    return {
        "stature": round(stature, 2),
        "role_fit": round(role_fit, 2),
        "era": round(era, 2),
        "genre": round(min(100.0, genre), 2),
    }


def fit_score(candidate: ActorLike, original: ActorLike, role: Role, film_genres: tuple[str, ...]) -> float:
    """Blend the components into a single 0-100 casting score."""
    parts = fit_breakdown(candidate, original, role, film_genres)
    return round(sum(FIT_WEIGHTS[k] * v for k, v in parts.items()), 2)


def shortlist(
    people,
    original: ActorLike,
    role: Role,
    film_genres: tuple[str, ...],
    exclude: set[str],
    rng: random.Random,
    size: int = SHORTLIST,
) -> list[ActorLike]:
    """
    The actors offered for one role: the original's casting type, minus anyone
    already used.

    The shortlist is not simply the best-fitting candidates. Handing over the
    top ``n`` by fit would make every round the same decision - take the first
    one - so the strongest few are guaranteed a place and the rest of the slots
    are drawn from the remainder of the cluster. That keeps a genuinely good
    answer available while leaving the choice open.

    It is also kept to the original's Academy acting line. The clusters are
    built from career shape alone - how much a person works, how often they
    lead, what genres - and none of that is gendered, so without this filter a
    shortlist for Vito Corleone offers actresses. The question the mode asks
    is who *else* could have played this part, and an answer that ignores the
    part is not an answer.

    An actor with no resolvable line is never excluded by it. Missing data
    should widen a shortlist, not silently remove somebody from the game.
    """
    if original.cluster_id is None:
        raise GameError(503, "casting types have not been built; run `python -m ml.actors`")

    members = [
        a
        for a in people.cluster_members(original.cluster_id)
        if a.person_id != original.person_id and a.person_id not in exclude and same_line(a, original)
    ]
    if len(members) <= size:
        return members

    ranked = sorted(members, key=lambda a: -fit_score(a, original, role, film_genres))
    strong = ranked[: size // 3]
    rest = rng.sample(ranked[size // 3 :], size - len(strong))
    pool = strong + rest
    rng.shuffle(pool)
    return pool


def same_line(candidate, original) -> bool:
    """
    Whether a candidate competes in the same Academy acting line as the role.

    Permissive about absence on both sides: if either line is unknown the pair
    is allowed through, because the alternative is dropping a real actor from
    every shortlist over a gap in the data. In the committed seed every actor
    on the roster resolves, so this is a guard rather than a common path.
    """
    a, b = candidate.academy_line, original.academy_line
    return a is None or b is None or a == b


def playable_roles(catalog, people, film_id: str) -> list[Role]:
    """
    The parts of a film that can actually be recast, in billing order.

    "Can actually be recast" means the original actor has a casting profile
    and a cluster to draw a shortlist from. Filtering has to happen here, in
    one place, because both the film chooser and the round itself ask this
    question: if they answered it differently - one counting five roles and
    the other three - the round's idea of "complete" would not match the one
    the player is looking at.
    """
    profiled = [
        role
        for role in catalog.roles_in_film(film_id)
        if (actor := people.get(role.person_id)) is not None and actor.cluster_id is not None
    ]
    ordered = sorted(profiled, key=lambda r: r.billing)[:MAX_ROLES]
    if len(ordered) < MIN_ROLES:
        raise GameError(422, "that film does not have enough credited roles to recast")
    return ordered


def best_available(
    candidates: list[ActorLike], original: ActorLike, role: Role, film_genres: tuple[str, ...]
) -> ActorLike | None:
    """The strongest casting on the shortlist, revealed after the round."""
    if not candidates:
        return None
    return max(candidates, key=lambda a: fit_score(a, original, role, film_genres))


# --- round state -------------------------------------------------------------
#
# As with the grid, the rules of a round live here rather than in the router:
# what a round is, what casting one role does to it, and what the finished
# casting is worth. None of it needs HTTP or a database to run.


@dataclass(frozen=True, slots=True)
class Casting:
    """One filled role."""

    billing: int
    character: str | None
    original_id: str
    replacement_id: str


@dataclass
class Round:
    """
    A recast in progress.

    Like the grid, only the seed and the decisions are stored. The film's
    roles and every shortlist are functions of the seed, so they are rebuilt
    on demand and a daily recast is the same film and the same shortlists for
    everybody.
    """

    id: str
    seed: str | None
    film_id: str
    created_at: str
    picks: list[Casting] = field(default_factory=list)

    @property
    def current_index(self) -> int:
        return len(self.picks)

    def is_complete(self, roles: list[Role]) -> bool:
        return self.current_index >= len(roles)

    def used_actors(self, upto: int | None = None) -> set[str]:
        """
        Actors already cast, so a shortlist never offers the same person twice.

        ``upto`` reconstructs the state as it was before a given role, which is
        what scoring needs to rebuild the shortlist a player actually saw.
        """
        picks = self.picks if upto is None else self.picks[:upto]
        return {p.replacement_id for p in picks}

    def shortlist_rng(self, index: int) -> random.Random:
        """
        Per-role stream, so a shortlist is stable across reloads.

        Seeding per role rather than drawing from one stream means a player who
        refreshes mid-round sees the same names, and scoring can rebuild them.
        """
        return random.Random(f"{self.seed or self.id}:{index}")

    def cast(self, role: Role, replacement_id: str, allowed: set[str]) -> None:
        """Cast the current role. ``allowed`` is that role's shortlist."""
        if replacement_id not in allowed:
            raise GameError(400, "that actor is not on this role's shortlist")
        self.picks.append(
            Casting(
                billing=role.billing,
                character=role.character,
                original_id=role.person_id,
                replacement_id=replacement_id,
            )
        )


@dataclass(frozen=True, slots=True)
class CastingOutcome:
    """One role after the reveal: what was chosen, and the best that was on offer."""

    billing: int
    character: str | None
    original_id: str
    replacement_id: str
    fit: float
    breakdown: dict[str, float]
    best_available_id: str | None
    best_fit: float | None


@dataclass(frozen=True, slots=True)
class Outcome:
    """A finished casting, scored."""

    score: float
    castings: tuple[CastingOutcome, ...]
    strongest: int | None
    weakest: int | None


def outcome(round_: Round, people, roles: list[Role], film_genres: tuple[str, ...]) -> Outcome:
    """
    Score a completed casting.

    Each role is scored against the shortlist the player was actually shown,
    which is rebuilt from the round's state as it stood before that pick. That
    matters for fairness: "best available" must mean best among the options
    offered, not best in the catalog.
    """
    results: list[CastingOutcome] = []
    for index, pick in enumerate(round_.picks):
        role = roles[index]
        original = people.get(pick.original_id)
        replacement = people.get(pick.replacement_id)
        candidates = shortlist(
            people, original, role, film_genres, round_.used_actors(upto=index), round_.shortlist_rng(index)
        )
        best = best_available(candidates, original, role, film_genres)
        results.append(
            CastingOutcome(
                billing=role.billing,
                character=role.character,
                original_id=pick.original_id,
                replacement_id=pick.replacement_id,
                fit=fit_score(replacement, original, role, film_genres),
                breakdown=fit_breakdown(replacement, original, role, film_genres),
                best_available_id=best.person_id if best else None,
                best_fit=fit_score(best, original, role, film_genres) if best else None,
            )
        )

    fits = [c.fit for c in results]
    return Outcome(
        score=round(sum(fits) / len(fits), 2) if fits else 0.0,
        castings=tuple(results),
        strongest=max(results, key=lambda c: c.fit).billing if results else None,
        weakest=min(results, key=lambda c: c.fit).billing if results else None,
    )


def choose_film(catalog, people, rng: random.Random) -> str:
    """
    Pick a film worth recasting: well known, with enough profiled principals.

    Every candidate is verified before it is offered, so a round never opens on
    a film whose cast the game cannot describe.
    """
    candidates = catalog.recastable_films()
    rng.shuffle(candidates)
    for film_id in candidates:
        roles = [r for r in catalog.roles_in_film(film_id) if people.get(r.person_id) is not None]
        if len(roles) >= MIN_ROLES and all(people.get(r.person_id).cluster_id is not None for r in roles):
            return film_id
    raise GameError(503, "no film in the catalog has enough profiled roles to recast")
