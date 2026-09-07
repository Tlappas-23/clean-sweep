"""
Recast routes (``app.api.recast``).

Architecture note
-----------------
Thin, like every router here. ``app.engine.recast`` owns what a round is, how
a shortlist is drawn, what a casting scores and which film is worth recasting;
this module loads, delegates, saves and serialises.

As with the grid, only the seed and the player's decisions are stored. The
film's roles and every shortlist are functions of the seed, so they are
rebuilt on demand — which is what lets a player refresh mid-round and see the
same names, and what makes a daily recast identical for everybody.
"""

from __future__ import annotations

import random
from dataclasses import asdict

from fastapi import APIRouter

from app.api.deps import CatalogDep, PeopleDep, SideRepositoryDep, new_id, require_people, to_http, utc_iso
from app.data.catalog import film_card
from app.data.people import actor_card
from app.engine import recast as engine
from app.engine.errors import GameError
from app.models.people import ActorCard
from app.models.recast import (
    CastingPick,
    CastingResult,
    CastRequest,
    FitBreakdown,
    RecastResults,
    RecastState,
    RoleCard,
)

router = APIRouter(prefix="/api/recast", tags=["recast"])

KIND = "recast"


# --- state <-> storage -------------------------------------------------------
def _to_round(state: dict) -> engine.Round:
    return engine.Round(
        id=state["id"],
        seed=state["seed"],
        film_id=state["film_id"],
        created_at=state["created_at"],
        picks=[engine.Casting(**pick) for pick in state["picks"]],
    )


def _to_state(round_: engine.Round) -> dict:
    return {
        "id": round_.id,
        "seed": round_.seed,
        "film_id": round_.film_id,
        "created_at": round_.created_at,
        # asdict rather than vars: Casting uses __slots__, so it has no __dict__.
        "picks": [asdict(pick) for pick in round_.picks],
    }


def _setup(round_: engine.Round, catalog, people) -> tuple[list[engine.Role], tuple[str, ...]]:
    """The film's roles and genres — everything the engine needs alongside the round."""
    return (
        engine.playable_roles(catalog, people, round_.film_id),
        tuple(catalog.film(round_.film_id).genres),
    )


def _shortlist(round_: engine.Round, people, roles: list[engine.Role], genres, index: int):
    """The shortlist for one role, excluding everyone already cast."""
    role = roles[index]
    original = people.get(role.person_id)
    if original is None:  # pragma: no cover - choose_film rules these out
        raise to_http(GameError(503, "that role's actor has no casting profile"))
    return original, engine.shortlist(
        people, original, role, genres, round_.used_actors(upto=index), round_.shortlist_rng(index)
    )


# --- presentation ------------------------------------------------------------
def _present(round_: engine.Round, catalog, people) -> RecastState:
    roles, _ = _setup(round_, catalog, people)
    return RecastState(
        id=round_.id,
        seed=round_.seed,
        status="complete" if round_.is_complete(roles) else "casting",
        film=film_card(catalog.film(round_.film_id)),
        roles=[
            RoleCard(
                billing=role.billing,
                character=role.character,
                original=actor_card(people.get(role.person_id)),
                is_lead=role.is_lead,
            )
            for role in roles
        ],
        current_role=round_.current_index,
        picks=[
            CastingPick(
                billing=pick.billing,
                character=pick.character,
                original=actor_card(people.get(pick.original_id)),
                replacement=actor_card(people.get(pick.replacement_id)),
            )
            for pick in round_.picks
        ],
        created_at=round_.created_at,
    )


# --- routes ------------------------------------------------------------------
@router.post("/games", response_model=RecastState, status_code=201)
def create_game(
    people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep, seed: str | None = None
) -> RecastState:
    """Start a recast. Pass ``seed`` (a date) for the shared daily film."""
    require_people(people)
    game_id = new_id()
    try:
        film_id = engine.choose_film(catalog, people, random.Random(seed or game_id))
    except GameError as exc:
        raise to_http(exc) from exc

    round_ = engine.Round(id=game_id, seed=seed, film_id=film_id, created_at=utc_iso())
    repo.create(KIND, game_id, seed, _to_state(round_))
    return _present(round_, catalog, people)


@router.get("/games/{game_id}", response_model=RecastState)
def get_game(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> RecastState:
    require_people(people)
    return _present(_to_round(repo.load(KIND, game_id)), catalog, people)


@router.get("/games/{game_id}/shortlist", response_model=list[ActorCard])
def shortlist(
    game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep
) -> list[ActorCard]:
    """The actors offered for the role currently being cast."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    roles, genres = _setup(round_, catalog, people)
    if round_.is_complete(roles):
        raise to_http(GameError(409, "every role is cast"))
    _, candidates = _shortlist(round_, people, roles, genres, round_.current_index)
    return [actor_card(actor) for actor in candidates]


@router.post("/games/{game_id}/cast", response_model=RecastState)
def cast(
    game_id: str,
    body: CastRequest,
    people: PeopleDep,
    catalog: CatalogDep,
    repo: SideRepositoryDep,
) -> RecastState:
    """Cast the current role from its shortlist."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    roles, genres = _setup(round_, catalog, people)
    if round_.is_complete(roles):
        raise to_http(GameError(409, "every role is cast"))

    index = round_.current_index
    _, candidates = _shortlist(round_, people, roles, genres, index)
    try:
        round_.cast(roles[index], body.person_id, {a.person_id for a in candidates})
    except GameError as exc:
        raise to_http(exc) from exc

    repo.save(game_id, _to_state(round_))
    return _present(round_, catalog, people)


@router.get("/games/{game_id}/results", response_model=RecastResults)
def results(game_id: str, people: PeopleDep, catalog: CatalogDep, repo: SideRepositoryDep) -> RecastResults:
    """Score the casting once every role is filled."""
    require_people(people)
    round_ = _to_round(repo.load(KIND, game_id))
    roles, genres = _setup(round_, catalog, people)
    if not round_.is_complete(roles):
        raise to_http(GameError(409, "there are still roles to cast"))

    scored = engine.outcome(round_, people, roles, genres)
    return RecastResults(
        game=_present(round_, catalog, people),
        score=scored.score,
        castings=[
            CastingResult(
                billing=casting.billing,
                character=casting.character,
                original=actor_card(people.get(casting.original_id)),
                replacement=actor_card(people.get(casting.replacement_id)),
                fit=casting.fit,
                breakdown=FitBreakdown(**casting.breakdown),
                best_available=(
                    actor_card(people.get(casting.best_available_id)) if casting.best_available_id else None
                ),
                best_fit=casting.best_fit,
            )
            for casting in scored.castings
        ],
        strongest=scored.strongest,
        weakest=scored.weakest,
    )
