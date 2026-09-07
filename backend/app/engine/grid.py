"""
Six Degrees (``app.engine.grid``): name the actor who connects two others.

Three actors down the side, three across the top, nine cells. Each cell wants
a **third actor** who has appeared in a film with the row actor and, in some
other film, with the column actor — the Kevin Bacon move, one link at a time.
Three minutes on the clock, or hand it in early.

Design
------
**Every cell is comfortably answerable.** The board is searched for, not
sampled and then checked. A candidate is accepted only once all nine
intersections are known to have at least :data:`MIN_CONNECTORS` connecting
actors, so a player can never lose a cell to a pairing nothing bridges, nor to
one where only a single exact name would have done.

**The two header actors never worked together.** A pair who share a film makes
a poor puzzle: everyone else in that film connects them, so the cell answers
itself and the answer is not worth knowing. Boards are built only from pairs
with no direct credit together, which is what makes the missing middle worth
finding.

**No connector twice.** An actor may be played once per board. Without that
rule one hugely-connected name would answer most of the grid, and the round
would test a single piece of knowledge nine times.
:data:`MAX_CELLS_PER_CONNECTOR` goes further and rejects a board where the same
name is the *best* answer too often, since such a board reads as one question
repeated even when other answers technically exist.

That rule has a consequence worth stating: a board can have every cell
answerable on its own and still be impossible to *finish*, if the cells draw
on overlapping connectors and the ninth one has nothing left. Every board is
therefore checked for a complete assignment before it is dealt
(:func:`complete_fill`), so filling all nine is always achievable.

**Answers are graded, not just accepted.** A cell's connectors are ordered by
how well known they are. Naming the connection most people would reach for
scores full marks; finding an obscure actor who also bridges the pair still
scores, from a floor. That rewards knowing the neighbourhood rather than one
trivia answer, and it gives the reveal something to show: the best connector,
plus the two films that prove the link.

Determinism
-----------
Like the Oscars mode, the board comes from a seeded stream, so a daily grid is
the same board for everybody.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from app.engine.errors import GameError

# Board shape. Three by three is the size the co-star graph supports while
# keeping every cell answerable and every header pair unconnected.
GRID_SIZE = 3

# How long a round lasts before the board locks itself.
ROUND_SECONDS = 180

# How many cells one actor may be the *best* answer to. Two allows a genuine
# "oh, them again" moment without letting one well-connected name define the
# whole board.
MAX_CELLS_PER_CONNECTOR = 2

# Header actors are drawn from the most recognisable slice of the graph; below
# this the board becomes a quiz about people nobody can picture.
CANDIDATE_POOL = 260

# Each header needs at least this many co-stars inside the candidate pool, or
# the search almost never closes.
MIN_DEGREE = 5

# Connectors kept per cell. The tail of a large intersection is walk-on parts
# nobody would name, and keeping it would flatten the scoring gradient.
MAX_CONNECTORS = 40

# Connectors a cell must have before the board is accepted. One is technically
# answerable but unfair: with a roster this size, needing the single exact name
# is a guess rather than a deduction. Three leaves the player several routes
# through, and the graph supplies it cheaply - the search still closes in a few
# hundred attempts, against a few dozen with no floor at all.
MIN_CONNECTORS = 3

# Naming any genuine connection is worth most of the marks; the ranking
# separates a good answer from the best one rather than deciding the round.
MIN_CELL_SCORE = 60.0

# Give up rather than hang if the graph cannot produce a board.
MAX_ATTEMPTS = 6_000


class PeopleLike(Protocol):
    """The slice of :class:`~app.data.people.PeopleCatalog` the grid needs."""

    actors: dict
    partners: dict[str, set[str]]

    def shared_films(self, left: str, right: str) -> tuple[str, ...]: ...
    def have_worked_together(self, left: str, right: str) -> bool: ...
    def get(self, person_id: str): ...


@dataclass(frozen=True, slots=True)
class Board:
    """A validated grid: the six header actors, and the answer key per cell."""

    rows: tuple[str, ...]
    columns: tuple[str, ...]
    #: (row index, column index) -> connecting actors, best known first.
    answers: dict[tuple[int, int], tuple[str, ...]]

    def connectors_for(self, row: int, column: int) -> tuple[str, ...]:
        return self.answers.get((row, column), ())

    @property
    def header_ids(self) -> set[str]:
        return set(self.rows) | set(self.columns)


def connectors(people: PeopleLike, left: str, right: str, exclude: set[str] = frozenset()) -> list[str]:
    """
    Actors who have worked with both ``left`` and ``right``, best known first.

    The whole puzzle is one set intersection: the co-stars of one, met with the
    co-stars of the other. ``exclude`` keeps the board's own header actors out
    of the answer key, because answering one header with another is a different
    and much cheaper question.
    """
    shared = (people.partners.get(left, set()) & people.partners.get(right, set())) - set(exclude)
    ranked = sorted(shared, key=lambda person: -people.get(person).fame)
    return ranked[:MAX_CONNECTORS]


def candidate_actors(people: PeopleLike) -> list[str]:
    """
    The slice of the graph a board's headers may be drawn from.

    Ranked by reach, because a grid of unrecognisable names is unplayable
    however well connected they are; then filtered by degree, because an actor
    with few co-stars inside the pool rarely completes a board.
    """
    ranked = sorted(people.actors.values(), key=lambda actor: -actor.fame)[:CANDIDATE_POOL]
    ids = {actor.person_id for actor in ranked}
    return [
        actor.person_id
        for actor in ranked
        if len(people.partners.get(actor.person_id, set()) & ids) >= MIN_DEGREE
    ]


def _spread_ok(answers: dict[tuple[int, int], tuple[str, ...]]) -> bool:
    """
    Reject a board one name could define.

    Only each cell's *best* answer is counted: if one actor tops three cells the
    board reads as a single question asked repeatedly, even though other
    connectors exist underneath.
    """
    counts: dict[str, int] = {}
    for ranked in answers.values():
        counts[ranked[0]] = counts.get(ranked[0], 0) + 1
        if counts[ranked[0]] > MAX_CELLS_PER_CONNECTOR:
            return False
    return True


def complete_fill(answers: dict[tuple[int, int], tuple[str, ...]]) -> dict[tuple[int, int], str] | None:
    """
    An assignment of one distinct connector to every cell, or ``None``.

    Because a connector may only be played once, "every cell is answerable" is
    not the same as "the board can be finished": nine cells drawing on an
    overlapping handful of connectors can strand the last one. That is the
    classic bipartite matching question - cells on one side, actors on the
    other - and it is answered here by augmenting paths, which is small enough
    to read and far faster than the search that calls it.

    Returning the assignment rather than a yes/no keeps it useful: the tests
    fill a board with it, and it proves the answer instead of asserting it.
    """
    cells = sorted(answers)
    taken: dict[str, tuple[int, int]] = {}  # connector -> the cell holding it

    def assign(cell: tuple[int, int], seen: set[str]) -> bool:
        """Place ``cell``, bumping an earlier cell onto another actor if need be."""
        for person in answers[cell]:
            if person in seen:
                continue
            seen.add(person)
            if person not in taken or assign(taken[person], seen):
                taken[person] = cell
                return True
        return False

    for cell in cells:
        if not assign(cell, set()):
            return None
    return {cell: person for person, cell in taken.items()}


def build_board(people: PeopleLike, rng: random.Random) -> Board:
    """
    Search for a board where every cell has several connectors and no header
    pair worked together directly.

    Rejection sampling with the cheapest test first: draw six actors, throw the
    board out immediately if any header pair share a credit, then do the nine
    set intersections that prove each cell is answerable, and only then run the
    matching that proves the board can be finished. Ordering the checks that
    way is what makes the search converge in a few hundred attempts rather than
    exploring a space of a few hundred to the sixth.
    """
    pool = candidate_actors(people)
    if len(pool) < GRID_SIZE * 2:
        raise GameError(503, "the co-star graph is too sparse to build a grid")

    for _ in range(MAX_ATTEMPTS):
        picked = rng.sample(pool, GRID_SIZE * 2)
        rows, columns = tuple(picked[:GRID_SIZE]), tuple(picked[GRID_SIZE:])

        # A header pair who already share a film makes a cell answer itself.
        if any(people.have_worked_together(r, c) for r in rows for c in columns):
            continue

        headers = set(rows) | set(columns)
        answers: dict[tuple[int, int], tuple[str, ...]] = {}
        for row_index, row in enumerate(rows):
            for column_index, column in enumerate(columns):
                found = connectors(people, row, column, exclude=headers)
                if len(found) < MIN_CONNECTORS:
                    break
                answers[(row_index, column_index)] = tuple(found)
            else:
                continue
            break  # that row had a dead cell; abandon the whole board
        else:
            # Cheap rejection first, then the matching, which is the expensive
            # one and the only check that looks at the board as a whole.
            if _spread_ok(answers) and complete_fill(answers) is not None:
                return Board(rows=rows, columns=columns, answers=answers)

    raise GameError(503, "could not find a playable grid; try again")


def score_answer(board: Board, row: int, column: int, person_id: str) -> float:
    """
    Score a correct connection 0-100 by how well known the connector is.

    A cell's connectors are already ordered best-first, so the score is the
    entry's position in that list mapped onto the scale: the name most people
    would reach for scores 100, the most obscure working answer scores
    :data:`MIN_CELL_SCORE`. A cell with a single connector scores 100 for it —
    there was nothing better to have found.
    """
    ranked = board.connectors_for(row, column)
    if person_id not in ranked:
        raise GameError(400, "that actor does not connect those two")
    if len(ranked) == 1:
        return 100.0
    position = ranked.index(person_id)
    share = 1.0 - position / (len(ranked) - 1)
    return round(MIN_CELL_SCORE + (100.0 - MIN_CELL_SCORE) * share, 2)


def link_films(people: PeopleLike, connector: str, row: str, column: str) -> tuple[str, str]:
    """
    The two films that make a connection real: with the row actor, then with
    the column actor.

    Shown in the reveal, because a name on its own is an assertion — the pair
    of films is the proof, and the part actually worth remembering. Each side
    takes that pair's best-known film, since ``shared_films`` is pre-ordered.
    """
    return (
        people.shared_films(connector, row)[0],
        people.shared_films(connector, column)[0],
    )


# --- round state -------------------------------------------------------------
#
# Everything below is the *rules* of a round: what state a round has, what a
# player may do to it, and what it is worth at the end. It lives here rather
# than in the router for the reason the whole project is arranged around — the
# rules should be testable without an HTTP client or a database, and the API
# should be a translation layer with no opinions of its own.


@dataclass
class Round:
    """
    A grid in progress.

    Only the seed and the answers are stored. The board itself is a pure
    function of the seed, so it is rebuilt on demand rather than persisted —
    which is also what makes a daily board identical for every player and means
    a stored round can never disagree with the generator.
    """

    id: str
    seed: str | None
    started_at: datetime
    created_at: str
    #: ``"{row},{column}"`` -> the connector named there and what it scored.
    answers: dict[str, dict] = field(default_factory=dict)
    handed_in: bool = False

    # -- derived -----------------------------------------------------

    def board(self, people: PeopleLike) -> Board:
        """Rebuild this round's board. Deterministic for a given seed."""
        return build_board(people, random.Random(self.seed or self.id))

    def seconds_remaining(self, now: datetime | None = None) -> int:
        elapsed = ((now or datetime.now(UTC)) - self.started_at).total_seconds()
        return max(0, int(ROUND_SECONDS - elapsed))

    @property
    def is_full(self) -> bool:
        return len(self.answers) == GRID_SIZE**2

    def is_over(self, now: datetime | None = None) -> bool:
        """A round ends when it is handed in, filled, or the clock runs out."""
        return self.handed_in or self.is_full or self.seconds_remaining(now) == 0

    def answer_at(self, row: int, column: int) -> dict | None:
        return self.answers.get(f"{row},{column}")

    # -- transitions -------------------------------------------------

    def answer(self, people: PeopleLike, row: int, column: int, person_id: str) -> float:
        """
        Name a connecting actor for one cell and return what it scored.

        Every rule that could reject an answer is checked here, so the router
        never has to know any of them.
        """
        if self.is_over():
            raise GameError(409, "this board is finished")
        if not (0 <= row < GRID_SIZE and 0 <= column < GRID_SIZE):
            raise GameError(400, "that cell is not on the board")
        if self.answer_at(row, column) is not None:
            raise GameError(409, "that cell is already answered")
        # One connector per board: otherwise a single well-connected name could
        # fill a whole row, which is not the knowledge the mode is testing.
        if any(a["person_id"] == person_id for a in self.answers.values()):
            raise GameError(409, "you have already used that actor")

        score = score_answer(self.board(people), row, column, person_id)
        self.answers[f"{row},{column}"] = {"person_id": person_id, "score": score}
        return score

    def hand_in(self) -> None:
        """End the round early."""
        self.handed_in = True


