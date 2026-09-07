"""
Clean Sweep - offline machine-learning layer.

Architecture note
-----------------
This package sits between the data pipeline and the API (see
docs/ARCHITECTURE.md). It reads the seed tables in ``data/seed`` and writes
two kinds of output:

* **Scores** - ``data/seed/ml_scores.parquet``: one row per contender with a
  ``prestige`` score and a film ``archetype``. The API joins this table at
  startup; inference on the request path is a dictionary lookup, never a
  scikit-learn call.
* **Artifacts** - ``data/models/*.joblib`` and the two ``*.json`` summaries
  that back the ``/api/analytics/*`` endpoints (feature importances,
  calibration, cluster centroids, PCA scatter).

Modules
-------
``features``      shared feature engineering + leakage guards
``train_ranker``  supervised prestige ranker (HistGradientBoosting)
``cluster``       unsupervised film archetypes (KMeans + PCA)
``scores``        merge helpers for ``ml_scores.parquet``
``evaluate``      prints the metrics tables and a few sanity checks
``paths``         artifact locations

Everything is seeded with ``random_state=42`` so re-running the three
scripts reproduces the committed artifacts bit for bit.
"""

RANDOM_STATE = 42
