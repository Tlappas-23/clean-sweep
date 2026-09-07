"""
Game routes (``app.api.games``): the round loop.

Architecture note
-----------------
Every handler follows the same four steps — load the stored game, call one
pure engine transition, save the new state, return its public view. The
rules themselves live in ``app.engine.game``; nothing in this module decides
what is legal, it only translates :class:`~app.engine.errors.GameError` into
an HTTP response.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CatalogDep, RepositoryDep, new_id, to_http, utc_iso
from app.data.catalog import search_pool
from app.engine import game as engine
from app.engine.errors import GameError
from app.models.contender import Contender
from app.models.enums import CandidateSort, GameStatus, Mode
from app.models.game import CreateGameRequest, GameState, PickRequest, SkipRequest, SubmitRequest
from app.models.leaderboard import LeaderboardEntry
from app.models.results import GameResults

router = APIRouter(prefix="/api/games", tags=["games"])


@router.post("", response_model=GameState, status_code=201)
def create_game(body: CreateGameRequest, repo: RepositoryDep) -> GameState:
    """
    Start a game.

    Passing ``seed`` (the daily challenge sends today's date) makes the reels
    reproducible: two games with the same seed spin the same years in the same
    order, so scores are comparable.
    """
    stored = engine.new_game(game_id=new_id(), mode=body.mode, seed=body.seed, created_at=utc_iso())
    repo.create(stored)
    return stored.public()


@router.get("/{game_id}", response_model=GameState)
def get_game(game_id: str, repo: RepositoryDep) -> GameState:
    """Current state of a game (used to resume after a page reload)."""
    return repo.load(game_id).public()


@router.post("/{game_id}/spin", response_model=GameState)
def spin_game(game_id: str, repo: RepositoryDep, catalog: CatalogDep) -> GameState:
    """Spin the reels for the current round. Only valid while status is ``spinning``."""
    stored = repo.load(game_id)
    try:
        stored = engine.spin(stored, catalog)
    except GameError as exc:
        raise to_http(exc) from exc
    repo.save(stored)
    return stored.public()


@router.post("/{game_id}/skip", response_model=GameState)
def skip_round(game_id: str, body: SkipRequest, repo: RepositoryDep, catalog: CatalogDep) -> GameState:
    """Spend the category skip: defer this slot and draft the next category instead."""
    stored = repo.load(game_id)
    try:
        stored = engine.skip(stored, body.kind, catalog)
    except GameError as exc:
        raise to_http(exc) from exc
    repo.save(stored)
    return stored.public()


@router.post("/{game_id}/reroll", response_model=GameState)
def reroll_years(game_id: str, repo: RepositoryDep, catalog: CatalogDep) -> GameState:
    """
    Trade this round's years for one fresh year, which then has to be used.

    The gamble from docs/GAME_DESIGN.md §2: available once per round, and only
    before a pick is locked in.
    """
    stored = repo.load(game_id)
    try:
        stored = engine.reroll(stored, catalog)
    except GameError as exc:
        raise to_http(exc) from exc
    repo.save(stored)
    return stored.public()


@router.get("/{game_id}/candidates", response_model=list[Contender])
def list_candidates(
    game_id: str,
    repo: RepositoryDep,
    catalog: CatalogDep,
    year: int | None = Query(
        default=None, description="Which of the years on the board to list; defaults to all of them"
    ),
    sort: CandidateSort = Query(default=CandidateSort.ACCLAIM, description="Ordering of the pool"),
    q: str | None = Query(default=None, max_length=64, description="Filter on title / person / character"),
) -> list[Contender]:
    """
    The pool currently on the board, filtered and sorted.

    A round deals several years at once, so ``year`` selects one of them;
    omitting it returns every year on the board in one list, which is what the
    "all years" view of the picker uses.

    Masking is applied by the catalog: in cinephile mode the metrics and raw
    stats come back null, and metric sorts are refused because the ordering
    would itself reveal the ranking the mode is meant to hide.
    """
    stored = repo.load(game_id)
    if stored.status is not GameStatus.PICKING or stored.current_spin is None:
        raise HTTPException(status_code=409, detail=f"no pool on the board (status '{stored.status.value}')")
    if stored.mode is Mode.CINEPHILE and sort.is_metric:
        raise HTTPException(status_code=400, detail=f"sort '{sort.value}' is hidden in cinephile mode")

    board = stored.current_spin
    if year is not None and year not in board.years:
        years = ", ".join(str(y) for y in board.years)
        raise HTTPException(status_code=400, detail=f"year {year} is not on the board ({years})")

    wanted = [year] if year is not None else board.years
    records = [r for y in wanted for r in catalog.pool(y, board.category)]
    return [catalog.to_public(r, stored.mode) for r in search_pool(records, q, sort)]


@router.post("/{game_id}/pick", response_model=GameState)
def make_pick(game_id: str, body: PickRequest, repo: RepositoryDep, catalog: CatalogDep) -> GameState:
    """Lock in a contender. The last pick completes the ballot."""
    stored = repo.load(game_id)
    try:
        stored = engine.pick(stored, body.contender_id, catalog)
    except GameError as exc:
        raise to_http(exc) from exc
    repo.save(stored)
    return stored.public()


@router.get("/{game_id}/results", response_model=GameResults)
def get_results(game_id: str, repo: RepositoryDep, catalog: CatalogDep) -> GameResults:
    """Score the completed ballot against the 30-ceremony circuit."""
    stored = repo.load(game_id)
    return repo.results(stored, catalog)


@router.post("/{game_id}/submit", response_model=LeaderboardEntry, status_code=201)
def submit_score(
    game_id: str, body: SubmitRequest, repo: RepositoryDep, catalog: CatalogDep
) -> LeaderboardEntry:
    """
    Publish a finished game to the leaderboard.

    One entry per game: re-submitting is a conflict rather than a duplicate row,
    which keeps a daily seed's table honest.
    """
    from app.core.db import LeaderboardRow

    stored = repo.load(game_id)
    if stored.status is not GameStatus.COMPLETE:
        raise HTTPException(status_code=409, detail="finish the ballot before submitting a score")
    if repo.submitted_game_ids(game_id):
        raise HTTPException(status_code=409, detail="this game has already been submitted")

    results = repo.results(stored, catalog)
    row = LeaderboardRow(
        id=new_id(),
        game_id=game_id,
        player_name=body.player_name.strip(),
        mode=stored.mode.value,
        seed=stored.seed,
        wins=results.wins,
        ballot_strength=results.ballot_strength,
        clean_sweep=results.clean_sweep,
    )
    with repo.database.session() as session:
        session.add(row)
    return LeaderboardEntry(
        id=row.id,
        player_name=row.player_name,
        mode=stored.mode,
        seed=stored.seed,
        wins=row.wins,
        ballot_strength=row.ballot_strength,
        clean_sweep=row.clean_sweep,
        created_at=utc_iso(),
    )
