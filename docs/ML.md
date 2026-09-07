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
  and a **within-year ranking metric**: for each (year, category) in the test
  set, the rank of the true winner among the pool (MRR / hit@5). Results are
  written to `data/models/ranker_metrics.json` and surfaced at
  `/api/analytics/ranker`.
* **Output:** `prestige = 100 * P(win)` rescaled to a 0–100 percentile
  *within (year, category)* so it is comparable across eras.

## 2. Film archetypes (unsupervised clustering)

**Question:** what kinds of films exist in the pool, independent of awards?

* **Rows:** `films.parquet` (one row per film).
* **Features:** `imdb_rating, log_votes, runtime_minutes, year, genre
  one-hots, (box_office, rt_critic, metascore when present)`, standardised.
* **Model:** `KMeans` with k chosen by silhouette over k ∈ [4, 8]; PCA to
  2-D for visualisation. Cluster labels are named by inspecting centroids in
  `cluster.py` (a small rule table maps centroid patterns to names such as
  *Critical Darling*, *Crowd-Pleaser*, *Prestige Drama*, *Cult Favourite*,
  *Blockbuster*, *Genre Picture*).
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
