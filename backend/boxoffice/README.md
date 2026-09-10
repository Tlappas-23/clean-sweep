# Box Office Forecasting

Predict what a film will earn **before it opens**, from what is knowable on
the day the marketing campaign starts: who is in it, who made it, what it is,
who is releasing it, when, and what it cost.

Three targets:

| Target | How it is produced |
|---|---|
| Domestic (US + Canada) | its own fit |
| International (worldwide minus domestic) | its own fit |
| Worldwide | **its own fit, not the sum of the other two** |

That last row started as the opposite claim. The original design argued that
domestic and international have different drivers, so worldwide should be their
sum rather than a third fit. It was a reasonable-sounding assertion and it was
checked rather than left standing, and it is wrong: on identical folds, summing
the two halves lands 4.9 points *below* fitting worldwide directly, and loses
in six of seven folds.

The reason is mechanical. Each half is fit in log space and exponentiated
before summing, so their errors compound instead of cancelling, while a direct
fit optimises the quantity actually wanted. The breakout is still worth
producing, because a studio wants to know where the money comes from. It is
just not the way to produce the total.

International is the harder half by a clear margin: 59.7% of forecasts land
within a factor of two against 69.4% for domestic.

## The rule this project exists to demonstrate

Every feature must be answerable **as of the film's release date**, using only
information that existed before it. That is a stricter bar than "do not use
the revenue column", and it is where box office models usually break:

- A director's prior average gross is legitimate. Their *career* average,
  computed over films that had not been released yet, is not.
- A star's prior box office is legitimate. Their popularity score today is not.
- Budget is legitimate. Reported budget revised after a flop is a grey area,
  and it is flagged rather than quietly used.
- Genre, runtime, certificate, studio, release date, franchise position and
  cast are all legitimate. **Studio is not leakage**: the distributor is known
  months out and is one of the strongest legitimate signals there is.

What is never legitimate, and is present in the Clean Sweep seed this project
sits beside: IMDb rating, IMDb vote count, Rotten Tomatoes, Metascore, Academy
nominations, wins, and anything derived from them. All eight accumulate after
release. `leakage.py` refuses to let them into the feature matrix, and the
test suite fails if the refusal stops working.

## Why this framing rather than a leaderboard

Predicting box office is a well-worn problem, and chasing an error metric on it
adds nothing. The question worth answering is the one a studio actually asks:

> **What is knowable before release, and what does each thing buy you?**

So the deliverable is an ablation study with strict temporal validation, not a
single score. Each feature group is added in isolation and its contribution is
measured against a budget-only baseline. Some groups will not earn their place,
and that result is reported rather than buried.

## Validation

Strictly temporal, always. Train on films released before a cutoff, score films
released after it, roll the cutoff forward a year at a time. Random K-fold on
this problem lets a model learn 2019 from 2021 and is the second most common
way these models get flattered.

Metrics are reported in log space (where the model is fit) and in dollars
(where the decision is made), plus the share of predictions landing within a
factor of two, because box office forecasting is an order-of-magnitude problem
and an R-squared on dollars is dominated by six films.
