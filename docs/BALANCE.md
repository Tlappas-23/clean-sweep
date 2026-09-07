# Clean Sweep — Balance

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

**`METRIC_WEIGHTS["academy"] = 0.50`** sets the gap between a winner (100) and
a losing nominee (60). At 0.40 the two populations overlap and *no* threshold
satisfies all three rows above: at `T_MAX` 76 nominee ballots sweep 8.6% of
draws, and at 80 perfect ballots sweep only 96.8%. At 0.50 they separate
cleanly.

**`T_MAX = 78`** is the top of the convex curve, sitting above the strongest
nominee-only ballot and below the weakest all-winners ballot.

**`FOCUS_WEIGHT = 0.92`** is what enforces the deficiency rule from 82-0. Eight
"specialist" ceremonies each put that much weight on a single category. The
best un-nominated pick anywhere scores 50.0, so even beside seven flawless
slots it yields `0.92 x 50 + 0.08 x 100 = 54.0`, under the easiest specialist
threshold of 58.7. One weak slot costs the season however strong the rest is.

This weight had to rise from 0.85 when TMDB box-office enrichment lifted what
an un-nominated pick can score. That is the point of keeping the calibration
script in the repo: the constants are downstream of the data, so they get
re-derived whenever the data changes.

**Specialist ordering** is weakest-category-first, measured from the 5th
percentile of the best available winner score in each category's pools:

| Category | Winner p05 | Median | Best un-nominated |
|----------|-----------|--------|-------------------|
| Supporting Actress | 71.5 | 83.8 | 49.8 |
| Director | 72.3 | 93.8 | 50.0 |
| Actress | 73.0 | 86.6 | 49.7 |
| Supporting Actor | 74.7 | 88.6 | 49.4 |
| Actor | 74.7 | 89.4 | 49.6 |
| Picture | 80.6 | 94.2 | 50.0 |
| Comedy | 87.4 | 96.6 | 42.0 |
| Horror | 87.4 | 98.2 | 40.0 |

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
| Knows every winner | 30–0 | 100% |
| Knows the nominees, not the winners | 26.0–4.0 | 0% |
| Follows the prestige model | 25.1–4.9 | 0.8% |
| Always picks the most popular film | 21.1–8.9 | 0% |
| Always picks the highest-rated film | 20.7–9.3 | 0% |
| Always picks the biggest box office | 15.2–14.8 | 0% |

The ordering is the design goal in one table. Recognising a famous title gets
you two thirds of the season. Knowing who was nominated gets you most of the
rest. Only knowing who actually won closes it out — and the ML ranker, which
never sees an award outcome as a feature, plays at the level of a
well-informed fan without reliably sweeping.
