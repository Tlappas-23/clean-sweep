"""
Engine unit tests (``tests.test_engine``).

These exercise the rules in isolation against the hand-built fake catalog
from ``conftest``: no database, no HTTP, no parquet. If one of these fails,
a game rule is wrong; if only the API tests fail, the wiring is wrong.
"""

from __future__ import annotations

import pytest

from app.engine import game as engine
from app.engine.errors import GameError
from app.engine.scoring import METRIC_WEIGHTS, pick_score, score_from_metrics
from app.engine.season import CEREMONIES, N_CEREMONIES, simulate, weakest_category
from app.engine.slot_machine import SlotMachine
from app.models.enums import Category, GameStatus, Mode, SkipKind

# --- helpers -----------------------------------------------------------------


def start(catalog, mode: Mode = Mode.CLASSIC, seed: str | None = "test-seed"):
    """A fresh game that has already been spun once."""
    game = engine.new_game("game-1", mode, seed, "2026-01-01T00:00:00+00:00")
    return engine.spin(game, catalog)


def play_full_ballot(catalog, key: str = "win", seed: str = "test-seed"):
    """Draft the same contender key in every round and return the completed game."""
    game = engine.new_game("game-full", Mode.CLASSIC, seed, "2026-01-01T00:00:00+00:00")
    for _ in range(engine.TOTAL_ROUNDS):
        game = engine.spin(game, catalog)
        game = engine.pick(game, target_in(game, key), catalog)
    return game


def target_in(game, key: str = "win", index: int = 0) -> str:
    """Contender id for ``key`` in the ``index``-th year currently on the board."""
    spin_state = game.current_spin
    assert spin_state is not None
    return f"{spin_state.category.value}:{key}:{spin_state.year_options[index].year}"


# --- slot machine ------------------------------------------------------------


def test_slot_machine_is_reproducible_from_seed_and_draw_count():
    """The same seed replays the same reels, which is what makes the daily challenge fair."""
    first = SlotMachine.from_seed("2026-09-06", 0, 1950, 2025)
    second = SlotMachine.from_seed("2026-09-06", 0, 1950, 2025)
    assert [first.spin_year() for _ in range(5)] == [second.spin_year() for _ in range(5)]

    # Advancing the draw counter resumes mid-stream rather than restarting it.
    resumed = SlotMachine.from_seed("2026-09-06", 4, 1950, 2025)
    fresh = SlotMachine.from_seed("2026-09-06", 0, 1950, 2025)
    fresh.spin_year()
    fresh.spin_year()
    assert resumed.spin_year() == fresh.spin_year()


def test_slot_machine_clips_decades_to_the_catalog_range():
    """A catalog covering only the 1990s can only ever deal 1990s years."""
    machine = SlotMachine.from_seed("x", 0, 1990, 1999)
    assert machine.decades == ["1990s"]
    assert all(1990 <= machine.spin_year()[0] <= 1999 for _ in range(20))


# --- scoring -----------------------------------------------------------------


def test_missing_metrics_renormalise_instead_of_scoring_zero():
    """An absent metric must not drag the score down; the remaining weights take over."""
    full = score_from_metrics({"academy": 100.0, "box_office": 100.0, "acclaim": 100.0})
    assert full == pytest.approx(100.0)

    # One metric present is that metric's value, whichever metric it is.
    assert score_from_metrics({"acclaim": 42.0}) == pytest.approx(42.0)
    assert score_from_metrics({"box_office": 42.0}) == pytest.approx(42.0)

    # A null contributes nothing and is excluded from the denominator.
    assert score_from_metrics({"academy": 100.0, "acclaim": 0.0, "box_office": None}) == pytest.approx(
        100.0 * METRIC_WEIGHTS["academy"] / (METRIC_WEIGHTS["academy"] + METRIC_WEIGHTS["acclaim"])
    )
    assert score_from_metrics({"academy": None}) == 0.0


def test_academy_metric_dominates_the_pick_score(fake_catalog):
    """A winner outscores a nominee, which outscores an also-ran, in every category."""
    for category in Category:
        pool = {r.contender_id: r for r in fake_catalog.pool(1990, category)}
        winner = pick_score(pool[f"{category.value}:win:1990"])
        nominee = pick_score(pool[f"{category.value}:nom:1990"])
        also_ran = pick_score(pool[f"{category.value}:also:1990"])
        assert winner > nominee > also_ran


# --- season ------------------------------------------------------------------


def test_thresholds_rise_monotonically_and_end_at_the_oscars():
    assert len(CEREMONIES) == N_CEREMONIES
    thresholds = [c.threshold for c in CEREMONIES]
    assert thresholds == sorted(thresholds)
    assert thresholds[0] < thresholds[-1]
    assert CEREMONIES[-1].name == "Academy Awards"
    # Every emphasis vector is a probability distribution over the six slots.
    for ceremony in CEREMONIES:
        assert sum(ceremony.emphasis.values()) == pytest.approx(1.0)
        assert set(ceremony.emphasis) == set(Category)


