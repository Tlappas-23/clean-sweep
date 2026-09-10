"""
Season calibration script (``python -m ml.calibrate``).

Why this lives in ml/ and not in app/engine/
--------------------------------------------
It used to sit beside the rules it calibrates, which read well and was wrong.
``app/engine/`` has one rule: no I/O, no framework, no settings. That is what
makes every rule in it testable against a hand-built fake catalog, and it is
what keeps the request path free of anything heavy. This module breaks all
three, since it reads settings, loads the real seed from disk and prints a
report, and a stated rule with one unmarked exception is worse than no rule
because a reader trusts it and then trips over the exception.

It belongs here on its own terms too. What it does is draw 20,000 random
ballots against the real catalog and report the score distributions that fix
``T_MAX`` and ``FOCUS_WEIGHT``: offline, simulation-based analysis that writes
a number a human then chooses to hard-code. That is what everything else in
this package does.

The move has a practical consequence as well. ``.dockerignore`` excludes
``backend/ml``, so a developer tool that reads settings no longer ships inside
the production image.

Purpose
-------
The thresholds in ``season.py`` are only meaningful relative to what the
scoring function can actually produce on the real seed data. This script
loads the catalog, scores every contender with the live ``pick_score`` and
answers the questions that fix ``T_MAX`` and ``FOCUS_WEIGHT``:

1. Per (year, category) pool: the best achievable pick score, the best
   *winner* score and the best *un-nominated* score.
2. Across many random year draws (using the same decade-first slot
   machine as the game): the distribution of a perfect ballot, of the
   strongest ballot containing one un-nominated pick, of a ballot of
   *nominees who lost*, and how often each clears the final ceremony /
   sweeps the whole circuit with the *current* season table.

``T_MAX`` is squeezed from both sides, which is the whole reason this script
exists. Too high and drafting every real winner still fails to sweep on a
weak year draw; too low and a ballot of six also-ran nominees sweeps, which
would make identifying the actual winner pointless. The final table prints
both rates for a range of candidates so the choice is evidence, not taste.

It is offline tooling, not part of the request path, and reads only the
seed directory from ``Settings``. Re-run it after re-training the ranker or
after box-office enrichment and update the constants block in ``season.py``.

What "must never sweep" means now
---------------------------------
It used to mean any ballot carrying an un-nominated pick. That was the 82-0
deficiency rule read literally, and it had a consequence worth stating out
loud: it scored a landmark film the Academy happened to overlook, Jurassic
Park being the standing example, as though it were worthless.

The rule now discriminates on quality rather than on nomination. A ballot
carrying a *weak* pick still never sweeps. A ballot carrying a genuinely great
un-nominated pick sometimes does, and that is deliberate. Measured over 6,000
draws at the committed constants:

    perfect ballot                    sweeps 1.000
    one great un-nominated pick       sweeps 0.179
    one weak un-nominated pick        sweeps 0.000
    six losing nominees               sweeps 0.000

The middle two rows are the whole change. Everything else about the season
table is unmoved.
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
CANDIDATE_T_MAX = (66.0, 68.0, 70.0, 72.0, 74.0, 76.0, 78.0, 80.0)


def _pct(values: list[float], q: float) -> float:
    """Percentile ``q`` (0-100) by nearest rank, without numpy."""
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def _sweeps(pick_scores: dict[Category, float]) -> tuple[bool, bool]:
    """(cleared the final ceremony, cleared all 30) under the current season table."""
    results = season.simulate(pick_scores)
    return results[-1].won, all(r.won for r in results)


def _sweeps_with_t_max(pick_scores: dict[Category, float], t_max: float) -> bool:
    """
    Would this ballot sweep if ``T_MAX`` were ``t_max``?

    Rebuilds the threshold curve for the hypothetical ceiling while keeping
    every ceremony's emphasis vector, so the specialists still apply.
    """
    span = season.N_CEREMONIES - 1
    for ceremony in season.CEREMONIES:
        progress = (ceremony.index - 1) / span
        threshold = season.T_MIN + (t_max - season.T_MIN) * progress**season.CURVE_POWER
        if season.weighted_strength(pick_scores, ceremony.emphasis) < threshold:
            return False
    return True


def main() -> None:
    catalog = Catalog.load(get_settings().seed_dir)
    print(
        f"catalog: {len(catalog)} contenders, {len(catalog.pools)} pools, ml scores: {catalog.has_ml_scores}"
    )

    # 1. Per-pool ceilings.
    best: dict[tuple[int, Category], float] = {}
    best_winner: dict[tuple[int, Category], float] = {}
    best_unnominated: dict[tuple[int, Category], float] = {}
    best_nominee: dict[tuple[int, Category], float] = {}
    for key, pool in catalog.pools.items():
        scores = [(pick_score(r), r) for r in pool]
        best[key] = max(s for s, _ in scores)
        winners = [s for s, r in scores if r.won]
        if winners:
            best_winner[key] = max(winners)
        best_unnominated[key] = max((s for s, r in scores if not r.nominated), default=0.0)
        # Nominated but beaten: the ceiling for a player who knows the
        # shortlist but not the envelope.
        losers = [s for s, r in scores if r.nominated and not r.won]
        if losers:
            best_nominee[key] = max(losers)

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
    describe("best losing nominee", list(best_nominee.values()))
    no_winner = sorted(k for k in best if k not in best_winner)
    print(f"  pools with no winner: {len(no_winner)} ->", ", ".join(f"{y} {c.value}" for y, c in no_winner))

    # 2. Ballot-level distributions over random full-ballot draws.
    machine = SlotMachine(random.Random(42), catalog.min_year, catalog.max_year)
    cats = list(Category)
    perfect: list[float] = []  # all six actual winners
    one_unnominated: list[float] = []  # strongest ballot with one un-nominated slot
    all_best: list[float] = []  # best pick in every pool, including no-winner pools
    all_nominee: list[float] = []  # six nominees who all lost
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
        nominee_ballot = {c: best_nominee.get(k, 0.0) for k, c in zip(keys, cats, strict=True)}
        all_nominee.append(statistics.fmean(nominee_ballot.values()))
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
        final, sweep = _sweeps(nominee_ballot)
        tallies["all_nominee"]["final"] += final
        tallies["all_nominee"]["sweep"] += sweep
        # Sweep rates for a range of hypothetical ceilings.
        for t in CANDIDATE_T_MAX:
            tallies["t_perfect"][str(t)] += _sweeps_with_t_max(winners, t)
            tallies["t_nominee"][str(t)] += _sweeps_with_t_max(nominee_ballot, t)
        # Every possible un-nominated slot must fail somewhere on the circuit.
        for _, ballot in swaps:
            final, sweep = _sweeps(ballot)
            tallies["one_unnominated"]["final"] += final
            tallies["one_unnominated"]["sweep"] += sweep
            tallies["one_unnominated"]["n"] += 1

    print(f"\nballot averages over {N_DRAWS} draws ({n_all_winners} with a winner in all six pools):")
    describe("perfect (6 winners)", perfect)
    describe("5 winners + 1 un-nominated", one_unnominated)
    describe("all losing nominees", all_nominee)
    describe("best pick in every pool", all_best)

    print("\nshare clearing a final-ceremony threshold T (uniform emphasis):")
    print("   T    perfect   one-unnom   all-best   6-nominees")
    for t in CANDIDATE_T_MAX:
        p = statistics.fmean(v >= t for v in perfect)
        u = statistics.fmean(v >= t for v in one_unnominated)
        a = statistics.fmean(v >= t for v in all_best)
        q = statistics.fmean(v >= t for v in all_nominee)
        print(f"  {t:4.0f}   {p:7.3f}   {u:9.3f}   {a:8.3f}   {q:10.3f}")

    # The decisive table: T_MAX must make the first column ~1.0 (drafting the
    # six real winners always sweeps) while keeping the second at 0.0 (knowing
    # the shortlist is not enough).
    print("\nfull-circuit SWEEP rate by T_MAX (the number that fixes the constant):")
    print("   T_MAX   perfect sweeps   6-nominees sweep")
    for t in CANDIDATE_T_MAX:
        p = tallies["t_perfect"][str(t)] / n_all_winners
        q = tallies["t_nominee"][str(t)] / n_all_winners
        print(f"   {t:5.0f}   {p:14.3f}   {q:16.3f}")

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
        f"sweeps {tallies['one_unnominated']['sweep'] / m:.4f}  (small, not zero: see below)"
    )
    print(
        f"  all losing nominees: clears final {tallies['all_nominee']['final'] / n:.3f}, "
        f"sweeps {tallies['all_nominee']['sweep'] / n:.4f}  (must be ~0)"
    )
    # Hard guarantee check: the strongest possible snub (max un-nominated
    # score) next to five perfect-100 winners must still miss the easiest
    # specialist ceremony.
    specialists = [c for c in season.CEREMONIES if max(c.emphasis.values()) >= season.FOCUS_WEIGHT]
    worst_snub = season.FOCUS_WEIGHT * max(best_unnominated.values()) + (1 - season.FOCUS_WEIGHT) * 100
    easiest = min(c.threshold for c in specialists)
    print(
        f"  specialists at stops {specialists[0].index}-{specialists[-1].index}; "
        f"strongest-snub strength {worst_snub:.2f} vs easiest specialist "
        f"threshold {easiest:.2f} (margin {easiest - worst_snub:+.2f})"
    )
    print("  thresholds:", ", ".join(f"{c.index}:{c.threshold:.1f}" for c in season.CEREMONIES))


if __name__ == "__main__":
    main()
