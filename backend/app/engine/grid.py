"""
The Co-star Grid (``app.engine.grid``): name a film two actors share.

Three actors down the side, three across the top, nine cells. Each cell wants
a film both its actors appeared in. Three minutes on the clock, or hand it in
early.

Design
------
**Every cell is answerable.** The grid is not sampled and then checked - it is
*searched for*, and a candidate is only accepted once all nine intersections
are known to share at least one film. A player should never lose a cell to a
pairing that never worked together.

**No grid is a giveaway.** The obvious failure is six actors who were all in
one ensemble: search unconstrained and you get a grid whose every cell is
*Interstellar*, which is a memory test with one answer.
:data:`MAX_CELLS_PER_FILM` caps how many cells a single film can satisfy, so
the board always asks about several different collaborations.

**Answers are graded, not just accepted.** Every pair's shared films are
pre-ordered by how well known they are (``pipeline.people_graph``). Naming the
collaboration people remember scores full marks; naming an obscure one they
also share still scores, but less. That rewards knowing the pair rather than
knowing one trivia answer, and it gives the reveal something to say: the
best-scoring film for each cell, which is the answer worth remembering.

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

# Board shape. Three by three is the size where every cell stays answerable
# from a catalog this dense; four by four needs a far larger co-star graph.
GRID_SIZE = 3

# How long a round lasts before the board locks itself.
ROUND_SECONDS = 180

# A single film may satisfy at most this many of the nine cells. Two allows a
# genuine "they were both in that" moment without letting one ensemble film
# answer the whole board.
MAX_CELLS_PER_FILM = 2

# Actors are drawn from the most recognisable slice of the co-star graph;
# below this the board becomes a trivia quiz about people nobody can picture.
CANDIDATE_POOL = 260

# Each actor on the board needs at least this many co-stars inside the
# candidate pool, or the search almost never closes.
MIN_DEGREE = 5

# Give up rather than hang if the graph cannot produce a board.
MAX_ATTEMPTS = 4_000


class PeopleLike(Protocol):
    """The slice of :class:`~app.data.people.PeopleCatalog` the grid needs."""

    actors: dict
    partners: dict[str, set[str]]

    def shared_films(self, left: str, right: str) -> tuple[str, ...]: ...
    def get(self, person_id: str): ...


@dataclass(frozen=True, slots=True)
class Board:
    """A validated grid: which actors, and the answer key behind each cell."""

    rows: tuple[str, ...]
    columns: tuple[str, ...]
    # (row index, column index) -> that pair's shared films, best known first.
    answers: dict[tuple[int, int], tuple[str, ...]]

    def films_for(self, row: int, column: int) -> tuple[str, ...]:
        return self.answers.get((row, column), ())


def candidate_actors(people: PeopleLike) -> list[str]:
    """
    The slice of the graph a board may be built from, most recognisable first.

    Reach is the ranking because a grid of unknown names is unplayable however
    well connected they are; the degree filter then drops anyone too isolated
    for the search to use.
    """
    ranked = sorted(people.actors.values(), key=lambda a: -a.fame)[:CANDIDATE_POOL]
    ids = {a.person_id for a in ranked}
    return [a.person_id for a in ranked if len(people.partners.get(a.person_id, set()) & ids) >= MIN_DEGREE]


def _film_spread_ok(answers: dict[tuple[int, int], tuple[str, ...]]) -> bool:
    """
    Reject a board any one film could answer too much of.

    Only each cell's *best* answer is counted: if one film is the top answer
    for three cells, the board reads as a single-film memory test even though
    other answers technically exist.
    """
    counts: dict[str, int] = {}
    for films in answers.values():
        counts[films[0]] = counts.get(films[0], 0) + 1
        if counts[films[0]] > MAX_CELLS_PER_FILM:
            return False
    return True


def build_board(people: PeopleLike, rng: random.Random) -> Board:
    """
    Search for a board where all nine cells are answerable and none is a giveaway.

    The search is rejection sampling with the expensive constraint checked
    first: pick the columns, intersect their partner sets to get the only rows
    that could possibly work, and only then look at film spread. Intersecting
    is what makes this converge in a handful of attempts rather than exploring
    a space of a few hundred cubed.
    """
    pool = candidate_actors(people)
    if len(pool) < GRID_SIZE * 2:
        raise GameError(503, "the co-star graph is too sparse to build a grid")

    for _ in range(MAX_ATTEMPTS):
        columns = rng.sample(pool, GRID_SIZE)
        # Only actors who worked with *every* column can be a row.
        eligible = set.intersection(*(people.partners.get(c, set()) for c in columns))
        eligible -= set(columns)
        if len(eligible) < GRID_SIZE:
            continue

        rows = rng.sample(sorted(eligible), GRID_SIZE)
        answers = {
            (r, c): people.shared_films(rows[r], columns[c])
            for r in range(GRID_SIZE)
            for c in range(GRID_SIZE)
        }
        if not all(answers.values()):  # pragma: no cover - guaranteed by the intersection
            continue
        if not _film_spread_ok(answers):
            continue
        return Board(rows=tuple(rows), columns=tuple(columns), answers=answers)

    raise GameError(503, "could not find a playable grid; try again")


def score_answer(board: Board, row: int, column: int, film_id: str) -> float:
    """
    Score a correct answer 0-100 by how well known that collaboration is.

    A pair's films are already ordered best-first, so the score is the entry's
    position in that list mapped onto the scale: their best-known film scores
    100, their most obscure shared film scores :data:`MIN_CELL_SCORE`. A pair
    with only one shared film scores 100 for it - there was nothing better to
    have named.
    """
    films = board.films_for(row, column)
    if film_id not in films:
        raise GameError(400, "those two were never in that film together")
    if len(films) == 1:
        return 100.0
    rank = films.index(film_id)
    share = 1.0 - rank / (len(films) - 1)
    return round(MIN_CELL_SCORE + (100.0 - MIN_CELL_SCORE) * share, 2)


# Naming any genuine collaboration is worth most of the marks; the ranking
# separates a good answer from the best one rather than deciding the round.
MIN_CELL_SCORE = 60.0


def best_answers(board: Board) -> dict[tuple[int, int], str]:
    """The top-scoring film for every cell — what the reveal shows."""
    return {cell: films[0] for cell, films in board.answers.items() if films}


# --- round state -------------------------------------------------------------
#
# Everything below is the *rules* of a round: what state a round has, what a
# player may do to it, and what it is worth at the end. It lives here rather
# than in the router for the reason the whole project is arranged around - the
# rules should be testable without an HTTP client or a database, and the API
# should be a translation layer with no opinions of its own.


@dataclass
class Round:
    """
    A grid in progress.

    Only the seed and the answers are stored. The board itself is a pure
    function of the seed, so it is rebuilt on demand rather than persisted -
    which is also what makes a daily board identical for every player and
    means a stored round can never disagree with the generator.
    """

    id: str
    seed: str | None
    started_at: datetime
    created_at: str
    #: ``"{row},{column}"`` -> the film named there and what it scored.
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

    def answer(self, people: PeopleLike, row: int, column: int, film_id: str) -> float:
        """
        Name a film for one cell and return what it scored.

        Every rule that could reject an answer is checked here so the router
        never has to know any of them:
        """
        if self.is_over():
            raise GameError(409, "this board is finished")
        if not (0 <= row < GRID_SIZE and 0 <= column < GRID_SIZE):
            raise GameError(400, "that cell is not on the board")
        if self.answer_at(row, column) is not None:
            raise GameError(409, "that cell is already answered")
        # One film per board: otherwise a single ensemble film could fill a
        # whole row, which is not the knowledge the mode is testing.
        if any(a["film_id"] == film_id for a in self.answers.values()):
            raise GameError(409, "you have already used that film")

        score = score_answer(self.board(people), row, column, film_id)
        self.answers[f"{row},{column}"] = {"film_id": film_id, "score": score}
        return score

    def hand_in(self) -> None:
        """End the round early."""
        self.handed_in = True


def total_score(answers: dict[str, dict]) -> float:
    """
    A board's total from its stored answers alone.

    The leaderboard has thousands of stored rounds and no reason to rebuild
    every board to add up nine numbers, so the sum lives here rather than
    being re-implemented in the router. ``outcome`` uses it too, which is what
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
    film_id: str | None
    score: float | None
    n_possible: int
    best_film_id: str
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
            films = board.films_for(row, column)
            found_best = bool(answer and answer["film_id"] == films[0])
            perfect = perfect and found_best
            cells.append(
                CellOutcome(
                    row=row,
                    column=column,
                    row_actor=people.get(board.rows[row]).name,
                    column_actor=people.get(board.columns[column]).name,
                    film_id=answer["film_id"] if answer else None,
                    score=answer["score"] if answer else None,
                    n_possible=len(films),
                    # Only the best answer is revealed, never the whole list:
                    # the point is the one worth remembering.
                    best_film_id=films[0],
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