def test_a_perfect_ballot_sweeps_and_one_weak_slot_prevents_it():
    """The deficiency rule from 82-0: one bad category costs you the season."""
    perfect = dict.fromkeys(Category, 100.0)
    assert all(c.won for c in simulate(perfect))

    # Same ballot, but Best Supporting Actor is an un-nominated pick.
    crippled = perfect | {Category.SUPPORTING_ACTOR: 38.0}
    results = simulate(crippled)
    lost = [c for c in results if not c.won]
    assert lost, "a zero-Academy slot must cost at least one ceremony"
    # ...and the stop it costs is the one that cares about that category.
    assert any(c.emphasis[Category.SUPPORTING_ACTOR] > 0.5 for c in lost)


def test_weakest_category_reports_the_lowest_slot():
    scores = dict.fromkeys(Category, 90.0) | {Category.ACTRESS: 10.0}
    assert weakest_category(scores) is Category.ACTRESS
    assert weakest_category({}) is None


# --- transitions -------------------------------------------------------------


def test_new_game_starts_spinning_with_its_skip(fake_catalog):
    game = engine.new_game("g", Mode.CLASSIC, None, "2026-01-01T00:00:00+00:00")
    assert game.status is GameStatus.SPINNING
    assert game.round == 1
    assert game.current_spin is None
    assert game.skips_remaining.category == 1
    assert game.category_order == list(Category)
    assert engine.TOTAL_ROUNDS == len(Category) == 8


def test_a_spin_deals_several_distinct_playable_years(fake_catalog):
    """The round is a choice between years, so the reels must not repeat one."""
    game = start(fake_catalog)
    options = game.current_spin.year_options
    assert len(options) == engine.YEARS_PER_ROUND
    years = [o.year for o in options]
    assert len(set(years)) == len(years), "the reels dealt the same year twice"
    for option in options:
        assert option.decade.endswith("s")
        assert fake_catalog.winners(option.year, game.current_spin.category)
    assert game.current_spin.reroll_available is True
    assert game.current_spin.locked is False


def test_any_year_on_the_board_can_be_drafted(fake_catalog):
    """All three dealt years are live until one is used."""
    for index in range(engine.YEARS_PER_ROUND):
        game = start(fake_catalog)
        chosen = game.current_spin.year_options[index].year
        game = engine.pick(game, target_in(game, "win", index), fake_catalog)
        assert game.picks[0].year == chosen


def test_the_reroll_trades_the_board_for_one_forced_year(fake_catalog):
    """The gamble: give up the choice for a fresh year you then have to use."""
    game = start(fake_catalog)
    before = [o.year for o in game.current_spin.year_options]

    game = engine.reroll(game, fake_catalog)
    assert game.current_spin.locked is True
    assert game.current_spin.reroll_available is False
    assert len(game.current_spin.year_options) == 1
    assert game.status is GameStatus.PICKING

    # The fresh year is never one of the three just thrown away: handing a
    # rejected year straight back would make the gamble meaningless.
    assert game.current_spin.year_options[0].year not in before

    # Only once per round.
    with pytest.raises(GameError) as exc:
        engine.reroll(game, fake_catalog)
    assert exc.value.status_code == 409

    # The years it replaced are gone, so they can no longer be drafted.
    stale = next(y for y in before if y != game.current_spin.year_options[0].year)
    with pytest.raises(GameError) as exc:
        engine.pick(game, f"{game.current_spin.category.value}:win:{stale}", fake_catalog)
    assert exc.value.status_code == 400


def test_the_reroll_resets_on_the_next_round(fake_catalog):
    """It is a per-round decision, not a one-off token for the whole game."""
    game = start(fake_catalog)
    game = engine.reroll(game, fake_catalog)
    game = engine.pick(game, target_in(game, "win"), fake_catalog)
    game = engine.spin(game, fake_catalog)
    assert game.current_spin.reroll_available is True


def test_spin_then_pick_advances_the_round(fake_catalog):
    game = start(fake_catalog)
    assert game.status is GameStatus.PICKING
    assert game.current_spin is not None
    assert game.current_spin.category is Category.PICTURE

    game = engine.pick(game, target_in(game, "win"), fake_catalog)
    assert game.status is GameStatus.SPINNING
    assert game.round == 2
    assert game.current_spin is None
    assert len(game.picks) == 1 and game.picks[0].round == 1


