"""
The Chain (``app.engine.chain``): get from one film to another through casts.

Two films are dealt, a start and a target. You move by naming a film that
shares a cast member with the one you are standing on, and the game tells you
which actor made the link. Keep stepping until you arrive. A stopwatch runs
the whole time.

Where this sits next to Six Degrees
-----------------------------------
Six Degrees asks for the actor between two actors, and the answer is one name.
This walks the same graph from the other side: the nodes you name are films,
the actors are the edges between them, and the answer is a route rather than a
name. That makes it a different kind of thinking. Six Degrees is recall of one
fact; this is navigation, and there is more than one way through.

Why the route is not scored on length alone
-------------------------------------------
The shortest route is revealed at the end, but a player is not required to
find it. Taking a step more than necessary is a worse answer, not a wrong one,
and the ranking says so: fewest steps first, then fastest. A player who bulls
through in four steps in thirty seconds has done something different from one
who found three in three minutes, and the leaderboard keeps them apart rather
than pretending one number covers both.

Why boards are searched for
---------------------------
A pair of films picked at random is usually two steps apart, which is one
lucky guess, and is occasionally not connected at all. Boards are therefore
searched until the shortest route is exactly :data:`TARGET_STEPS` long, which
is far enough to need a plan and short enough to hold in your head. The search
also insists both endpoints are recognisable, because a route between two
films nobody can picture is not a puzzle, it is a lookup.

Determinism
-----------
The board comes from a seeded stream, so a daily chain is the same pair of
films for everybody.
"""

from __future__ import annotations

import itertools
import random
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from app.engine.errors import GameError

#: How many steps the shortest route should take. Measured over 300 random
#: pairs: 2 steps is the common case and reads as a single guess, 4 or more is
#: rare and starts to feel like wandering. 3 is the shape of the puzzle.
TARGET_STEPS = 3

#: The stopwatch counts up, but a round cannot run forever or the leaderboard
#: would hold entries that never ended. At this point the board closes itself
#: and scores whatever was reached.
MAX_SECONDS = 300

#: Endpoints are drawn from the most recognisable films in the graph. Below
#: this the puzzle stops being about film knowledge.
CANDIDATE_FILMS = 400

#: Give up rather than hang if no pair at the target distance can be found.
MAX_ATTEMPTS = 400

#: How far the route search will look before calling a pair unconnected.
SEARCH_CAP = 6


class PeopleLike(Protocol):
    """The slice of :class:`~app.data.people.PeopleCatalog` the chain needs."""

    films_of: dict[str, set[str]]
    actors_of: dict[str, set[str]]

    def get(self, person_id: str): ...


@dataclass(frozen=True, slots=True)
class Step:
    """One move: the actor who carried you, and the film you arrived at."""

    person_id: str
    film_id: str


@dataclass(frozen=True, slots=True)
class Board:
    """A dealt chain: where you start, where you are going, and how far it is."""

    start: str
    target: str
    #: The shortest route found when the board was built, as steps from
    #: ``start``. Its length is the par for the board.
    shortest: tuple[Step, ...]

    @property
    def par(self) -> int:
        return len(self.shortest)


def neighbours(people: PeopleLike, film: str) -> set[str]:
    """Every film reachable from this one in a single step."""
    out: set[str] = set()
    for actor in people.actors_of.get(film, ()):
        out.update(people.films_of.get(actor, ()))
    out.discard(film)
    return out


def shared_actors(people: PeopleLike, left: str, right: str) -> list[str]:
    """
    Cast members the two films have in common, best known first.

    This is what makes a move legal, and the first entry is the one the game
    names back to the player as the link they just used.
    """
    both = people.actors_of.get(left, set()) & people.actors_of.get(right, set())
    return sorted(both, key=lambda person: -people.get(person).fame)


def shortest_route(
    people: PeopleLike,
    start: str,
    target: str,
    cap: int = SEARCH_CAP,
    order: dict[str, int] | None = None,
) -> tuple[Step, ...] | None:
    """
    The fewest moves from ``start`` to ``target``, or ``None`` if unreachable.

    Breadth-first, so the first route found is a shortest one. There is usually
    more than one at that length, and which one comes back has to be settled
    deliberately for two reasons.

    It has to be **stable**. The neighbour sets are Python sets, so iterating
    them directly hands back a different route between one process and the
    next. The board itself would survive that, because only the route's
    *length* decides whether a pair is dealt, but a player reloading a finished
    daily and seeing a different "shortest route" would rightly call it a bug.

    It should also be **recognisable**. Among routes of equal length, one
    through films people have heard of is a better answer than one through
    films they have not, so neighbours are visited in ``order``, which arrives
    most-known-first from the catalogue. Sorting is what makes both true at
    once.
    """
    if start == target:
        return ()
    rank = order or {}
    last = len(rank)

    def visit_order(films: set[str]) -> list[str]:
        return sorted(films, key=lambda film: (rank.get(film, last), film))

    came_from: dict[str, str] = {start: ""}
    queue: deque[tuple[str, int]] = deque([(start, 0)])
    while queue:
        film, depth = queue.popleft()
        if depth >= cap:
            continue
        for other in visit_order(neighbours(people, film)):
            if other in came_from:
                continue
            came_from[other] = film
            if other == target:
                return _rebuild(people, came_from, start, target)
            queue.append((other, depth + 1))
    return None


def _rebuild(people: PeopleLike, came_from: dict[str, str], start: str, target: str) -> tuple[Step, ...]:
    """Walk the breadth-first tree back to the start, naming each link."""
    films: list[str] = [target]
    while films[-1] != start:
        films.append(came_from[films[-1]])
    films.reverse()
    return tuple(
        Step(person_id=shared_actors(people, a, b)[0], film_id=b) for a, b in itertools.pairwise(films)
    )


