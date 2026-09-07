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

  Held-out results (train ≤ 2018, test 2019–2025):

  | Task | ROC-AUC | Avg precision | Brier | MRR | hit@1 | hit@5 |
  |------|---------|---------------|-------|-----|-------|-------|
  | Winner   | 0.876 | 0.151 | 0.030 | 0.379 | 0.262 | 0.476 |
  | Nominee  | 0.945 | 0.554 | 0.069 | 0.746 | 0.595 | 0.929 |

  Pools run from ~40 (Best Picture) to ~330 (Supporting Actor), so hit@1 of
  26% on the winner task is far above the ~1–2 % a
  random pick would score. The top permutation importances are billing,
  acclaim and popularity: the model has learnt that Oscar winners are
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
  *Vintage Classic*, *Modern Classic* (silhouette 0.172), which is both a
  worse label and a redundant one, since the year is already printed on every
  card. Dropping it lifts the silhouette to 0.188 and
  produces archetypes about the *kind* of film. Mean year is still reported in
  each centroid.
* **Model:** `KMeans` with k chosen by silhouette over k ∈ [4, 8] (chose
  k = 4); PCA to 2-D for visualisation. Cluster labels come from an
  ordered rule table over the standardised centroids in `cluster.py`, so
  names stay stable when cluster ids permute.

  | Archetype | Films | Mean rating | Mean runtime | Examples |
  |-----------|-------|-------------|--------------|----------|
  | Character Drama | 1719 | 6.99 | 98 min | The Rescuers, An American Tail |
  | Modern Classic | 1442 | 7.58 | 110 min | Seven, The Silence of the Lambs |
  | Blockbuster | 846 | 6.27 | 111 min | Captain America: The First Avenger, Iron Man 2 |
  | Prestige Drama | 539 | 7.66 | 158 min | The Shawshank Redemption, The Dark Knight |
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
