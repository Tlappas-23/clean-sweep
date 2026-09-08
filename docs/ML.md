# Clean Sweep: Machine learning

Two offline models, both in `backend/ml/`. Their outputs are materialised
into `data/seed/ml_scores.parquet`; the serving path is a lookup.

## 1. Prestige ranker (supervised, learning-to-rank framed as classification)

**Question:** given what we can observe about a contender *without* looking at
the Oscar result, how much does it look like an Academy Award winner?

* **Training rows:** every contender in `contenders.parquet` from years
  1930–2020 (2021+ held out as a temporal test set, plus a stratified
  random split inside the training years for validation).
* **Label:** `won` (positive) vs everything else. A secondary evaluation
  treats `nominated` as the positive to show the model also separates
  nominees from the field.
* **Features** (no leakage: nothing derived from `nominated`/`won` of the
  same row):
  `imdb_rating, log_votes, audience, critics, popularity, box_office
  (nullable), runtime_minutes, year, decade, category, billing,
  prior_nominations, prior_wins, genre one-hots (top 15), rt_critic,
  metascore (nullable)`. `award_standing` is deliberately **not** a feature:
  it is built from Academy outcomes, so feeding it to a model that predicts
  Academy outcomes would be leakage.
* **Model:** `HistGradientBoostingClassifier` (handles NaN natively) inside
  a scikit-learn `Pipeline` with a `ColumnTransformer`. Class imbalance is
  handled with `class_weight="balanced"`.
* **Evaluation:** ROC-AUC, average precision, Brier score, calibration curve,
  and a **within-pool ranking metric**: for each (year, category) in the test
  set, the rank of the true winner among the pool (MRR / hit@k). Results are
  written to `data/models/ranker_metrics.json` and surfaced at
  `/api/analytics/ranker`.

  Held-out results (train ≤ 2018, test 2019–2025). The two groups are
  reported separately on purpose. Best Horror and Best Comedy are scored
  against a genre crown that is *computed from rating and vote count*, both of
  them model features. The model therefore predicts those two categories
  almost perfectly and would otherwise inflate the headline. **The Academy row
  is the one that says whether the model learnt anything about the Academy.**

  | Group | ROC-AUC | Avg precision | hit@1 | hit@5 | Winners in test |
  |-------|---------|---------------|-------|-------|-----------------|
  | Academy categories | 0.929 | 0.229 | 0.262 | 0.571 | 43 |
  | Genre crowns | 0.967 | 0.704 | 0.500 | 1.000 | 14 |
  | Combined (headline) | 0.943 | 0.351 | 0.321 | 0.679 | 57 |

  These figures are from the current fit; the daily refresh retrains and
  rewrites them.

  The nominee task (predicting a nomination rather than a win) reaches
  0.962 ROC-AUC. A pool holds 51 candidates at the median and over 300
  at most, so identifying the actual Oscar winner first try
  26% of the time is far above the 2% a random
  pick would score. The top permutation importances are billing, the IMDb
  rating percentile, category, popularity and box office: the model has learnt
  that winners are top-billed leads in well-regarded, widely-seen films.

* **Output:** `prestige = 100 * P(win)` rescaled to a 0–100 percentile
  *within (year, category)* so it is comparable across eras.

## 2. Film archetypes (unsupervised clustering)

**Question:** what kinds of films exist in the pool, independent of awards?

* **Rows:** `films.parquet` (one row per film).
* **Features:** `imdb_rating, log_votes, runtime_minutes, genre one-hots,
  (box_office, rt_critic, metascore when present)`, standardised. The genre
  block is multiplied by `1/sqrt(n_genres)` so fifteen 0/1 columns do not
  outweigh the three continuous ones.
* **Release year is deliberately excluded.** With `year` in the matrix KMeans
  simply rediscovers the calendar: the clusters come back as *Golden Age*,
  *Vintage Classic*, *Modern Classic*, which is both a worse label and a
  redundant one, since the year is already printed on every card. Dropping it
  raises the silhouette and produces archetypes about the *kind* of film. Mean
  year is still reported in each centroid.
* **Every cluster gets a real name.** The ordered rule table can leave a
  cluster unmatched; rather than shipping "Archetype 5" onto a contender card,
  a fallback composes a name from the centroid's most extreme coordinate
  (liked far more than seen → *Cult Favourite*, seen far more than liked →
  *Crowd-Pleaser*, and so on).
