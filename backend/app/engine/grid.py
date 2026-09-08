"""
Six Degrees (``app.engine.grid``): name the actor who connects two others.

Three actors down the side, three across the top, nine cells. Each cell wants
a **third actor** who has appeared in a film with the row actor and, in some
other film, with the column actor. It is the Kevin Bacon move, one link at a
time. Three minutes on the clock, or hand it in early.

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
on overlapping connectors and the ninth one has nothing left. It is settled
by requiring the nine *rarest* connectors to be nine different people
(:func:`rarest_are_distinct`), which is a stronger guarantee than mere
fillability and the one the scoring actually needs: playing the rarest in
every cell is both a legal complete board and a perfect 900, so full marks are
always reachable rather than accidentally locked away by a collision.

**The rarer the link, the more it is worth.** A cell's connectors are ordered
by how well known they are, and the score runs *against* that order: the name
most people would reach for is worth the floor, and the most obscure actor who
genuinely bridges the pair is worth full marks. Everyone who knows the mode
can find the obvious route, so paying the same for it as for a deep cut would
make the scale say nothing. What is being measured is how far into a
filmography you can see.

The reveal therefore shows both ends: the connection most people would name,
and the one that was worth 100. Each comes with the two films that prove it.
One is the answer worth remembering; the other is the answer worth points, and
a player needs to see both to know what they left on the table.

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

# What the most obvious connection is worth. Naming any genuine link still
# earns most of the marks. The ranking separates a good answer from a rare one
# rather than deciding the round on its own.
MIN_CELL_SCORE = 60.0

# What a cell costs once hints have been taken on it, indexed by how many.
#
# A cell has two sides, so there are two hints available and three states. The
# costs rise faster than they need to: one hint is meant to be a reasonable
# trade when a player already has half the answer, and two is meant to feel
# like giving up on the cell. Taking both and then naming the obvious
# connector leaves 25 of a possible 100, which is worth more than an empty
# square and much less than solving it.
HINT_COSTS: tuple[float, ...] = (0.0, 15.0, 35.0)

# Give up rather than hang if the graph cannot produce a board. A board is
# found in a few hundred attempts on average, so this is roughly thirty times
# the mean. That is high enough that an unlucky seed still gets served, and low
# enough that a graph which genuinely cannot produce a board says so in well
# under a second rather than spinning.
MAX_ATTEMPTS = 20_000


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

    Only each cell's *obvious* answer is counted here, because that is the one
    a player actually reaches for: if the same name is the first thought on
    three cells, the board plays as a single question asked repeatedly. The
    other end of the ranking is governed by :func:`rarest_are_distinct`, which
    is a stricter rule for a different reason.
    """
    counts: dict[str, int] = {}
    for ranked in answers.values():
        counts[ranked[0]] = counts.get(ranked[0], 0) + 1
        if counts[ranked[0]] > MAX_CELLS_PER_CONNECTOR:
            return False
    return True


def rarest_are_distinct(answers: dict[tuple[int, int], tuple[str, ...]]) -> bool:
    """
    Whether the nine highest-scoring answers are nine different people.

    This is the rule that makes a perfect board possible. A connector may only
    be played once, so if the same actor were the rarest link for two cells,
    one of them could never be answered for full marks and 900 would be
    unreachable through no fault of the player. Requiring the nine to differ
    also guarantees the board can be *filled* at all, since the rarest of each
    cell is itself a complete assignment. It stops the reveal printing one name
    three times as well.
    """
    rarest = [ranked[-1] for ranked in answers.values()]
    return len(set(rarest)) == len(rarest)


