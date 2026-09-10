# Box Office Forecasting

Predict what a film will earn **before it opens**, from what is knowable on
the day the marketing campaign starts: who is in it, who made it, what it is,
who is releasing it, when, and what it cost.

Three targets, modelled separately:

| Target | Why separately |
|---|---|
| Domestic (US + Canada) | driven by genre, star familiarity, release corridor |
| International (worldwide minus domestic) | driven by franchise, spectacle, local distribution |
| Worldwide | the sum of the two, not a third fit |

Modelling worldwide directly hides that the two halves have different drivers.
A horror film that opens to $40M domestic may do $15M abroad; a spectacle
sequel inverts that ratio. One fit on the total cannot express it.

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
