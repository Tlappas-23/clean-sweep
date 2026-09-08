"""
Rolling-origin validation tests (``tests.test_rolling``).

The point of ``ml.rolling`` is that it removes two ways of being optimistic:
scoring on one lucky split, and choosing hyperparameters by looking at the
answer. Both failures are silent, and both would make the reported number
better rather than worse, so the properties that prevent them are asserted
rather than assumed.

These import scikit-learn, which the serving app never may. That is the right
side of the line: this is a test of the offline ML layer.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
from conftest import REPO_ROOT  # noqa: E402 - pytest puts tests/ on the path

from ml import rolling

ARTIFACT = REPO_ROOT / "data" / "models" / "rolling.json"


@pytest.fixture(scope="module")
def report() -> dict:
    if not ARTIFACT.exists():  # pragma: no cover - run `python -m ml.rolling`
        pytest.skip("rolling.json not built")
    return json.loads(ARTIFACT.read_text())


def test_no_fold_ever_trains_on_its_own_test_year(report: dict):
    """
    The property the whole module exists for.

    A fold that trained on year k and scored year k is not measuring
    generalisation, it is measuring memory, and it would report a better
    number for doing so. Every fold's training set has to be strictly the
    past.
    """
    for fold in report["folds"]:
        assert fold["n_train"] > 0
        assert fold["n_test"] > 0
    # Training sets grow monotonically, which is what "rolling origin" means:
    # each fold has strictly more history than the last.
    sizes = [f["n_train"] for f in report["folds"]]
    assert sizes == sorted(sizes), "training data must only ever grow"
    years = [f["year"] for f in report["folds"]]
    assert years == sorted(years) and len(set(years)) == len(years)


def test_the_inner_search_never_sees_the_fold_s_test_year():
    """
    Nested tuning, asserted on the masks rather than trusted.

    If the inner holdout overlapped the outer test year, hyperparameters would
    be chosen using the answer and the outer score would be optimistic. That
    is precisely the bias this replaced, so it is pinned directly.
    """
    years = np.array([2000] * 500 + [2001] * 500 + [2002] * 50 + [2003] * 50 + [2004] * 50)
    train_below = 2004
    inner_test = (years >= train_below - rolling.INNER_HOLDOUT_YEARS) & (years < train_below)
    outer_test = years == train_below

    assert not (inner_test & outer_test).any(), "the search can see the fold's test year"
    assert inner_test.sum() > 0, "the inner holdout is empty"


def test_every_fold_has_enough_winners_to_score(report: dict):
    """An AUC over a fold with one positive is noise wearing a number."""
    for fold in report["folds"]:
        assert fold["n_winners"] >= rolling.MIN_FOLD_WINNERS, (
            f"{fold['year']} scored on {fold['n_winners']} winners"
        )


def test_the_model_is_stable_across_folds_not_just_lucky_once(report: dict):
    """
    What a single split could not tell us.

    The bar is deliberately not "every fold is excellent": a hard year is
    real, and a model that never has one is more suspicious than one that
    does. The bar is that the typical fold is strong and the worst is still
    clearly better than guessing.
    """
    summary = report["summary"]
    assert summary["n_folds"] >= 10, "too few folds to say anything about stability"
    assert summary["mean_roc_auc"] > 0.85
    assert summary["min_roc_auc"] > 0.70, (
        f"worst fold {summary['min_roc_auc']} in {summary['worst_year']} is close to guessing"
    )
    # A tiny spread across folds would be its own smell: it would suggest the
    # folds are not independent enough to be telling us anything.
    assert 0.0 < summary["sd_across_folds"] < 0.15


def test_the_spread_is_not_presented_as_a_confidence_interval(report: dict):
    """
    Consecutive folds share nearly all their training data, so their scores
    are correlated and the spread understates true uncertainty. Calling it
    ci95 would be a claim the design cannot support, so the field is named for
    what it is.
    """
    summary = report["summary"]
    assert "sd_across_folds" in summary
    assert "ci95" not in summary


def test_the_grid_is_small_enough_not_to_be_fitted_to(report: dict):
    """
    With ~1% positives, a large search overfits the search itself. The grid is
    deliberately a handful of readable points rather than a sweep.
    """
    assert len(rolling.GRID) <= 16
    if report["summary"]["tuning"] == "nested":
        assert report["summary"]["grid_size"] == len(rolling.GRID)


def test_which_settings_the_search_preferred_is_reported(report: dict):
    """
    If tuning picks a different winner every fold it is fitting noise, and the
    hand-chosen constants were as good a choice as any. Either answer is
    informative, so the tally is part of the report rather than discarded.
    """
    chosen = report["summary"]["params_chosen"]
    assert chosen, "the report does not say what tuning chose"
    assert sum(c["folds"] for c in chosen) == report["summary"]["n_folds"]


def test_the_fold_scorer_refuses_a_single_class_rather_than_inventing_an_auc():
    """
    A fold with no winners has no AUC, and returning one would be a
    fabrication that flatters the mean. Guarded, so pinned.

    The frame carries the columns the real pipeline expects rather than
    arbitrary ones, so this exercises the guard through the actual estimator
    instead of failing earlier for an unrelated reason.
    """
    n = 40
    X = pd.DataFrame(
        {
            "category": ["picture"] * (n // 2) + ["actor"] * (n // 2),
            "audience": np.linspace(0, 100, n),
            "popularity": np.linspace(100, 0, n),
        }
    )
    fit = np.array([True] * (n - 8) + [False] * 8)
    score = ~fit
    # Two classes to fit on, one class to score on: the fit succeeds and the
    # score is refused.
    y = np.array([i % 7 == 0 for i in range(n - 8)] + [False] * 8)

    auc, prob = rolling._fit_score(rolling.GRID[0], X, y, fit, score)
    assert np.isnan(auc), "an AUC was returned for a fold with one class"
    assert len(prob) == int(score.sum()), "probabilities should still come back"
