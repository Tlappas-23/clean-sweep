# Clean Sweep — Machine learning

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
* **Features** (no leakage — nothing derived from `nominated`/`won` of the
  same row):
  `imdb_rating, log_votes, acclaim, popularity, box_office (nullable),
  runtime_minutes, year, decade, category, billing, prior_nominations,
  prior_wins, genre one-hots (top 15), rt_critic, metascore (nullable)`.
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
  against a genre crown that is *computed from rating and vote count* — both
  model features — so the model predicts those two categories almost
  perfectly and would otherwise inflate the headline. **The Academy row is
  the one that says whether the model learnt anything about the Academy.**

  | Group | ROC-AUC | Avg precision | hit@1 | hit@5 | Winners in test |
  |-------|---------|---------------|-------|-------|-----------------|
  | Academy categories | 0.904 | 0.195 | 0.286 | 0.548 | 43 |
  | Genre crowns | 0.976 | 0.797 | 0.786 | 1.000 | 14 |
  | Combined (headline) | 0.924 | 0.351 | 0.411 | 0.661 | 57 |

  The nominee task (predicting a nomination rather than a win) reaches
  0.955 ROC-AUC. Pools run from ~40 to ~330
  candidates, so identifying the actual Oscar winner first try
  29% of the time is far above the 1–2% a random
  pick would score. The top permutation importances are billing, acclaim,
  category, popularity and box office: the model has learnt that winners are
  top-billed leads in well-regarded, widely-seen films.

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
  simply rediscovers the calendar — the clusters come back as *Golden Age*,
  *Vintage Classic*, *Modern Classic*, which is both a worse label and a
  redundant one, since the year is already printed on every card. Dropping it
  raises the silhouette and produces archetypes about the *kind* of film. Mean
  year is still reported in each centroid.
* **Every cluster gets a real name.** The ordered rule table can leave a
  cluster unmatched; rather than shipping "Archetype 5" onto a contender card,
  a fallback composes a name from the centroid's most extreme coordinate
  (liked far more than seen → *Cult Favourite*, seen far more than liked →
  *Crowd-Pleaser*, and so on).
* **Model:** `KMeans` with k chosen by silhouette over k ∈ [4, 8] (chose
  k = 7); PCA to 2-D for visualisation. Cluster labels come from an
  ordered rule table over the standardised centroids in `cluster.py`, so
  names stay stable when cluster ids permute.

  | Archetype | Films | Mean rating | Mean runtime | Examples |
  |-----------|-------|-------------|--------------|----------|
  | Character Drama | 1704 | 7.05 | 97 min | The Killing, Pink Floyd: The Wall |
  | Blockbuster | 1351 | 6.82 | 109 min | Seven, Batman Begins |
  | Cult Favourite | 740 | 7.18 | 102 min | Requiem for a Dream, Don't Look Up |
  | Genre Picture | 657 | 5.32 | 83 min | Snow White, Radhe |
  | Prestige Drama | 643 | 7.46 | 148 min | Fight Club, Interstellar |
  | Modern Classic | 349 | 7.90 | 126 min | The Shawshank Redemption, The Dark Knight |
  | Crowd-Pleaser | 248 | 6.70 | 119 min | Star Wars: Episode I - The Phantom Menace, The Hobbit: An Unexpected Journey |

* **Output:** `archetype` and `cluster_id` per film → joined to contenders;
  `data/models/archetypes.joblib` (scaler + kmeans + pca) and
  `data/models/cluster_summary.json` for `/api/analytics/clusters`.

## Reproducing

```
cd backend
python -m ml.train_ranker      # ~30 s
python -m ml.cluster           # ~5 s
python -m ml.evaluate          # prints the metrics tables
```

All scripts are seeded (`random_state=42`).
