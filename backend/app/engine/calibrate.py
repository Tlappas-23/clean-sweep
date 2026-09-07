"""
Season calibration script (``python -m app.engine.calibrate``).

Purpose
-------
The thresholds in ``season.py`` are only meaningful relative to what the
scoring function can actually produce on the real seed data. This script
loads the catalog, scores every contender with the live ``pick_score`` and
answers the questions that fix ``T_MAX`` and ``FOCUS_WEIGHT``:

1. Per (year, category) pool: the best achievable pick score, the best
   *winner* score and the best *un-nominated* score.
2. Across many random six-year draws (using the same decade-first slot
   machine as the game): the distribution of a perfect ballot, of the
   strongest ballot containing one un-nominated pick, and how often each
   clears the final ceremony / sweeps the whole circuit with the *current*
   season table.

It is offline tooling, not part of the request path, and reads only the
seed directory from ``Settings``. Re-run it after re-training the ranker or
after box-office enrichment and update the constants block in ``season.py``.
"""

from __future__ import annotations

import random
import statistics
from collections import defaultdict

from app.core.config import get_settings
from app.data.catalog import Catalog
from app.engine import season
from app.engine.scoring import pick_score
from app.engine.slot_machine import SlotMachine
from app.models.enums import Category

N_DRAWS = 20_000
CANDIDATE_T_MAX = (76.0, 78.0, 80.0, 82.0, 84.0, 86.0, 88.0)


def _pct(values: list[float], q: float) -> float:
    """Percentile ``q`` (0-100) by nearest rank, without numpy."""
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def _sweeps(pick_scores: dict[Category, float]) -> tuple[bool, bool]:
    """(cleared the final ceremony, cleared all 30) under the current season table."""
    results = season.simulate(pick_scores)
    return results[-1].won, all(r.won for r in results)


def main() -> None:
    catalog = Catalog.load(get_settings().seed_dir)
    print(
        f"catalog: {len(catalog)} contenders, {len(catalog.pools)} pools, ml scores: {catalog.has_ml_scores}"
    )

    # 1. Per-pool ceilings.
    best: dict[tuple[int, Category], float] = {}
    best_winner: dict[tuple[int, Category], float] = {}
    best_unnominated: dict[tuple[int, Category], float] = {}
    for key, pool in catalog.pools.items():
        scores = [(pick_score(r), r) for r in pool]
        best[key] = max(s for s, _ in scores)
        winners = [s for s, r in scores if r.won]
        if winners:
            best_winner[key] = max(winners)
        best_unnominated[key] = max((s for s, r in scores if not r.nominated), default=0.0)

    def describe(label: str, values: list[float]) -> None:
        print(
            f"  {label:<28} n={len(values):>4}  min={min(values):6.2f}  p10={_pct(values, 10):6.2f}  "
            f"median={statistics.median(values):6.2f}  mean={statistics.fmean(values):6.2f}  "
            f"max={max(values):6.2f}"
        )

    print("\nper-pool ceilings (pick score):")
    describe("best in pool", list(best.values()))
    describe("best winner", list(best_winner.values()))
    describe("best un-nominated", list(best_unnominated.values()))
    no_winner = sorted(k for k in best if k not in best_winner)
    print(f"  pools with no winner: {len(no_winner)} ->", ", ".join(f"{y} {c.value}" for y, c in no_winner))

    # 2. Ballot-level distributions over random six-year draws.
    machine = SlotMachine(random.Random(42), catalog.min_year, catalog.max_year)
    cats = list(Category)
    perfect: list[float] = []  # all six actual winners
    one_unnominated: list[float] = []  # strongest ballot with one un-nominated slot
    all_best: list[float] = []  # best pick in every pool, including no-winner pools
    tallies: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    n_all_winners = 0
    for _ in range(N_DRAWS):
        years = [machine.spin_year()[0] for _ in cats]
        keys = list(zip(years, cats, strict=True))
        all_best.append(statistics.fmean(best[k] for k in keys))
        if not all(k in best_winner for k in keys):
            continue
        n_all_winners += 1
        winners = {c: best_winner[k] for k, c in zip(keys, cats, strict=True)}
        perfect.append(statistics.fmean(winners.values()))
        # Swap the slot where dropping to the un-nominated ceiling hurts least.
        swaps = []
        for k, c in zip(keys, cats, strict=True):
            ballot = dict(winners, **{c: best_unnominated[k]})
            swaps.append((statistics.fmean(ballot.values()), ballot))
        best_swap_mean, best_swap = max(swaps, key=lambda s: s[0])
        one_unnominated.append(best_swap_mean)
        # Sweep rates against the *current* season table.
        final, sweep = _sweeps(winners)
        tallies["perfect"]["final"] += final
        tallies["perfect"]["sweep"] += sweep
        # Every possible un-nominated slot must fail somewhere on the circuit.
        for _, ballot in swaps:
            final, sweep = _sweeps(ballot)
            tallies["one_unnominated"]["final"] += final
            tallies["one_unnominated"]["sweep"] += sweep
            tallies["one_unnominated"]["n"] += 1

    print(f"\nballot averages over {N_DRAWS} draws ({n_all_winners} with a winner in all six pools):")
    describe("perfect (6 winners)", perfect)
    describe("5 winners + 1 un-nominated", one_unnominated)
    describe("best pick in every pool", all_best)

    print("\nshare clearing a final-ceremony threshold T (uniform emphasis):")
    print("   T    perfect   one-unnom   all-best")
    for t in CANDIDATE_T_MAX:
        p = statistics.fmean(v >= t for v in perfect)
        u = statistics.fmean(v >= t for v in one_unnominated)
        a = statistics.fmean(v >= t for v in all_best)
        print(f"  {t:4.0f}   {p:7.3f}   {u:9.3f}   {a:8.3f}")

    n = n_all_winners
    m = tallies["one_unnominated"]["n"]
    print(
        f"\ncurrent season table (T_MIN={season.T_MIN}, T_MAX={season.T_MAX}, "
        f"power={season.CURVE_POWER}, focus={season.FOCUS_WEIGHT}):"
    )
    print(
        f"  perfect ballot: clears final {tallies['perfect']['final'] / n:.3f}, "
        f"sweeps {tallies['perfect']['sweep'] / n:.3f}"
    )
    print(
        f"  one un-nominated: clears final {tallies['one_unnominated']['final'] / m:.3f}, "
        f"sweeps {tallies['one_unnominated']['sweep'] / m:.4f}  (must be ~0)"
    )
    # Hard guarantee check: the strongest possible snub (max un-nominated
    # score) next to five perfect-100 winners must still miss the easiest
    # specialist ceremony.
    specialists = [c for c in season.CEREMONIES if max(c.emphasis.values()) >= season.FOCUS_WEIGHT]
    worst_snub = season.FOCUS_WEIGHT * max(best_unnominated.values()) + (1 - season.FOCUS_WEIGHT) * 100
    easiest = min(c.threshold for c in specialists)
    print(
        f"  specialists at stops {specialists[0].index}-{specialists[-1].index}; "
        f"worst-case snub strength {worst_snub:.2f} vs easiest specialist "
        f"threshold {easiest:.2f} (margin {easiest - worst_snub:+.2f})"
    )
    print("  thresholds:", ", ".join(f"{c.index}:{c.threshold:.1f}" for c in season.CEREMONIES))


if __name__ == "__main__":
    main()
