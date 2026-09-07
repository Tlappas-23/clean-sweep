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

    new_game ──► SPINNING ──spin──► PICKING ──pick──► SPINNING (rounds 1-7)
                                       │                  │
                                       ├── skip(category)  └─► COMPLETE (round 8)
                                       └── reroll (once per round)

A spin deals ``YEARS_PER_ROUND`` years at once and the player drafts from any
of them. ``reroll`` is the gamble: it throws all of those years away for a
single fresh one that then *must* be used.

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
from app.models.game import Pick, Spin, StoredGame, YearOption
from app.models.results import GameResults, PickResult

# A game fills one slot per category; the round number never exceeds this.
TOTAL_ROUNDS = len(Category)

# How many years the reels deal per round. The player picks a contender from
# any of them, which turns each round into a choice between eras rather than
# a single take-it-or-leave-it draw (docs/GAME_DESIGN.md §2).
YEARS_PER_ROUND = 3


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


def _spin_year_with_pool(
    game: StoredGame,
    catalog: CatalogLike,
    category: Category,
    exclude: set[int] | None = None,
) -> tuple[int, str, int]:
    """
    Spin the year reel until it lands on a year this category can actually be won in.

    Re-spinning (rather than nudging to a neighbouring year) keeps the reel
    honest and stays reproducible: every attempt consumes a fixed number of
    draws from the same seeded stream, so replaying the seed replays the
    rejections too. ``exclude`` skips years already on the board this round so
    the three reels never show the same year twice. The attempt cap makes a
    pathological catalog fail loudly instead of hanging.
    """
    already = exclude or set()
    machine = _machine(game, catalog)
    draws = game.rng_draws
    for _ in range(300):
        year, decade = machine.spin_year()
        draws += DRAWS_PER_SPIN
        if year not in already and _is_playable(catalog, year, category):
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


def _deal_years(
    game: StoredGame,
    catalog: CatalogLike,
    category: Category,
    count: int,
    exclude: set[int] | None = None,
) -> tuple[list[YearOption], int]:
    """
    Draw ``count`` distinct playable years for ``category``.

    Distinct matters: three reels showing the same year would be no choice at
    all. ``exclude`` additionally rules out years the round has already shown,
    which is what stops a reroll returning one of the years it discarded.
    Every draw still comes from the one seeded stream, so a daily seed deals
    the same years to everybody.
    """
    options: list[YearOption] = []
    draws = game.rng_draws
    seen: set[int] = set(exclude or ())
    probe = game
    for _ in range(count):
        probe = probe.model_copy(update={"rng_draws": draws})
        year, decade, draws = _spin_year_with_pool(probe, catalog, category, exclude=seen)
        seen.add(year)
        options.append(YearOption(year=year, decade=decade))
    return options, draws


def spin(game: StoredGame, catalog: CatalogLike) -> StoredGame:
    """
    Deal the round: SPINNING -> PICKING.

    The category reel is not random — it is the next unfilled slot in
    ``category_order``. The year reel is, and it turns up
    ``YEARS_PER_ROUND`` of them for the player to choose between.
    """
    if game.status is not GameStatus.SPINNING:
        raise GameError(409, f"cannot spin while status is '{game.status.value}'")

    category = _current_category(game)
    options, draws = _deal_years(game, catalog, category, YEARS_PER_ROUND)

    updated = game.model_copy(deep=True)
    updated.current_spin = Spin(category=category, year_options=options, locked=False, reroll_available=True)
    updated.rng_draws = draws
    updated.status = GameStatus.PICKING
    return updated


def reroll(game: StoredGame, catalog: CatalogLike) -> StoredGame:
    """
    Trade this round's years for a single fresh one — the gamble.

    Once spent, the new year is the only one on the board: the player has to
    draft from it. Available once per round, and only before a pick, which is
    what makes it a real decision rather than a free re-spin.
    """
    if game.status is not GameStatus.PICKING or game.current_spin is None:
        raise GameError(409, f"cannot reroll while status is '{game.status.value}'")
    if not game.current_spin.reroll_available:
        raise GameError(409, "this round's reroll has already been spent")

    category = game.current_spin.category
    # Exclude the years being thrown away. Handing one of them straight back
    # would make the gamble feel broken - the player rejected those three, and
    # a "fresh" year that is one of them is not a gamble at all.
    options, draws = _deal_years(game, catalog, category, 1, exclude=set(game.current_spin.years))

    updated = game.model_copy(deep=True)
    updated.current_spin = Spin(category=category, year_options=options, locked=True, reroll_available=False)
    updated.rng_draws = draws
    return updated


def skip(game: StoredGame, kind: SkipKind, catalog: CatalogLike) -> StoredGame:
    """
    Spend the category skip: defer this category to the end of the ballot.

    The years on the board are re-dealt, because a year that is playable for
    Best Horror need not be playable for Best Supporting Actress, and because
    keeping them would let a player shop one strong year around every category.
    """
    if game.status is not GameStatus.PICKING or game.current_spin is None:
        raise GameError(409, f"cannot skip while status is '{game.status.value}'")
    if kind is not SkipKind.CATEGORY:
        raise GameError(400, f"unknown skip kind '{kind}'")

    remaining = game.skips_remaining.category
    if remaining <= 0:
        raise GameError(409, "no category skips remaining")

    updated = game.model_copy(deep=True)
    updated.skips_remaining.category = remaining - 1

    # Rotate the current category to the back of the order. Slots before
    # ``round - 1`` are already filled and are never touched, so moving index
    # ``round - 1`` to the end promotes the next unfilled category into place.
    position = updated.round - 1
    if position >= len(updated.category_order) - 1:
        raise GameError(409, "no other category left to switch to")

    order = updated.category_order
    order.append(order.pop(position))
    next_category = order[position]

    # A skip keeps the round's reroll: it changes what you are drafting, not
    # how many chances you get at a year.
    keep_reroll = updated.current_spin.reroll_available
    options, draws = _deal_years(updated, catalog, next_category, YEARS_PER_ROUND)
    updated.current_spin = Spin(
        category=next_category,
        year_options=options,
        locked=False,
        reroll_available=keep_reroll,
    )
    updated.rng_draws = draws
    return updated


def pick(game: StoredGame, contender_id: str, catalog: CatalogLike) -> StoredGame:
    """
    Lock a contender into the current slot. The final round ends the game.

    The contender must belong to the exact pool on the board; picking by id
    alone would otherwise let a client draft any performance in history.
    """
    if game.status is not GameStatus.PICKING or game.current_spin is None:
        raise GameError(409, f"cannot pick while status is '{game.status.value}'")

    record = catalog.get(contender_id)
    if record is None:
        raise GameError(404, f"unknown contender '{contender_id}'")

    spin_state = game.current_spin
    if record.category != spin_state.category or record.year not in spin_state.years:
        years = ", ".join(str(y) for y in spin_state.years)
        raise GameError(
            400,
            f"'{contender_id}' is not in the {spin_state.category.value} pool "
            f"for any year on the board ({years})",
        )

    updated = game.model_copy(deep=True)
    updated.picks.append(
        Pick(
            round=updated.round,
            category=spin_state.category,
            year=record.year,
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


__all__ = [
    "TOTAL_ROUNDS",
    "YEARS_PER_ROUND",
    "CatalogLike",
    "new_game",
    "pick",
    "pick_score",
    "reroll",
    "results",
    "skip",
    "spin",
]
