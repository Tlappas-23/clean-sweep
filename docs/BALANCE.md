# Clean Sweep: Balance

Every constant in the scorer and the season table is chosen from measurement,
not taste. This file records what was measured and what it forced. Regenerate
the numbers with:

```bash
cd backend && python -m app.engine.calibrate
```

## The two-sided constraint

A season table has to satisfy three things at once, and they pull against
each other:

| Ballot | Must sweep? |
|--------|-------------|
| Every actual winner and genre crown | always |
| One un-nominated pick among them | never |
| Nominees and runners-up only | never |

The top of the threshold curve (`T_MAX`) is squeezed from both sides. Too high
and drafting every real winner still fails on a thin year draw. Too low and a
ballot of also-ran nominees sweeps, which would make identifying the actual
winner pointless.

Measured over 20,000 random ballot draws against the committed seed:

| | Sweeps |
|---|---|
| Every actual winner and crown | **100.00%** |
| One un-nominated pick among them | **0.00%** |
| Nominees and runners-up only | **0.00%** |

## What each constant is doing

**`METRIC_WEIGHTS["academy"] = 0.60`** sets the gap between a winner (100) and
a losing nominee (60), and the season table has to resolve that gap.

It had to rise from 0.50 when the model prediction left the score. `prestige`
used to carry 0.17, and it was doing real separating work. The ranker scores
winners well above losing nominees (AUC 0.890, see `docs/ML.md`). Removing it
collapsed the separation: at 0.50 with no prestige there is **no** viable
threshold, because the highest ceiling where a perfect ballot always sweeps
still lets a nominees-only ballot through 0.65% of the time. The grid in
`app/engine/calibrate.py` shows the first viable combination is academy 0.60
with `T_MAX` 74–76.

There is no model prediction in the score at all now. Every point comes from
observable facts plus the actual outcome.

**`T_MAX = 75`** is the top of the convex curve, chosen mid-range of the
viable band so there is margin on both sides.

**`FOCUS_WEIGHT = 0.92`** is what enforces the deficiency rule from 82-0. Eight
"specialist" ceremonies each put that much weight on a single category. The
best un-nominated pick anywhere now scores 44.8, so even beside seven flawless
slots it yields `0.92 x 44.8 + 0.08 x 100 = 49.2`, well under the easiest
specialist threshold of 57.1, a margin of +12.3. One weak slot costs the
season however strong the rest is.

This weight had to rise from 0.85 when TMDB box-office enrichment lifted what
an un-nominated pick can score. That is the point of keeping the calibration
script in the repo: the constants are downstream of the data, so they get
re-derived whenever the data changes.

**Specialist ordering** is weakest-category-first, measured from the 5th
percentile of the best available winner score in each category's pools:

| Category | Winner p05 | Median |
|----------|-----------|--------|
| Supporting Actress | 61.0 | 77.0 |
| Actress | 61.6 | 80.4 |
| Supporting Actor | 62.7 | 82.9 |
| Actor | 64.8 | 83.0 |
| Picture | 74.6 | 90.6 |
| Director | 75.3 | 90.7 |
| Comedy | 79.0 | 94.5 |
| Horror | 81.1 | 96.2 |

Re-derive this whenever the pool or the weights change. Dropping the pre-1950
years moved Director; dropping prestige moved it again.

Pairing the weakest slot with the gentlest threshold is what lifts the perfect
ballot's sweep rate to 1.000; with the specialists in an arbitrary order it
sits around 0.98.

The two genre categories score higher than the Oscar ones because their crown
is by construction the best-regarded film of that year in that genre, while
Best Supporting Actress is often a fine performance in a small film.

## Does it reward knowledge?

120 seeded games per strategy, played straight through the engine:

| Strategy | Mean record | Sweeps |
|----------|-------------|--------|
| Knows every winner | 30.0–0.0 | 100% |
| Knows the nominees only | 24.4–5.6 | 0% |
| Follows the prestige model | 24.3–5.7 | 2% |
| Picks the most popular film | 19.2–10.8 | 0% |
| Picks the highest-rated film | 17.9–12.1 | 0% |
| Picks the biggest box office | 12.5–17.5 | 0% |

The ordering is the design goal in one table. Recognising a famous title gets
you two thirds of the season. Knowing who was nominated gets you most of the
rest. Only knowing who actually won closes it out. The ML ranker plays at the
level of a well-informed fan without reliably sweeping, which is what you
would want from it: it never sees an award outcome as a feature, and it no
longer contributes to the score at all.