def candidate_films(people: PeopleLike, ranked: list[str]) -> list[str]:
    """
    The films a board may start or end on.

    ``ranked`` arrives most recognisable first, from the film catalogue, since
    the people graph has no idea which titles anyone has heard of. Anything
    absent from the graph is dropped: a film with no recorded cast has no
    edges and could never be reached.
    """
    return [film for film in ranked[:CANDIDATE_FILMS] if len(people.actors_of.get(film, ())) >= 2]


def build_board(people: PeopleLike, ranked: list[str], rng: random.Random) -> Board:
    """
    Deal a start and a target that are exactly :data:`TARGET_STEPS` apart.

    Rejection sampling: draw a pair, measure the route, keep it only at the
    target distance. Measuring is the expensive half, so the search stops as
    soon as it can, and a pair that is closer than the target is discarded
    rather than nudged, because nudging would bias every board towards the
    same well-connected corner of the graph.
    """
    pool = candidate_films(people, ranked)
    if len(pool) < 2:
        raise GameError(503, "the cast graph is too sparse to build a chain")

    # Position in the catalogue's fame ordering, so the route search can prefer
    # films a player has heard of and settle ties the same way every time.
    order = {film: index for index, film in enumerate(ranked)}

    for _ in range(MAX_ATTEMPTS):
        start, target = rng.sample(pool, 2)
        route = shortest_route(people, start, target, cap=TARGET_STEPS, order=order)
        if route is not None and len(route) == TARGET_STEPS:
            return Board(start=start, target=target, shortest=route)

    raise GameError(503, "could not find a playable chain; try again")


# --- round state -------------------------------------------------------------
#
# As in every other mode, the rules of a round live here rather than in the
# router: what state a round has, what a move does to it, and what it is worth
# at the end. None of it needs HTTP or a database to run.


@dataclass
class Round:
    """
    A chain in progress.

    Only the seed and the moves are stored. The board is a pure function of the
    seed, so it is rebuilt on demand, which is what makes a daily chain
    identical for everybody and means stored state can never disagree with the
    generator.
    """

    id: str
    seed: str | None
    started_at: datetime
    created_at: str
    #: The films walked so far, in order, each with the actor who carried you.
    moves: list[dict] = field(default_factory=list)
    gave_up: bool = False

    # -- derived -----------------------------------------------------

    def board(self, people: PeopleLike, ranked: list[str]) -> Board:
        """Rebuild this round's board. Deterministic for a given seed."""
        return build_board(people, ranked, random.Random(self.seed or self.id))

    def elapsed(self, now: datetime | None = None) -> int:
        """Seconds on the stopwatch, capped so a finished round stops counting."""
        seconds = ((now or datetime.now(UTC)) - self.started_at).total_seconds()
        return max(0, min(MAX_SECONDS, int(seconds)))

    @property
    def steps(self) -> int:
        return len(self.moves)

    @property
    def here(self) -> str | None:
        """The film currently stood on, or ``None`` meaning the start."""
        return self.moves[-1]["film_id"] if self.moves else None

    def solved(self, board: Board) -> bool:
        return self.here == board.target

    def ended_because(self, board: Board, now: datetime | None = None) -> str | None:
        """Why the round is over, or ``None`` while it is still in play."""
        if self.solved(board):
            return "solved"
        if self.gave_up:
            return "gave_up"
        if self.elapsed(now) >= MAX_SECONDS:
            return "time"
        return None

    def is_over(self, board: Board, now: datetime | None = None) -> bool:
        return self.ended_because(board, now) is not None

    # -- transitions -------------------------------------------------

    def move(self, people: PeopleLike, board: Board, film_id: str) -> str:
        """
        Step to a film that shares a cast member with the current one.

        Returns the actor who made the link, which is the part worth telling
        the player: the film they named is their answer, the actor is why it
        counted. Every rule that could refuse a move is checked here so the
        router never has to know any of them.
        """
        if self.is_over(board):
            raise GameError(409, "this chain is finished")

        current = self.here or board.start
        if film_id == current:
            raise GameError(400, "you are already on that film")
        if any(move["film_id"] == film_id for move in self.moves):
            raise GameError(409, "you have already been to that film")

        linking = shared_actors(people, current, film_id)
        if not linking:
            raise GameError(400, "no one in that film was in the one you are on")

        self.moves.append({"person_id": linking[0], "film_id": film_id})
        return linking[0]

    def give_up(self) -> None:
        """End the round without arriving."""
        self.gave_up = True


@dataclass(frozen=True, slots=True)
class Outcome:
    """A finished chain."""

    solved: bool
    steps: int
    par: int
    seconds: int
    ended: str
    #: The route the player walked.
    route: tuple[Step, ...]
    #: A shortest route, revealed at the end whether or not they found one.
    shortest: tuple[Step, ...]


def outcome(round_: Round, board: Board) -> Outcome:
    """
    Score a finished chain.

    Pure: given the same round and board it always returns the same result, so
    the API can compute it on demand rather than storing it.
    """
    return Outcome(
        solved=round_.solved(board),
        steps=round_.steps,
        par=board.par,
        seconds=round_.elapsed(),
        ended=round_.ended_because(board) or "time",
        route=tuple(Step(person_id=m["person_id"], film_id=m["film_id"]) for m in round_.moves),
        shortest=board.shortest,
    )


def leaderboard_key(entry: dict) -> tuple:
    """
    How finished chains are ranked.

    Solved first, because arriving is the point. Then fewest steps, because
    the route is the puzzle. Then fastest, which separates players who did the
    same thing. Sorting on a single blended number would let a fast bad route
    beat a slow good one, and those are not the same achievement.
    """
    return (not entry["solved"], entry["steps"], entry["seconds"])
