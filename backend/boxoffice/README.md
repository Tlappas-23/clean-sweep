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
the two halves lands 2.3 points *below* fitting worldwide directly, and is worse
or level in seven of nine folds.

That margin is quoted with a caveat, because it moved. On the first 523 films
with both figures it was 4.9 points; on 686 it is 2.3. The direction has held
across both runs and the size has not, so the finding is "summing does not
help" rather than "summing costs five points".

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
single score. Each feature group is removed from the working model and the
damage is measured, which is what asks whether the group contributes alongside
the others. The first design added each group to a budget-only baseline
instead; it makes almost everything look harmful and it answers a question
nobody asked. Both are reported, because the disagreement between them is more
useful than either table alone.

Some groups do not earn their place. Cast, director, cinematographer, composer
and Academy pedigree all come back at zero, and that is reported rather than
buried.

## Validation

Strictly temporal, always. Train on films released before a cutoff, score films
released after it, roll the cutoff forward a year at a time. Random K-fold on
this problem lets a model learn 2019 from 2021 and is the second most common
way these models get flattered.

Metrics are reported in log space (where the model is fit) and in dollars
(where the decision is made), plus the share of predictions landing within a
factor of two, because box office forecasting is an order-of-magnitude problem
and an R-squared on dollars is dominated by six films.

## Where things are

| Path | What it settles |
|---|---|
| `decision_log.ipynb` | every modelling decision in order, with the check that informed it |
| `RESULTS.md` | the numbers, including the ones that went the wrong way |
| `model/leakage.py` | the banned columns, and as-of encoding for anything derived from history |
| `model/train.py` | rolling-origin folds against the median and budget-only baselines |
| `model/bakeoff.py` | ridge vs forest vs boosting vs a neural net, on identical folds |
| `model/tune.py` | a hyperparameter search that scores its winner on folds it never saw |
| `model/ablate.py` | what each feature group buys, in both ablation designs |
| `model/significance.py` | McNemar and a paired bootstrap on every ablation claim |
| `model/prestige.py` | whether Academy pedigree predicts revenue. It does not |
| `model/text.py` | whether the marketing synopsis predicts revenue. It does not |
| `model/career_test.py` | whether career length and gaps predict revenue. They do not |
| `model/history_ablation.py` | whether widening career histories helps. It hurts |
| `model/outcome_clusters.py` | whether box office falls into natural kinds. Three, stably |
| `model/classify.py` | the outcome classifier, calibrated in-fold, against the tier prior |
| `model/classify_significance.py` | whether it beats the prior, per budget tier. It does |
| `pipeline/reconcile_targets.py` | corrects TMDB's worldwide gross against an independent source |
| `pipeline/rebuild.py` | every stage in dependency order, because the order has been got wrong by hand |
| `pipeline/` | fetch, feature construction, and the domestic-gross backfill |

## What is committed and what is not

The derived artifacts under `data/` are committed: the feature matrix, the
domestic breakout, every study's CSV, the projections and the accuracy file.
They are what the tests pin, the notebook reads and the API serves, so a fresh
clone works without keys.

The per-response API caches under `data/cache/` are not. They are tens of
thousands of small JSON files that every rebuild rewrites, and they are raw
data in the same sense as the IMDb downloads. `pipeline/rebuild.py --network`
regenerates them from TMDB, OMDb and Wikidata; without keys, the offline
stages still run from the committed artifacts.