def total_score(answers: dict[str, dict]) -> float:
    """
    A board's total from its stored answers alone.

    The leaderboard has many stored rounds and no reason to rebuild every board
    to add up nine numbers, so the sum lives here rather than being
    re-implemented in the router. :func:`outcome` uses it too, which is what
    guarantees the two can never disagree about what a board scored.
    """
    return round(sum(answer["score"] for answer in answers.values()), 2)


def was_completed(answers: dict[str, dict], handed_in: bool) -> bool:
    """Whether a stored round is finished, without needing its clock."""
    return handed_in or len(answers) == GRID_SIZE**2


@dataclass(frozen=True, slots=True)
class CellOutcome:
    """One cell after the reveal."""

    row: int
    column: int
    row_actor: str
    column_actor: str
    person_id: str | None
    score: float | None
    n_possible: int
    best_person_id: str
    #: The two films proving the best connection: with the row, with the column.
    best_link_films: tuple[str, str]
    found_best: bool


@dataclass(frozen=True, slots=True)
class Outcome:
    """A finished round, scored."""

    filled: int
    total: int
    score: float
    perfect: bool
    cells: tuple[CellOutcome, ...]


def outcome(round_: Round, people: PeopleLike) -> Outcome:
    """
    Score a finished round.

    Pure: given the same round and catalog it always returns the same result,
    so the API can compute it on demand instead of storing it.
    """
    board = round_.board(people)
    cells: list[CellOutcome] = []
    perfect = True

    for row in range(GRID_SIZE):
        for column in range(GRID_SIZE):
            answer = round_.answer_at(row, column)
            ranked = board.connectors_for(row, column)
            best = ranked[0]
            found_best = bool(answer and answer["person_id"] == best)
            perfect = perfect and found_best
            cells.append(
                CellOutcome(
                    row=row,
                    column=column,
                    row_actor=people.get(board.rows[row]).name,
                    column_actor=people.get(board.columns[column]).name,
                    person_id=answer["person_id"] if answer else None,
                    score=answer["score"] if answer else None,
                    n_possible=len(ranked),
                    # Only the best connection is revealed, never the whole
                    # list: the point is the one worth remembering.
                    best_person_id=best,
                    best_link_films=link_films(people, best, board.rows[row], board.columns[column]),
                    found_best=found_best,
                )
            )

    return Outcome(
        filled=len(round_.answers),
        total=GRID_SIZE**2,
        score=total_score(round_.answers),
        perfect=perfect,
        cells=tuple(cells),
    )
