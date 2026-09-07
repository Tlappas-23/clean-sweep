"""
Game state transitions (``app.engine.game``): the rulebook.

Architecture note
-----------------
This is the heart of the "engine is pure" principle from docs/ARCHITECTURE.md.
Every function here takes a :class:`~app.models.game.StoredGame` plus a
catalog-shaped lookup and returns a *new* state; nothing is read from disk,
no session is opened, and no FastAPI type is imported. The API layer is a
thin shell that loads the state, calls one of these, and saves the result.

The transitions implement the rules listed under "Rules enforced by the
server" in docs/API.md::

    new_game ──► SPINNING ──spin──► PICKING ──pick──► SPINNING (rounds 1-5)
                     ▲                 │                  │
                     └──── skip(year/category) ───┘       └─► COMPLETE (round 6)

Illegal transitions raise :class:`~app.engine.errors.GameError` carrying the
HTTP status the API should return, so the rule and its status code live in
one place instead of being re-derived in the router.
"""

from __future__ import annotations

from typing import Protocol

from app.engine.errors import GameError
from app.engine.scoring import metric_breakdown, pick_score, score_from_metrics
from app.engine.season import simulate, weakest_category
from app.engine.slot_machine import DRAWS_PER_SPIN, SlotMachine
from app.models.enums import Category, GameStatus, Mode, SkipKind
from app.models.game import Pick, Spin, StoredGame
from app.models.results import GameResults, PickResult

# A game fills six slots; the round number never exceeds this.
TOTAL_ROUNDS = 6


class CatalogLike(Protocol):
    """
    The slice of :class:`~app.data.catalog.Catalog` the engine depends on.

    Declaring it as a Protocol (rather than importing the concrete class)
    keeps the engine free of the data layer and lets the unit tests pass in a
    hand-built fake catalog holding a dozen contenders.
    """

    min_year: int
    max_year: int

    def get(self, contender_id: str): ...  # -> ContenderRecord | None
    def pool(self, year: int, category: Category): ...  # -> list[ContenderRecord]
    def winners(self, year: int, category: Category): ...  # -> list[ContenderRecord]
    def to_public(self, record, mode: Mode, reveal: bool = False): ...  # -> Contender


# --- helpers -----------------------------------------------------------------


def _machine(game: StoredGame, catalog: CatalogLike) -> SlotMachine:
    """
    Rebuild the game's slot machine at its current position in the RNG stream.

    The seed is the game's ``seed`` when one was supplied (the daily challenge
    passes a date, so every player gets the same reels) and otherwise the game
    id, which is random per game. See ``app.engine.slot_machine`` for why only
    a draw counter is persisted.
    """
    return SlotMachine.from_seed(
        seed=game.seed or game.id,
        draws=game.rng_draws,
        min_year=catalog.min_year,
        max_year=catalog.max_year,
    )


def _current_category(game: StoredGame) -> Category:
    """The category this round is drafting: position ``round - 1`` of the order."""
    return game.category_order[game.round - 1]


def _is_playable(catalog: CatalogLike, year: int, category: Category) -> bool:
    """
    True when this slot can be filled *and* can be filled perfectly.

    Requiring an actual Oscar winner in the pool — not merely some candidates —
    is what keeps a clean sweep reachable from every draw. The supporting
    categories did not exist until the 1936 ceremony, and 1933 is empty across
    the board because the 1934 ceremony covered the split "1932/33" season and
    the seed files that under its first year. Landing on one of those would
    hand the player a slot whose best possible pick still scores as
    un-nominated, which the deficiency rule then turns into a guaranteed loss
    through no fault of their own.
    """
    return bool(catalog.winners(year, category))


def _spin_year_with_pool(game: StoredGame, catalog: CatalogLike, category: Category) -> tuple[int, str, int]:
    """
    Spin the year reel until it lands on a year this category can actually be won in.

    Re-spinning (rather than nudging to a neighbouring year) keeps the reel
    honest and stays reproducible: every attempt consumes a fixed number of
    draws from the same seeded stream, so replaying the seed replays the
    rejections too. The attempt cap makes a pathological catalog fail loudly
    instead of hanging.
    """
    machine = _machine(game, catalog)
    draws = game.rng_draws
    for _ in range(200):
        year, decade = machine.spin_year()
        draws += DRAWS_PER_SPIN
        if _is_playable(catalog, year, category):
            return year, decade, draws
    raise GameError(500, f"no playable year found for {category.value}")


# --- transitions -------------------------------------------------------------


def new_game(game_id: str, mode: Mode, seed: str | None, created_at: str) -> StoredGame:
    """Create a fresh game: round 1, nothing picked, both skips in hand, awaiting a spin."""
    from app.models.enums import DEFAULT_CATEGORY_ORDER
    from app.models.game import SkipsRemaining

    return StoredGame(
        id=game_id,
        mode=mode,
        seed=seed,
        status=GameStatus.SPINNING,
        round=1,
        category_order=list(DEFAULT_CATEGORY_ORDER),
        current_spin=None,
        skips_remaining=SkipsRemaining(year=1, category=1),
        picks=[],
        created_at=created_at,
        rng_draws=0,
    )


def spin(game: StoredGame, catalog: CatalogLike) -> StoredGame:
    """
    Spin the reels for the current round: SPINNING -> PICKING.

    The category reel is not random — it is the next unfilled slot in
    ``category_order`` (docs/GAME_DESIGN.md §2 spins the *year*, and skips are
    what move the category around).
    """
    if game.status is not GameStatus.SPINNING:
        raise GameError(409, f"cannot spin while status is '{game.status.value}'")

    category = _current_category(game)
    year, decade, draws = _spin_year_with_pool(game, catalog, category)

    updated = game.model_copy(deep=True)
    updated.current_spin = Spin(year=year, category=category, decade=decade)
    updated.rng_draws = draws
    updated.status = GameStatus.PICKING
    return updated


