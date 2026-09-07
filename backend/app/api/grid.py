"""
Six Degrees routes (``app.api.grid``).

Architecture note
-----------------
Thin by design, like every router here. The rules live in ``app.engine.grid``:
what a round is, whether a connection is legal, what it scores and what the
finished board is worth. This module does four things and nothing else — load
the stored round, hand it to the engine, save whatever comes back, and convert
the result to the wire shapes.

The board itself is never stored. It is a pure function of the round's seed, so
``Round.board()`` rebuilds it whenever it is needed; that is what makes a daily
board identical for everyone and makes it impossible for stored state to
disagree with the generator.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Query

from app.api.deps import (
    CatalogDep,
    PeopleDep,
    SideRepositoryDep,
    new_id,
    require_people,
    to_http,
    utc_iso,
)
from app.data.catalog import film_card
from app.data.people import actor_card
from app.engine import grid as engine
from app.engine.errors import GameError
from app.models.grid import (
    GridAnswerRequest,
    GridCell,
    GridCellResult,
    GridLink,
    GridResults,
    GridState,
)

router = APIRouter(prefix="/api/grid", tags=["six degrees"])

KIND = "grid"


# --- state <-> storage -------------------------------------------------------
def _to_round(state: dict) -> engine.Round:
    """Rehydrate the engine's round from the stored JSON."""
    return engine.Round(
        id=state["id"],
        seed=state["seed"],
        started_at=datetime.fromisoformat(state["started_at"]),
        created_at=state["created_at"],
        answers=state["answers"],
        handed_in=state.get("handed_in", False),
    )


def _to_state(round_: engine.Round) -> dict:
    """The JSON form. Only seed and decisions - the board is derived."""
    return {
        "id": round_.id,
        "seed": round_.seed,
        "started_at": round_.started_at.isoformat(),
        "created_at": round_.created_at,
        "answers": round_.answers,
        "handed_in": round_.handed_in,
    }


# --- presentation ------------------------------------------------------------
def _link(link: engine.Link, catalog, people) -> GridLink:
    """An engine link — ids and a score — as the cards the client draws."""
    return GridLink(
        actor=actor_card(people.get(link.person_id)),
        films=[film_card(catalog.film(f)) for f in link.films],
        score=link.score,
    )


def _present(round_: engine.Round, catalog, people) -> GridState:
    """The round as the client sees it: the board, the clock, and what is filled in."""
    board = round_.board(people)

    def cell(row: int, column: int) -> GridCell:
        answer = round_.answer_at(row, column)
        if answer is None:
            return GridCell(row=row, column=column)
        # A correct answer carries its own proof from the moment it lands, so
        # the board itself shows why the name counted rather than making the
        # player wait for the reveal to find out.
        played = engine.Link(
            person_id=answer["person_id"],
            films=engine.link_films(people, answer["person_id"], board.rows[row], board.columns[column]),
            score=answer["score"],
        )
        return GridCell(row=row, column=column, link=_link(played, catalog, people))

    return GridState(
        id=round_.id,
        seed=round_.seed,
        # The clock is authoritative: a board whose time is gone is finished
        # whether or not the client ever said so.
        status="complete" if round_.is_over() else "playing",
        rows=[actor_card(people.get(a)) for a in board.rows],
        columns=[actor_card(people.get(a)) for a in board.columns],
        cells=[cell(r, c) for r in range(engine.GRID_SIZE) for c in range(engine.GRID_SIZE)],
        seconds_remaining=round_.seconds_remaining(),
        round_seconds=engine.ROUND_SECONDS,
        created_at=round_.created_at,
    )


def _present_results(round_: engine.Round, catalog, people) -> GridResults:
    scored = engine.outcome(round_, people)
    return GridResults(
        game=_present(round_, catalog, people),
        filled=scored.filled,
        total=scored.total,
        score=scored.score,
        perfect=scored.perfect,
        cells=[
            GridCellResult(
                row=cell.row,
                column=cell.column,
                row_actor=cell.row_actor,
                column_actor=cell.column_actor,
                played=_link(cell.played, catalog, people) if cell.played else None,
                n_possible=cell.n_possible,
                # Both ends of the range, never the list between them.
                obvious=_link(cell.obvious, catalog, people),
                rarest=_link(cell.rarest, catalog, people),
                found_rarest=cell.found_rarest,
            )
            for cell in scored.cells
        ],
    )


# --- routes ------------------------------------------------------------------
@router.post("/games", response_model=GridState, status_code=201)
def create_game(
    people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep, seed: str | None = None
) -> GridState:
    """Start a board. Pass ``seed`` (a date) for the shared daily grid."""
    require_people(people)
    round_ = engine.Round(
        id=new_id(),
        seed=seed,
        started_at=datetime.now(UTC),
        created_at=utc_iso(),
    )
    try:
        round_.board(people)  # fail before storing if the graph cannot serve one
    except GameError as exc:
        raise to_http(exc) from exc

    repo.create(KIND, round_.id, seed, _to_state(round_))
    return _present(round_, catalog, people)


@router.get("/games/{game_id}", response_model=GridState)
def get_game(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> GridState:
    require_people(people)
    return _present(_to_round(repo.load(KIND, game_id)), catalog, people)


@router.post("/games/{game_id}/answer", response_model=GridState)
def answer(
    game_id: str,
    body: GridAnswerRequest,
    people: PeopleDep,
    catalog: CatalogDep,
    repo: SideRepositoryDep,
) -> GridState:
    """
    Name a connecting actor for one cell, by typing their name.

    Two steps, and they fail differently. First the typed name is resolved to
    a real actor, which forgives spelling but refuses to guess between two
    people of similar name. Only then does the engine rule on whether that
    actor actually connects the pair — so "I cannot find who you mean" and
    "that is the wrong person" stay separate answers, because they ask the
    player for different things.
    """
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))

    resolved = people.resolve_actor(body.name)
    if resolved.actor is None:
        raise to_http(
            GameError(
                400,
                "several actors share that name; type it in full"
                if resolved.ambiguous
                else "no actor in the catalog goes by that name",
            )
        )

    try:
        round_.answer(people, body.row, body.column, resolved.actor.person_id)
    except GameError as exc:
        raise to_http(exc) from exc

    repo.save(game_id, _to_state(round_))
    return _present(round_, catalog, people)


@router.post("/games/{game_id}/complete", response_model=GridResults)
def complete(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> GridResults:
    """Hand the board in early."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    round_.hand_in()
    repo.save(game_id, _to_state(round_))
    return _present_results(round_, catalog, people)


@router.get("/games/{game_id}/results", response_model=GridResults)
def results(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> GridResults:
    """Score a finished board and reveal each cell's best connection."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    if not round_.is_over():
        raise to_http(GameError(409, "the board is still in play"))
    return _present_results(round_, catalog, people)


@router.get("/leaderboard", response_model=list[dict])
def leaderboard(repo: SideRepositoryDep, limit: int = Query(default=20, ge=1, le=100)) -> list[dict]:
    """Completed boards, best score first."""
    entries = [
        {
            "id": game_id,
            "seed": seed,
            "filled": len(state["answers"]),
            "score": engine.total_score(state["answers"]),
            "created_at": created_at,
        }
        for game_id, seed, state, created_at in repo.recent(KIND, limit * 4)
        if engine.was_completed(state["answers"], state.get("handed_in", False))
    ]
    entries.sort(key=lambda entry: -entry["score"])
    return entries[:limit]
