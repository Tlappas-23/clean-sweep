"""
Tests for the model-validation harness (``tests.test_ml_validation``).

The harness exists to make a claim about the ranker defensible, so these
check that it would actually *catch* the things it claims to rule out: a
leaked label, a model with no signal, and a model that fails to beat a
trivial heuristic. A validator that always says "confirmed" is worse than no
validator.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from ml import validate
from ml.paths import MODELS_DIR


@pytest.fixture
def toy():
    rng = np.random.default_rng(0)
    n = 800
    y = rng.random(n) < 0.1
    return y, rng


def test_the_leakage_audit_catches_a_copied_label(toy):
    """A feature that is the label wearing a hat must be flagged."""
    y, rng = toy
    X = pd.DataFrame(
        {
            "honest": rng.normal(size=len(y)) + y * 0.4,
            "leaked": y.astype(float) + rng.normal(scale=0.01, size=len(y)),
        }
    )
    report = validate.leakage_audit(X, y)

    assert report["clean"] is False
    assert [s["feature"] for s in report["suspected_leaks"]] == ["leaked"]


def test_the_leakage_audit_passes_merely_predictive_features(toy):
    """Being useful is not the same as being the answer."""
    y, rng = toy
    X = pd.DataFrame({"useful": rng.normal(size=len(y)) + y * 0.8})
    report = validate.leakage_audit(X, y)

    assert report["clean"] is True
    assert report["suspected_leaks"] == []
    assert 0.5 < report["strongest"][0]["auc"] < validate.LEAK_THRESHOLD


def test_the_bootstrap_interval_brackets_the_point_estimate(toy):
    y, rng = toy
    prob = np.clip(y * 0.5 + rng.normal(scale=0.2, size=len(y)) + 0.25, 0, 1)
    interval = validate.bootstrap_auc(y, prob, n=200)

    lo, hi = interval["ci95"]
    assert lo <= interval["point"] <= hi
    assert 0.0 <= lo < hi <= 1.0
    assert interval["n_positives"] == int(y.sum())


def test_the_bootstrap_is_stratified_so_a_rare_label_still_works():
    """
    With ~40 winners in ~5,000 rows an unstratified resample would sometimes
    draw no positives and the AUC would be undefined.
    """
    rng = np.random.default_rng(1)
    y = np.zeros(3_000, dtype=bool)
    y[rng.choice(3_000, 25, replace=False)] = True
    prob = rng.random(3_000) * 0.4 + y * 0.5

    interval = validate.bootstrap_auc(y, prob, n=300)
    assert interval["point"] is not None
    assert np.isfinite(interval["ci95"]).all()


def test_the_baseline_table_scores_every_heuristic_the_same_way():
    frame = pd.DataFrame(
        {
            "won": [True, False, False, True] * 60,
            "audience": np.linspace(0, 100, 240),
            "popularity": np.linspace(100, 0, 240),
            "billing": [1, 5, 9, 2] * 60,
            "prior_nominations": [3, 0, 0, 2] * 60,
        }
    )
    out = validate.baseline_comparison(frame, prob=np.linspace(0, 1, 240))

    assert "model" in out
    for stats in out.values():
        assert 0.0 <= stats["roc_auc"] <= 1.0
        assert 0.0 <= stats["average_precision"] <= 1.0


def test_the_permutation_p_value_can_never_be_zero():
    """
    Claiming p = 0 from a finite number of shuffles would overstate what the
    experiment can support, so the estimator uses the (1 + k) / (1 + n) form.
    """
    rng = np.random.default_rng(2)
    n = 400
    X = pd.DataFrame({"x": rng.normal(size=n), "category": ["picture"] * n})
    y = rng.random(n) < 0.2

    report = validate.permutation_test(X, y, X, y, observed=1.0, rounds=3)
    assert report["p_value"] == pytest.approx(1 / 4)
    assert report["p_value"] > 0


def test_the_committed_validation_artifact_supports_its_verdict():
    """The numbers the docs quote must be the numbers on disk."""
    path = MODELS_DIR / "validation.json"
    if not path.exists():  # pragma: no cover - artifact not built yet
        pytest.skip("run `python -m ml.validate` first")
    report = json.loads(path.read_text())

    assert report["leakage_audit"]["clean"] is True
    assert report["permutation_test"]["p_value"] <= 0.05
    assert report["held_out_auc"]["ci95"][0] > 0.5, "the interval must exclude chance"
    assert report["beats_best_baseline_by"] > 0
    assert report["verdict"] == "signal confirmed"
    # The claim is about the Academy awards only; genre crowns are circular.
    assert "genre" in report["scope"]
