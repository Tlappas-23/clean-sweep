"""
Co-star Grid routes (``app.api.grid``).

Architecture note
-----------------
Thin by design, like every router here. The rules live in
``app.engine.grid``: what a round is, whether an answer is legal, what it
scores and what the finished board is worth. This module does four things and
nothing else — load the stored round, hand it to the engine, save whatever
comes back, and convert the result to the wire shapes.

The board itself is never stored. It is a pure function of the round's seed,
so ``Round.board()`` rebuilds it whenever it is needed; that is what makes a
daily board identical for everyone and makes it impossible for stored state to
disagree with the generator.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Query

from app.api.deps import CatalogDep, PeopleDep, SideRepositoryDep, new_id, require_people, to_http, utc_iso
from app.data.catalog import film_card
from app.data.people import actor_card
from app.engine import grid as engine
from app.engine.errors import GameError
from app.models.grid import GridAnswerRequest, GridCell, GridCellResult, GridResults, GridState
from app.models.people import FilmCard

router = APIRouter(prefix="/api/grid", tags=["co-star grid"])

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
def _present(round_: engine.Round, catalog, people) -> GridState:
    """The round as the client sees it: the board, the clock, and what is filled in."""
    board = round_.board(people)
    return GridState(
        id=round_.id,
        seed=round_.seed,
        # The clock is authoritative: a board whose time is gone is finished
        # whether or not the client ever said so.
        status="complete" if round_.is_over() else "playing",
        rows=[actor_card(people.get(a)) for a in board.rows],
        columns=[actor_card(people.get(a)) for a in board.columns],
        cells=[
            GridCell(
                row=row,
                column=column,
                film=film_card(catalog.film(answer["film_id"])) if answer else None,
                score=answer["score"] if answer else None,
            )
            for row in range(engine.GRID_SIZE)
            for column in range(engine.GRID_SIZE)
            for answer in [round_.answer_at(row, column)]
        ],
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
                film=film_card(catalog.film(cell.film_id)) if cell.film_id else None,
                score=cell.score,
                n_possible=cell.n_possible,
                best_answer=film_card(catalog.film(cell.best_film_id)),
                found_best=cell.found_best,
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


@router.get("/games/{game_id}/search", response_model=list[FilmCard])
def search(
    game_id: str,
    catalog: CatalogDep,
    people: PeopleDep,
    repo: SideRepositoryDep,
    q: str = Query(min_length=2, max_length=64),
    limit: int = Query(default=12, ge=1, le=40),
) -> list[FilmCard]:
    """
    Films matching a title fragment, for the answer box.

    Searches the whole catalog rather than only the valid answers on purpose: a
    player should be able to name a wrong film and be told it is wrong, which
    is the feedback that makes a round teach you something.
    """
    require_people(people)
    repo.load(KIND, game_id)  # 404s an unknown game before doing any work
    return [film_card(record) for record in catalog.search_films(q, limit)]


@router.post("/games/{game_id}/answer", response_model=GridState)
def answer(
    game_id: str,
    body: GridAnswerRequest,
    people: PeopleDep,
    catalog: CatalogDep,
    repo: SideRepositoryDep,
) -> GridState:
    """Name a film for one cell. The engine decides whether it counts."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    try:
        round_.answer(people, body.row, body.column, body.film_id)
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
    """Score a finished board and reveal each cell's best answer."""
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
