"""
Contract tests for the ML artifacts consumed by the API.

Architecture note
-----------------
These tests do not train anything; they check that what ``ml.train_ranker``
and ``ml.cluster`` committed to ``data/`` is complete and matches the shapes
the API serves (``RankerSummary`` / ``ClusterSummary`` in docs/API.md) and
the score table the catalog joins at startup (docs/DATA.md). They act as a
guard rail for two failure modes: a pipeline rebuild that changes contender
ids without re-running the ML step, and a model change that quietly drops a
key the frontend expects.

The quality bar (ROC-AUC on the temporal test set) is set a little below the
value obtained at the time of writing so that a re-train after data
enrichment passes as long as the model is still meaningfully predictive.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "data" / "seed"
MODELS_DIR = REPO_ROOT / "data" / "models"

ML_SCORES = SEED_DIR / "ml_scores.parquet"
RANKER_MODEL = MODELS_DIR / "ranker.joblib"
RANKER_METRICS = MODELS_DIR / "ranker_metrics.json"
ARCHETYPES_MODEL = MODELS_DIR / "archetypes.joblib"
CLUSTER_SUMMARY = MODELS_DIR / "cluster_summary.json"

# Observed 0.89 on the 2019-2025 hold-out; 0.5 is chance.
MIN_TEST_ROC_AUC = 0.80

pytestmark = pytest.mark.skipif(
    not (SEED_DIR / "contenders.parquet").exists(), reason="seed tables not built"
)


@pytest.fixture(scope="module")
def contenders() -> pd.DataFrame:
    return pd.read_parquet(SEED_DIR / "contenders.parquet")


@pytest.fixture(scope="module")
def scores() -> pd.DataFrame:
    return pd.read_parquet(ML_SCORES)


@pytest.fixture(scope="module")
def ranker_metrics() -> dict:
    return json.loads(RANKER_METRICS.read_text())


@pytest.fixture(scope="module")
def cluster_summary() -> dict:
    return json.loads(CLUSTER_SUMMARY.read_text())


# --------------------------------------------------------------- existence
@pytest.mark.parametrize("path", [ML_SCORES, RANKER_MODEL, RANKER_METRICS, ARCHETYPES_MODEL, CLUSTER_SUMMARY])
def test_artifact_exists(path: Path) -> None:
    assert path.exists(), f"missing artifact: {path} (run python -m ml.train_ranker && python -m ml.cluster)"
    assert path.stat().st_size > 0


# ------------------------------------------------------------- ml_scores
def test_scores_cover_every_contender(contenders: pd.DataFrame, scores: pd.DataFrame) -> None:
    assert list(scores.columns) == ["contender_id", "prestige", "archetype", "cluster_id"]
    assert scores["contender_id"].is_unique
    missing = set(contenders["contender_id"]) - set(scores["contender_id"])
    assert not missing, f"{len(missing)} contenders have no ML scores"
    stale = set(scores["contender_id"]) - set(contenders["contender_id"])
    assert not stale, f"{len(stale)} scored ids no longer exist in contenders.parquet"


def test_prestige_range(scores: pd.DataFrame) -> None:
    assert scores["prestige"].notna().all()
    assert scores["prestige"].between(0, 100).all()
    # Percentile within pool: every multi-member pool has a 0 and a 100.
    assert scores["prestige"].min() == 0 and scores["prestige"].max() == 100


def test_prestige_is_a_within_pool_percentile(contenders: pd.DataFrame, scores: pd.DataFrame) -> None:
    joined = contenders[["contender_id", "year", "category"]].merge(scores, on="contender_id")
    pool = joined[(joined["year"] == 1994) & (joined["category"] == "picture")]
    assert len(pool) > 5
    assert pool["prestige"].max() == pytest.approx(100.0)
    assert pool["prestige"].min() == pytest.approx(0.0)


def test_archetype_columns(scores: pd.DataFrame, cluster_summary: dict) -> None:
    assert scores["archetype"].notna().all()
    assert (scores["archetype"] != "").all()
    assert scores["cluster_id"].notna().all()
    assert str(scores["cluster_id"].dtype) == "int32"
    labels = {a["label"] for a in cluster_summary["archetypes"]}
    assert set(scores["archetype"].unique()) <= labels


# ------------------------------------------------------- RankerSummary
def test_ranker_metrics_shape(ranker_metrics: dict) -> None:
    m = ranker_metrics
    assert isinstance(m["model"], str) and m["model"]
    assert set(m["metrics"]) >= {"roc_auc", "average_precision", "brier", "n_train", "n_test"}
    for key in ("roc_auc", "average_precision", "brier"):
        assert 0.0 <= m["metrics"][key] <= 1.0
    assert isinstance(m["metrics"]["n_train"], int) and isinstance(m["metrics"]["n_test"], int)

    imps = m["feature_importances"]
    assert 1 <= len(imps) <= 15
    assert all(set(i) == {"feature", "importance"} for i in imps)
    assert [i["importance"] for i in imps] == sorted((i["importance"] for i in imps), reverse=True)

    cal = m["calibration"]
    assert 1 <= len(cal) <= 10
    for b in cal:
        assert set(b) == {"bin_mean_pred", "bin_frac_pos", "count"}
        assert 0.0 <= b["bin_mean_pred"] <= 1.0 and 0.0 <= b["bin_frac_pos"] <= 1.0
        assert isinstance(b["count"], int) and b["count"] > 0
    assert sum(b["count"] for b in cal) == m["metrics"]["n_test"]


def test_ranker_extra_sections(ranker_metrics: dict) -> None:
    m = ranker_metrics
    assert set(m["ranking"]) >= {"mrr", "hit_at_1", "hit_at_5", "n_pools"}
    assert 0.0 <= m["ranking"]["hit_at_1"] <= m["ranking"]["hit_at_5"] <= 1.0
    assert set(m["nominee_task"]) >= {"roc_auc", "average_precision", "brier", "n_train", "n_test", "ranking"}
    assert m["split"]["train_years"][1] < m["split"]["test_years"][0], "split must be temporal"


def test_ranker_is_predictive(ranker_metrics: dict) -> None:
    assert ranker_metrics["metrics"]["roc_auc"] > MIN_TEST_ROC_AUC
    assert ranker_metrics["nominee_task"]["roc_auc"] > MIN_TEST_ROC_AUC
    # A useless ranker would put the winner in the top five ~5/pool_size of the time (<10%).
    assert ranker_metrics["ranking"]["hit_at_5"] > 0.25


def test_no_outcome_feature_in_ranker(ranker_metrics: dict) -> None:
    declared = set(ranker_metrics.get("features", []))
    ranked = {i["feature"] for i in ranker_metrics["feature_importances"]}
    used = declared | ranked
    assert not used & {"nominated", "won", "nominations", "wins"}


# ------------------------------------------------------ ClusterSummary
def test_cluster_summary_shape(cluster_summary: dict, scores: pd.DataFrame) -> None:
    c = cluster_summary
    assert isinstance(c["features"], list) and c["features"]
    assert 4 <= len(c["archetypes"]) <= 8
    labels = [a["label"] for a in c["archetypes"]]
    assert len(labels) == len(set(labels)), "archetype names must be unique"
    for a in c["archetypes"]:
        assert set(a) >= {"label", "size", "centroid", "examples"}
        assert isinstance(a["size"], int) and a["size"] > 0
        # A centroid reports every populated film column, which is the
        # clustering features plus the deliberately excluded descriptive ones
        # (release year), so the clustering features must be a subset of it.
        reported = set(a["centroid"])
        assert set(c["features"]) <= reported
        assert reported <= set(c["features"]) | set(c.get("excluded_features", []))
        assert all(isinstance(v, int | float) for v in a["centroid"].values())
        assert 1 <= len(a["examples"]) <= 5 and all(isinstance(e, str) for e in a["examples"])

    pts = c["points"]
    assert 1 <= len(pts) <= 1500
    for p in pts[:50]:
        assert set(p) == {"film_id", "title", "year", "x", "y", "archetype"}
        assert p["archetype"] in labels
    # Sizes are film counts; the score table is contender-level, so only the labels must agree.
    assert set(scores["archetype"].unique()) == set(labels)
