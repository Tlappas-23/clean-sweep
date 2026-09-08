"""
The Chain routes (``app.api.chain``).

Architecture note
-----------------
Thin by design, like every router here. ``app.engine.chain`` owns what a round
is, whether a move is legal, when it ends and what it is worth. This module
loads the stored round, hands it to the engine, saves whatever comes back, and
converts the result to the wire shapes.

The board is never stored. It is a pure function of the round's seed, so
``Round.board()`` rebuilds it whenever it is needed, which is what makes a
daily chain identical for everyone and makes it impossible for stored state to
disagree with the generator.

The endpoints in play never carry the shortest route. ``ChainState`` has no
field for it, which is the structural reason the answer cannot leak while the
stopwatch is running.
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
from app.engine import chain as engine
from app.engine.errors import GameError
from app.models.chain import (
    ChainLeaderboardEntry,
    ChainMoveRequest,
    ChainResults,
    ChainState,
    ChainStep,
)
from app.models.people import FilmCard

router = APIRouter(prefix="/api/chain", tags=["the chain"])

KIND = "chain"


# --- state <-> storage -------------------------------------------------------
def _to_round(state: dict) -> engine.Round:
    """Rehydrate the engine's round from the stored JSON."""
    return engine.Round(
        id=state["id"],
        seed=state["seed"],
        started_at=datetime.fromisoformat(state["started_at"]),
        created_at=state["created_at"],
        moves=state["moves"],
        gave_up=state.get("gave_up", False),
    )


def _to_state(round_: engine.Round) -> dict:
    """The JSON form. Only seed and decisions: the board is derived."""
    return {
        "id": round_.id,
        "seed": round_.seed,
        "started_at": round_.started_at.isoformat(),
        "created_at": round_.created_at,
        "moves": round_.moves,
        "gave_up": round_.gave_up,
    }


# --- presentation ------------------------------------------------------------
def _step(step: engine.Step, catalog, people) -> ChainStep:
    return ChainStep(
        actor=actor_card(people.get(step.person_id)),
        film=film_card(catalog.film(step.film_id)),
    )


def _present(round_: engine.Round, catalog, people) -> ChainState:
    board = round_.board(people, catalog.films_by_fame())
    here = round_.here or board.start
    return ChainState(
        id=round_.id,
        seed=round_.seed,
        # The clock is authoritative: a round whose time is gone is finished
        # whether or not the client ever said so.
        status="complete" if round_.is_over(board) else "playing",
        start=film_card(catalog.film(board.start)),
        target=film_card(catalog.film(board.target)),
        here=film_card(catalog.film(here)),
        route=[
            _step(engine.Step(person_id=m["person_id"], film_id=m["film_id"]), catalog, people)
            for m in round_.moves
        ],
        steps=round_.steps,
        seconds=round_.elapsed(),
        max_seconds=engine.MAX_SECONDS,
        created_at=round_.created_at,
    )


def _present_results(round_: engine.Round, catalog, people) -> ChainResults:
    board = round_.board(people, catalog.films_by_fame())
    scored = engine.outcome(round_, board)
    return ChainResults(
        game=_present(round_, catalog, people),
        solved=scored.solved,
        steps=scored.steps,
        par=scored.par,
        seconds=scored.seconds,
        ended=scored.ended,
        route=[_step(s, catalog, people) for s in scored.route],
        shortest=[_step(s, catalog, people) for s in scored.shortest],
    )


# --- routes ------------------------------------------------------------------
@router.post("/games", response_model=ChainState, status_code=201)
def create_game(
    people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep, seed: str | None = None
) -> ChainState:
    """Start a chain. Pass ``seed`` (a date) for the shared daily pair."""
    require_people(people)
    round_ = engine.Round(id=new_id(), seed=seed, started_at=datetime.now(UTC), created_at=utc_iso())
    try:
        round_.board(people, catalog.films_by_fame())  # fail before storing
    except GameError as exc:
        raise to_http(exc) from exc

    repo.create(KIND, round_.id, seed, _to_state(round_))
    return _present(round_, catalog, people)


@router.get("/games/{game_id}", response_model=ChainState)
def get_game(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> ChainState:
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
    Films matching a title fragment.

    Offered here where Six Degrees deliberately refuses one. There, a list of
    matching actors is the answer key, because the cell asks for a name. Here
    the puzzle is which films share a cast, and a list of titles matching what
    you typed says nothing about that.
    """
    require_people(people)
    repo.load(KIND, game_id)  # 404s an unknown game before doing any work
    return [film_card(record) for record in catalog.search_films(q, limit)]


@router.post("/games/{game_id}/move", response_model=ChainState)
def move(
    game_id: str,
    body: ChainMoveRequest,
    people: PeopleDep,
    catalog: CatalogDep,
    repo: SideRepositoryDep,
) -> ChainState:
    """
    Step to a film that shares a cast member with the one you are on.

    Two ways to be refused, and they mean different things: a title nothing
    matches, and a real film with nobody in common. The first is a typing
    problem, the second is the game telling you your idea was wrong, so they
    do not share a message.
    """
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    board = round_.board(people, catalog.films_by_fame())

    film = catalog.resolve_film(body.title)
    if film is None:
        raise to_http(GameError(400, "no film in the catalogue goes by that name"))

    try:
        round_.move(people, board, film.film_id)
    except GameError as exc:
        raise to_http(exc) from exc

    repo.save(game_id, _to_state(round_))
    return _present(round_, catalog, people)


@router.post("/games/{game_id}/give-up", response_model=ChainResults)
def give_up(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> ChainResults:
    """Stop the round and reveal a shortest route."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    round_.give_up()
    repo.save(game_id, _to_state(round_))
    return _present_results(round_, catalog, people)


@router.get("/games/{game_id}/results", response_model=ChainResults)
def results(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> ChainResults:
    """Score a finished chain and reveal a shortest route."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    board = round_.board(people, catalog.films_by_fame())
    if not round_.is_over(board):
        raise to_http(GameError(409, "the chain is still in play"))
    return _present_results(round_, catalog, people)


@router.get("/leaderboard", response_model=list[ChainLeaderboardEntry])
def leaderboard(
    people: PeopleDep,
    catalog: CatalogDep,
    repo: SideRepositoryDep,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[ChainLeaderboardEntry]:
    """
    Finished chains, best first.

    Ranked by ``engine.leaderboard_key``: arrived, then fewest steps, then
    fastest. Rebuilding each board to read its par is the price of not storing
    derived state, and at leaderboard sizes it is not a price worth optimising
    away.
    """
    require_people(people)
    ranked_films = catalog.films_by_fame()
    entries: list[dict] = []
    for game_id, seed, state, created_at in repo.recent(KIND, limit * 4):
        round_ = _to_round(state)
        try:
            board = round_.board(people, ranked_films)
        except GameError:  # pragma: no cover - a stored board that no longer builds
            continue
        if not round_.is_over(board):
            continue
        scored = engine.outcome(round_, board)
        entries.append(
            {
                "id": game_id,
                "seed": seed,
                "solved": scored.solved,
                "steps": scored.steps,
                "par": scored.par,
                "seconds": scored.seconds,
                "created_at": created_at,
            }
        )

    entries.sort(key=engine.leaderboard_key)
    return [ChainLeaderboardEntry(**entry) for entry in entries[:limit]]
