"""
Artifact locations for the ML layer.

Architecture note
-----------------
The ML scripts are launched as modules from ``backend/`` (``python -m
ml.train_ranker``) but every path is resolved relative to the repository
root, mirroring ``pipeline/paths.py``, so they also work from a notebook or a
CI runner with a different working directory. Inputs live in ``data/seed``
(produced by the pipeline), outputs go to ``data/models`` (model files and
JSON summaries) and back into ``data/seed`` (the per-contender scores).
"""

from __future__ import annotations

from pathlib import Path

# backend/ml/paths.py -> backend/ml -> backend -> <repo>
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SEED_DIR = DATA_DIR / "seed"
MODELS_DIR = DATA_DIR / "models"

# Inputs (written by backend/pipeline).
CONTENDERS_PATH = SEED_DIR / "contenders.parquet"
FILMS_PATH = SEED_DIR / "films.parquet"

# Outputs.
ML_SCORES_PATH = SEED_DIR / "ml_scores.parquet"
RANKER_MODEL_PATH = MODELS_DIR / "ranker.joblib"
RANKER_METRICS_PATH = MODELS_DIR / "ranker_metrics.json"
ARCHETYPES_MODEL_PATH = MODELS_DIR / "archetypes.joblib"
CLUSTER_SUMMARY_PATH = MODELS_DIR / "cluster_summary.json"


def ensure_dirs() -> None:
    """Create the output directories if they do not exist yet."""
    for d in (SEED_DIR, MODELS_DIR):
        d.mkdir(parents=True, exist_ok=True)