def build_board(people: PeopleLike, rng: random.Random) -> Board:
    """
    Search for a board where every cell has several connectors and no header
    pair worked together directly.

    Rejection sampling with the cheapest test first: draw six actors, throw the
    board out immediately if any header pair share a credit, then do the nine
    set intersections that prove each cell is answerable, and only then the two
    whole-board rules. Ordering the checks that way is what makes the search
    converge in a few hundred attempts rather than exploring a space of a few
    hundred to the sixth.
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
            # Both of these look at the board as a whole rather than a cell,
            # so they run last.
            if _spread_ok(answers) and rarest_are_distinct(answers):
                return Board(rows=rows, columns=columns, answers=answers)

    raise GameError(503, "could not find a playable grid; try again")


def score_answer(board: Board, row: int, column: int, person_id: str) -> float:
    """
    Score a correct connection 0-100 by how *obscure* the connector is.

    A cell's connectors are ordered best-known first, and the score runs
    against that order: the name most people would reach for is worth
    :data:`MIN_CELL_SCORE`, and the least famous actor who genuinely bridges
    the pair is worth 100. Rarity is the thing being paid for, because the
    obvious route is available to anyone who can name the pair at all.

    A cell with a single connector scores 100 for it. The only route through
    is also the rarest, and there was nothing else to have found.
    """
    ranked = board.connectors_for(row, column)
    if person_id not in ranked:
        raise GameError(400, "that actor does not connect those two")
    if len(ranked) == 1:
        return 100.0
    # Position 0 is the most famous, so the share of the scale earned rises
    # with the index rather than falling.
    share = ranked.index(person_id) / (len(ranked) - 1)
    return round(MIN_CELL_SCORE + (100.0 - MIN_CELL_SCORE) * share, 2)


def hint_film(people: PeopleLike, board: Board, row: int, column: int, side: str) -> str:
    """
    The film a hint reveals for one side of a cell.

    Deliberately drawn from the cell's *lowest-scoring* connector, which is the
    best-known one. A hint should open the door to the obvious route through,
    not hand over the rare answer that the scoring is there to reward: a player
    who pays for a hint and is given the 100-point name has not been helped,
    they have been given the cell.

    ``side`` is "row" or "column", naming which header the revealed film links
    the connector to.
    """
    ranked = board.connectors_for(row, column)
    if not ranked:  # pragma: no cover - build_board guarantees connectors
        raise GameError(503, "that cell has no connectors to hint at")
    obvious = ranked[0]
    header = board.rows[row] if side == "row" else board.columns[column]
    shared = people.shared_films(obvious, header)
    if not shared:  # pragma: no cover - a connector shares a film by definition
        raise GameError(503, "that hint has no film behind it")
    return shared[0]


def hint_penalty(taken: int) -> float:
    """What a cell is docked for the hints already taken on it."""
    return HINT_COSTS[min(taken, len(HINT_COSTS) - 1)]


def link_films(people: PeopleLike, connector: str, row: str, column: str) -> tuple[str, str]:
    """
    The two films that make a connection real: with the row actor, then with
    the column actor.

    Shown in the reveal, because a name on its own is an assertion. The pair
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
# than in the router for the reason the whole project is arranged around: the
# rules should be testable without an HTTP client or a database, and the API
# should be a translation layer with no opinions of its own.