def test_illegal_transitions_raise_with_the_right_status(fake_catalog):
    game = engine.new_game("g", Mode.CLASSIC, None, "2026-01-01T00:00:00+00:00")

    with pytest.raises(GameError) as exc:  # picking before spinning
        engine.pick(game, "picture:win:1990", fake_catalog)
    assert exc.value.status_code == 409

    with pytest.raises(GameError) as exc:  # results before the ballot is full
        engine.results(game, fake_catalog)
    assert exc.value.status_code == 409

    game = engine.spin(game, fake_catalog)
    with pytest.raises(GameError) as exc:  # spinning twice
        engine.spin(game, fake_catalog)
    assert exc.value.status_code == 409

    with pytest.raises(GameError) as exc:  # a contender that does not exist
        engine.pick(game, "picture:nope:1990", fake_catalog)
    assert exc.value.status_code == 404

    with pytest.raises(GameError) as exc:  # right category, a year not on the board
        on_board = set(game.current_spin.years)
        wrong_year = next(y for y in (1980, 1990, 2000, 2010, 2020) if y not in on_board)
        engine.pick(game, f"picture:win:{wrong_year}", fake_catalog)
    assert exc.value.status_code == 400


def test_category_skip_defers_the_slot_to_the_end_of_the_ballot(fake_catalog):
    game = start(fake_catalog)
    assert game.current_spin.category is Category.PICTURE

    game = engine.skip(game, SkipKind.CATEGORY, fake_catalog)
    assert game.skips_remaining.category == 0
    assert game.current_spin.category is Category.DIRECTOR
    assert game.category_order[-1] is Category.PICTURE  # deferred, not dropped
    assert game.round == 1  # the round did not advance, only the category changed
    # A skip re-deals the years, because a year playable for one category need
    # not be playable for another.
    assert len(game.current_spin.year_options) == engine.YEARS_PER_ROUND

    with pytest.raises(GameError) as exc:  # only one per game
        engine.skip(game, SkipKind.CATEGORY, fake_catalog)
    assert exc.value.status_code == 409


def test_completing_every_round_finishes_the_game(fake_catalog):
    game = play_full_ballot(fake_catalog)
    assert game.status is GameStatus.COMPLETE
    assert game.round == engine.TOTAL_ROUNDS  # stays at the last round per the contract
    assert len(game.picks) == engine.TOTAL_ROUNDS
    assert {p.category for p in game.picks} == set(Category)


def test_results_reveal_the_answer_key_and_score_the_season(fake_catalog):
    """A ballot of six real winners sweeps; the reveal carries the outcome and metrics."""
    game = play_full_ballot(fake_catalog)
    results = engine.results(game, fake_catalog)

    assert results.wins == N_CEREMONIES
    assert results.losses == 0
    assert results.clean_sweep is True
    assert results.ballot_strength == pytest.approx(sum(p.pick_score for p in results.picks), abs=0.05)

    for entry in results.picks:
        assert entry.won_oscar is True
        assert entry.nominated is True
        assert entry.academy == 100
        assert entry.actual_winner is not None
        assert entry.metric_breakdown["academy"] == 100.0
        # No model prediction is scored; the breakdown is observable facts only.
        assert "prestige" not in entry.metric_breakdown


def test_a_single_un_nominated_pick_breaks_the_sweep(fake_catalog):
    """Five winners and one also-ran cannot go 30-0, however strong the rest is."""
    results = engine.results(play_full_ballot(fake_catalog, key="also"), fake_catalog)
    assert results.clean_sweep is False
    assert results.wins < N_CEREMONIES
    assert all(p.won_oscar is False for p in results.picks)


def test_cinephile_picks_are_stored_masked_but_revealed_in_results(fake_catalog):
    """Masking is a storage-time decision; the results page unmasks everything."""
    game = engine.new_game("g-cine", Mode.CINEPHILE, "seed", "2026-01-01T00:00:00+00:00")
    game = engine.spin(game, fake_catalog)
    game = engine.pick(game, target_in(game, "win"), fake_catalog)

    stored = game.picks[0].contender
    assert stored.metrics.acclaim is None and stored.archetype is None

    for _ in range(engine.TOTAL_ROUNDS - 1):  # finish the ballot
        game = engine.spin(game, fake_catalog)
        game = engine.pick(game, target_in(game, "win"), fake_catalog)

    revealed = engine.results(game, fake_catalog).picks[0].pick.contender
    assert revealed.metrics.acclaim is not None
    assert revealed.archetype == "Prestige Drama"


def test_the_same_seed_deals_the_same_reels(fake_catalog):
    """Two games sharing a seed play an identical sequence of years."""
    left = play_full_ballot(fake_catalog, seed="2026-09-06")
    right = play_full_ballot(fake_catalog, seed="2026-09-06")
    assert [p.year for p in left.picks] == [p.year for p in right.picks]
