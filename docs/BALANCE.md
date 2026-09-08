# Clean Sweep: Balance

Every constant in the scorer and the season table is chosen from measurement,
not taste. This file records what was measured and what it forced. Regenerate
the numbers with:

```bash
cd backend && python -m app.engine.calibrate
```

## What the season has to separate

A season table has to satisfy several things at once, and they pull against
each other:

| Ballot | Must sweep? |
|--------|-------------|
| Every actual winner and genre crown | always |
| A weak un-nominated pick among them | never |
| Nominees and runners-up only | never |
| A great un-nominated pick among them | sometimes |

The last row is new, and it is the point of the current scoring. The rule used
to be 82-0's read literally: one un-nominated pick sinks the season, always.
That rule scored a landmark film the Academy happened to overlook as though it
were worthless. The season now discriminates on **quality** rather than on
nomination.

Measured over 6,000 draws at the committed constants:

| Ballot | Sweeps |
|--------|--------|
| Perfect ballot | **1.000** |
| One great un-nominated pick | **0.179** |
| One weak un-nominated pick | **0.000** |
| Six losing nominees | **0.000** |

A weak pick still costs the season every time. A great one costs it most of the
time. Only a ballot of actual winners sweeps reliably, so identifying the
envelope is still what the game rewards.

## What each constant is doing

**`METRIC_WEIGHTS`** distributes a pick's score over five metrics:

| Metric | Weight |
|--------|--------|
| ceremony | 0.60 |
| box_office | 0.12 |
| critics | 0.10 |
| audience | 0.10 |
| popularity | 0.08 |

Critics and audience are deliberately equal. Neither is the authority on
whether a film is good, and weighting one above the other would be an opinion
the data cannot support.

**`METRIC_WEIGHTS["ceremony"] = 0.60`** sets the gap between a winner (100) and
a losing nominee (60), and the season table has to resolve that gap.

It had to rise from 0.50 when the model prediction left the score. `prestige`
used to carry 0.17, and it was doing real separating work. The ranker scores
winners well above losing nominees (AUC 0.927, see `docs/ML.md`). Removing it
collapsed the separation: at 0.50 with no prestige there is **no** viable
threshold, because the highest ceiling where a perfect ballot always sweeps
still lets a nominees-only ballot through 0.65% of the time.

It stayed at 0.60 when the metric was redefined, and that was tested rather
than assumed. Lowering it is the obvious way to lift a snubbed film, so it was
tried and rejected: with the weight down at 0.46 and the standing ceiling at
55, the strongest ballot carrying one un-nominated pick swept 37% of the time.
A great un-nominated film ends up scoring too close to a nominee for a
specialist ceremony to separate them at all. The lift for such a film therefore
comes from the standing floor inside the ceremony metric and from the other
four metrics, not from taking weight off the award itself.

**`STANDING_CEILING = 50.0`** in `pipeline/awards.py` caps what a film's record
across every Academy category can contribute when the contender was not
nominated in the category being played. It is the constant the whole change
turns on, and it was gridded rather than picked: ceiling x ceremony weight x
`T_MAX`, 20,000 draws a cell.

The ceiling is squeezed from both sides. Too low and Jurassic Park is still
scored as a nobody. Too high and an un-nominated pick sits so close to a
nominee that no specialist ceremony can tell them apart: that is the cell
above, ceiling 55 and weight 0.46, sweeping 37% of the time. 50 is the value
that lifts a snubbed film clear of zero while leaving a weak pick fatal.

It sits below the 60 a nominee scores, which is a hard constraint rather than a
tuning choice. An actor who was not nominated does not get to outrank an actor
who was, however well the film did elsewhere. That cap is what keeps the game
about the ballot.

**`T_MAX = 80`** is the top of the convex threshold curve. It rose from 75 with
the new metric, because a non-zero floor under un-nominated picks lifts every
ballot's strength, including the ones that must not sweep. The calibration grid
reports both rates for a range of candidates, and at 80 a perfect ballot still
sweeps on every draw tested while a ballot of losing nominees never does.

**`FOCUS_WEIGHT = 0.92`** is what enforces the deficiency rule. Eight
"specialist" ceremonies at stops 21 to 28 each put that much weight on a single
category, so a weak slot is exposed at the one ceremony that cares about it,
however strong the rest of the ballot is.

What changed here is that the guarantee is no longer absolute, and that is
deliberate rather than a regression. The strongest un-nominated pick in the
catalogue can now clear the easiest specialist threshold, which is exactly what
lets a great snubbed film through 0.179 of the time. A weak pick cannot: it
still fails its specialist on every draw measured. The rule is intact for the
case 82-0 meant it for, and relaxed for the case it got wrong.

`FOCUS_WEIGHT` had already risen from 0.85 once, when TMDB box-office
enrichment lifted what an un-nominated pick can score. That is the point of
keeping the calibration script in the repo: the constants are downstream of the
data, so they get re-derived whenever the data changes.

**Specialist ordering** is weakest-category-first, so each slot faces the
gentlest threshold it can:

1. Supporting Actress
2. Actress
3. Supporting Actor
4. Actor
5. Picture
6. Director
7. Comedy
8. Horror

The order comes from the 5th percentile of the best available winner score in
each category's pools, and `app/engine/season.py` carries the current figures
next to the table. Re-derive it whenever the pool or the weights change:
dropping the pre-1950 years moved Director, and dropping prestige moved it
again.

Pairing the weakest slot with the gentlest threshold is what lifts the perfect
ballot's sweep rate to 1.000; with the specialists in an arbitrary order it
sits around 0.98.

The two genre categories score higher than the Oscar ones because their crown
is by construction the best-regarded film of that year in that genre, while
Best Supporting Actress is often a fine performance in a small film.

## Does it reward knowledge?

400 seeded boards per strategy, played straight through the engine, and
re-measured against the five-metric score:

| Strategy | Mean record | Sweeps |
|----------|-------------|--------|
| Knows every winner | 30.0–0.0 | 100% |
| Follows the prestige model | 23.9–6.1 | 0% |
| Knows the nominees only | 23.1–6.9 | 0% |
| Picks the most popular film | 19.6–10.4 | 0% |
| Picks the highest-rated film | 17.2–12.8 | 0% |
| Picks the biggest box office | 12.8–17.2 | 0% |

The ordering is the design goal in one table. Recognising a famous title gets
you two thirds of the season. Knowing who was nominated gets you most of the
rest. Only knowing who actually won closes it out. The ML ranker plays at the
level of a well-informed fan without reliably sweeping, which is what you
would want from it: it never sees an award outcome as a feature, and it no
longer contributes to the score at all.