@dataclass
class Round:
    """
    A grid in progress.

    Only the seed and the answers are stored. The board itself is a pure
    function of the seed, so it is rebuilt on demand rather than persisted.
    That is also what makes a daily board identical for every player, and it
    means a stored round can never disagree with the generator.
    """

    id: str
    seed: str | None
    started_at: datetime
    created_at: str
    #: ``"{row},{column}"`` -> the connector named there and what it scored.
    answers: dict[str, dict] = field(default_factory=dict)
    #: ``"{row},{column}"`` -> the sides hinted, in the order they were taken.
    #: Stored rather than derived because it is a decision the player made, and
    #: because the cell's score has to remember it was paid for.
    hints: dict[str, list[str]] = field(default_factory=dict)
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

    def hints_at(self, row: int, column: int) -> list[str]:
        return self.hints.get(f"{row},{column}", [])

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

        # The hints taken on this cell are already paid for, so they come off
        # whatever the answer turns out to be worth. Never below zero: a hinted
        # right answer is still worth more than an empty square.
        earned = score_answer(self.board(people), row, column, person_id)
        score = max(0.0, round(earned - hint_penalty(len(self.hints_at(row, column))), 2))
        self.answers[f"{row},{column}"] = {"person_id": person_id, "score": score}
        return score

    def take_hint(self, people: PeopleLike, row: int, column: int, side: str) -> str:
        """
        Buy a hint for one side of a cell and return the film it reveals.

        Every rule that could refuse a hint is checked here, so the router
        never has to know any of them.
        """
        if self.is_over():
            raise GameError(409, "this board is finished")
        if not (0 <= row < GRID_SIZE and 0 <= column < GRID_SIZE):
            raise GameError(400, "that cell is not on the board")
        if side not in ("row", "column"):
            raise GameError(400, "a hint is for the 'row' side or the 'column' side")
        if self.answer_at(row, column) is not None:
            raise GameError(409, "that cell is already answered")

        key = f"{row},{column}"
        taken = self.hints.setdefault(key, [])
        if side in taken:
            # Charging twice for the same film would be a bug the player pays
            # for, so asking again is free and simply returns it.
            return hint_film(people, self.board(people), row, column, side)

        film = hint_film(people, self.board(people), row, column, side)
        taken.append(side)
        return film

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
class Link:
    """
    One route through a cell: who, which two films, and what it is worth.

    The films are always a pair, ordered the way the chain reads: the film
    shared with the row actor, then the film shared with the column actor.
    Bundling them with the person and the score keeps the three from being
    reassembled, in a different order, by every caller that wants to show a
    connection.
    """

    person_id: str
    films: tuple[str, str]
    score: float


@dataclass(frozen=True, slots=True)
class CellOutcome:
    """
    One cell after the reveal.

    Three links, and they answer different questions. ``played`` is what the
    player put there, or ``None``. ``obvious`` is the connection most people
    would name, which is the one worth remembering and the one worth the
    fewest points. ``rarest`` is the deepest cut that still works, which is
    what a full 100 required. On a cell with a single connector the last two
    are the same person, and the caller is expected to notice rather than be
    told twice.
    """

    row: int
    column: int
    row_actor: str
    column_actor: str
    played: Link | None
    n_possible: int
    obvious: Link
    rarest: Link
    found_rarest: bool


@dataclass(frozen=True, slots=True)
class Outcome:
    """A finished round, scored. ``perfect`` means every cell took the rarest route."""

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

    Only two of a cell's connectors are ever revealed, the obvious one and the
    rarest, never the list in between. A wall of every actor who happens
    to bridge a pair teaches nothing; the two ends of the range say what the
    cell was worth and what it was for.
    """
    board = round_.board(people)
    cells: list[CellOutcome] = []
    perfect = True

    for row in range(GRID_SIZE):
        for column in range(GRID_SIZE):
            row_id, column_id = board.rows[row], board.columns[column]
            ranked = board.connectors_for(row, column)
            answer = round_.answer_at(row, column)

            def make(person_id: str, score: float, r=row_id, c=column_id) -> Link:
                return Link(person_id, link_films(people, person_id, r, c), score)

            rarest = make(ranked[-1], score_answer(board, row, column, ranked[-1]))
            found_rarest = bool(answer and answer["person_id"] == rarest.person_id)
            perfect = perfect and found_rarest

            cells.append(
                CellOutcome(
                    row=row,
                    column=column,
                    row_actor=people.get(row_id).name,
                    column_actor=people.get(column_id).name,
                    played=make(answer["person_id"], answer["score"]) if answer else None,
                    n_possible=len(ranked),
                    obvious=make(ranked[0], score_answer(board, row, column, ranked[0])),
                    rarest=rarest,
                    found_rarest=found_rarest,
                )
            )

    return Outcome(
        filled=len(round_.answers),
        total=GRID_SIZE**2,
        score=total_score(round_.answers),
        perfect=perfect,
        cells=tuple(cells),
    )