* **Model:** `KMeans` with k chosen by silhouette over k in [4, 8] (the
  current fit chose k = 6); PCA to 2-D for visualisation. Cluster labels come from an
  ordered rule table over the standardised centroids in `cluster.py`, so
  names stay stable when cluster ids permute.

  The table below is a snapshot of the current fit. Both the labels and
  `k` move when the catalogue does, so treat `/api/analytics/clusters` as
  the authority rather than this page.

  | Archetype | Films | Mean rating | Mean runtime | Examples |
  |-----------|-------|-------------|--------------|----------|
  | Blockbuster | 960 | 6.94 | 112 min | Joker, Shutter Island |
  | Prestige Drama | 911 | 7.35 | 125 min | The Kashmir Files, Zack Snyder's Justice League |
  | Genre Picture | 817 | 6.03 | 92 min | Radhe, It Comes at Night |
  | Modern Classic | 639 | 7.75 | 126 min | The Shawshank Redemption, The Dark Knight |
  | Guilty Pleasure | 434 | 6.02 | 109 min | Star Wars: Episode I - The Phantom Menace, Batman v Superman: Dawn of Justice |
  | Character Drama | 419 | 7.17 | 102 min | Don't Look Up, Moon |

* **Output:** `archetype` and `cluster_id` per film → joined to contenders;
  `data/models/archetypes.joblib` (scaler + kmeans + pca) and
  `data/models/cluster_summary.json` for `/api/analytics/clusters`.

## 3. Is the ranker real? (`python -m ml.validate`)

A held-out ROC-AUC is a number, not a finding. Three adversarial checks turn
it into one, and all of them are run **on the six real Academy categories
only**. The genre crowns are computed from IMDb rating and votes, which are
model features, so predicting them is circular and inflates everything it
touches.

**Leakage audit.** Every feature scored alone against the label. The strongest
is `billing` at 0.81, comfortably under the
0.9 threshold at which a column would be the answer in disguise.
Verdict: clean.

**A null that has to be beaten.** The labels are shuffled and the whole
pipeline retrained 199 times, giving the distribution of scores
obtainable from no signal at all at this class imbalance. The null averages
0.432 and its best run reaches 0.701. The real
model scores **0.927**, beating every shuffled run, so
**p = 0.005**. That is the smallest value 199 permutations can support.

**Baselines that are not straw men.** Beating chance is easy at 1 positive in
100. The comparisons that matter are the heuristics a person would use:

| Ranked by | ROC-AUC |
|-----------|---------|
| model | 0.927 |
| IMDb rating percentile | 0.792 |
| popularity (vote count percentile) | 0.725 |
| prior Oscar nominations | 0.640 |
| top billing | 0.552 |

The model clears the best of them by 0.135 AUC. Held-out AUC
0.927, 95% CI [0.894, 0.954] from a stratified
bootstrap of 2,000 resamples. The interval excludes chance by a wide
margin. **Verdict: signal confirmed.**

### What the model is *not* used for

Nothing in the score. `prestige` used to carry 0.17 of a pick's score, which
meant a player's record partly depended on what a gradient-boosted tree
guessed. It is now reported as analytics and shown on the card labelled as a
model estimate, and every point of the ballot comes from observable facts plus
the actual outcome. Removing it forced the ceremony weight from 0.50 to 0.60,
because prestige had been doing real work separating winners from losing
nominees. See `docs/BALANCE.md`.

## 4. Estimating the missing box office

TMDB and OMDb know the revenue of ~77% of the catalog, but only a third of the
1950s. `pipeline/boxoffice.py` fills the gap with a ratio estimator:

    log(revenue) = median log(revenue) of the film's group
                 + BETA * (log(votes) - median log(votes) of that group)

The group is the most specific one with at least 8 known films, tried
`(year, genre)` → `(decade, genre)` → `decade` → whole catalog. BETA is the
elasticity of log revenue to log votes, fitted *within* groups so it measures
the within-year relationship rather than inflation.

Validated by hiding each fifth of the known revenues in turn and scoring the
guesses on **within-year rank correlation**, which is what the game actually
consumes:

| Method | Spearman |
|--------|----------|
| Estimator | +0.456 ± 0.078 |
| Group median only | +0.287 ± 0.092 |
| Vote count only | +0.431 ± 0.079 |

Compared on matched years with a Wilcoxon signed-rank test, the estimator
beats the group median decisively (median gain +0.143, better in
51/76 years, p = 0.0008) but **does not** significantly beat
ranking on vote count alone (median gain +0.027, better in
43/76 years, p = 0.169).

That negative result decides how the estimate is used. Since the Box Office
metric is a within-year percentile, an estimated score would be a near-copy of
the Popularity score the ballot already counts, and double-counting one signal
under two names is worse than leaving a gap. So the estimate is **shown to the
player, clearly marked, and never scored**. Measured revenue lives in
`box_office_usd`; estimates live in `box_office_est_usd` and never overwrite a
measurement.

## Reproducing

```
cd backend
python -m ml.train_ranker            # ~30 s
python -m ml.cluster                 # ~5 s
python -m ml.validate                # ~6 min (199 permutation retrains)
python -m pipeline.boxoffice --validate
python -m ml.evaluate                # prints the metrics tables
```

All scripts are seeded (`random_state=42`).