def skip(game: StoredGame, kind: SkipKind, catalog: CatalogLike) -> StoredGame:
    """
    Spend one of the two skips (docs/GAME_DESIGN.md §2).

    * ``year``     — re-spin the year reel, keeping the category.
    * ``category`` — defer this category to the end of the ballot and draft the
      next one instead, keeping the year.
    """
    if game.status is not GameStatus.PICKING or game.current_spin is None:
        raise GameError(409, f"cannot skip while status is '{game.status.value}'")

    remaining = getattr(game.skips_remaining, kind.value)
    if remaining <= 0:
        raise GameError(409, f"no {kind.value} skips remaining")

    updated = game.model_copy(deep=True)
    setattr(updated.skips_remaining, kind.value, remaining - 1)

    if kind is SkipKind.YEAR:
        category = updated.current_spin.category
        year, decade, draws = _spin_year_with_pool(updated, catalog, category)
        updated.current_spin = Spin(year=year, category=category, decade=decade)
        updated.rng_draws = draws
        return updated

    # Category skip. Rotate the current category to the back of the order.
    # Slots before ``round - 1`` are already filled and are never touched, so
    # moving index ``round - 1`` to the end promotes the next unfilled category
    # into the current position.
    position = updated.round - 1
    if position >= len(updated.category_order) - 1:
        raise GameError(409, "no other category left to switch to")

    order = updated.category_order
    order.append(order.pop(position))
    next_category = order[position]

    year = updated.current_spin.year
    decade = updated.current_spin.decade
    if not _is_playable(catalog, year, next_category):
        # The kept year is not playable for the new category (the supporting
        # categories before 1936, say); re-spin rather than hand the player a
        # slot they cannot win.
        year, decade, draws = _spin_year_with_pool(updated, catalog, next_category)
        updated.rng_draws = draws
    updated.current_spin = Spin(year=year, category=next_category, decade=decade)
    return updated


def pick(game: StoredGame, contender_id: str, catalog: CatalogLike) -> StoredGame:
    """
    Lock a contender into the current slot. Round 6 ends the game.

    The contender must belong to the exact pool on the board; picking by id
    alone would otherwise let a client draft any performance in history.
    """
    if game.status is not GameStatus.PICKING or game.current_spin is None:
        raise GameError(409, f"cannot pick while status is '{game.status.value}'")

    record = catalog.get(contender_id)
    if record is None:
        raise GameError(404, f"unknown contender '{contender_id}'")

    spin_state = game.current_spin
    if record.year != spin_state.year or record.category != spin_state.category:
        raise GameError(
            400,
            f"'{contender_id}' is not in the {spin_state.year} "
            f"{spin_state.category.value} pool currently on the board",
        )

    updated = game.model_copy(deep=True)
    updated.picks.append(
        Pick(
            round=updated.round,
            category=spin_state.category,
            year=spin_state.year,
            # Stored masked, exactly as the player saw it; results re-render it
            # from the catalog with everything revealed.
            contender=catalog.to_public(record, updated.mode),
        )
    )
    updated.current_spin = None

    if updated.round >= TOTAL_ROUNDS:
        updated.status = GameStatus.COMPLETE  # round stays at 6 (contract)
    else:
        updated.round += 1
        updated.status = GameStatus.SPINNING
    return updated


# --- results -----------------------------------------------------------------


def results(game: StoredGame, catalog: CatalogLike) -> GameResults:
    """
    Score a completed ballot and run it through the 30-ceremony season.

    Pure and deterministic: the same completed game always produces the same
    record, which is why the API can cache the payload and why the daily
    challenge is comparable between players.
    """
    if game.status is not GameStatus.COMPLETE:
        raise GameError(409, "results are only available once the ballot is complete")

    pick_results: list[PickResult] = []
    pick_scores: dict[Category, float] = {}

    for entry in game.picks:
        record = catalog.get(entry.contender.contender_id)
        if record is None:  # pragma: no cover - a pick can only exist if the record did
            raise GameError(500, f"contender '{entry.contender.contender_id}' vanished from the catalog")

        breakdown = metric_breakdown(record)
        score = score_from_metrics(breakdown)
        pick_scores[entry.category] = score

        # Reveal the pick: same slot, but the contender is re-rendered with
        # metrics and stats visible even in cinephile mode.
        revealed = entry.model_copy(update={"contender": catalog.to_public(record, game.mode, reveal=True)})

        # The answer key: who actually won this year in this category. Ties and
        # the earliest ceremonies can produce more than one; show the first.
        winners = catalog.winners(entry.year, entry.category)
        actual_winner = catalog.to_public(winners[0], game.mode, reveal=True) if winners else None

        pick_results.append(
            PickResult(
                pick=revealed,
                academy=int(breakdown["academy"] or 0),
                nominated=record.nominated,
                won_oscar=record.won,
                actual_winner=actual_winner,
                metric_breakdown={k: (None if v is None else round(v, 2)) for k, v in breakdown.items()},
                pick_score=round(score, 2),
            )
        )

    ceremonies = simulate(pick_scores)
    wins = sum(1 for c in ceremonies if c.won)

    return GameResults(
        game=game.public(),
        ballot_strength=round(sum(pick_scores.values()), 2),
        wins=wins,
        losses=len(ceremonies) - wins,
        clean_sweep=wins == len(ceremonies),
        ceremonies=ceremonies,
        picks=pick_results,
        weakest_category=weakest_category(pick_scores),
    )


__all__ = ["TOTAL_ROUNDS", "CatalogLike", "new_game", "pick", "pick_score", "results", "skip", "spin"]
