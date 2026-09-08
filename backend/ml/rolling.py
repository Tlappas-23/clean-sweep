"""
Rolling-origin validation and nested tuning (``ml.rolling``).

    python -m ml.rolling                # both, writes data/models/rolling.json
    python -m ml.rolling --no-tuning    # folds only, much faster

Why this exists
---------------
``ml.train_ranker`` reports one number from one temporal split: train on
everything before 2019, test on 2019 and after. That split is the right
*shape*, because predicting a future the model has not seen is the only
version of the question the game asks, and a random split would let a 2021
winner be learned from its own year's runners-up.

But one split is one draw. The 2019+ years could be unusually easy or
unusually hard, and a single ROC-AUC cannot tell the difference between a
model that generalises and a model that got a friendly test set. Nothing in
the previous report distinguished those two, which is the gap this closes.

Rolling origin
--------------
The standard answer for time-ordered data. Fit on everything up to year *k*,
score on year *k+1*, advance, repeat. Each fold trains on strictly more
history than the last, no fold ever sees its own future, and the result is a
distribution rather than a point.

The folds are not independent, so their spread is not a confidence interval
and is not presented as one: consecutive fits share almost all their training
data, so their scores are correlated and the spread understates true
uncertainty. What it *does* show is stability, which is what a single split
cannot show at all.

Nested tuning
-------------
The constants in ``train_ranker.make_pipeline`` were chosen by hand and a
comment says they were "checked on the temporal split". That is exactly the
bias this module removes: choosing hyperparameters by looking at the test set
and then reporting the test score makes the score optimistic, because the
choice already used the answer.

So the search runs *inside* each fold. For fold *k* the candidates are scored
on an inner split carved out of that fold's training years only, the winner is
refitted on the fold's full training data, and only then does it see year
*k+1*. Year *k+1* is never used to choose anything. The outer scores are
therefore an honest estimate of the whole procedure, tuning included, rather
than of a model that was allowed a look ahead.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.paths import MODELS_DIR, ensure_dirs
from ml.train_ranker import (
    build_contender_features,
    load_seed,
    make_pipeline,
    top_genres,
)

#: First year scored as a fold. Earlier years are history for the first fit.
#: 2005 leaves roughly fifteen years of training data before the first fold,
#: which is the point where a fold's winners stop being too few to score.
FIRST_FOLD_YEAR = 2005

#: A fold needs enough positives for an AUC to mean anything. Below this the
#: year is folded into training rather than scored, and the report says so.
MIN_FOLD_WINNERS = 3

#: The hyperparameter grid. Deliberately small and readable rather than an
#: exhaustive sweep: with ~1% positives and a few hundred winners the risk is
#: overfitting the search itself, and each extra point costs one refit per
#: fold. The axes are the three that actually move this problem: how fast it
#: learns, how much tree it is allowed, and how hard the leaves are
#: regularised.
GRID: list[dict[str, Any]] = [
    {"learning_rate": lr, "max_leaf_nodes": leaves, "min_samples_leaf": leaf, "max_iter": iters}
    for lr, iters in ((0.05, 150), (0.1, 100))
    for leaves in (15, 31)
    for leaf in (50, 100)
]

#: Years held out of a fold's training data to choose hyperparameters on. The
#: inner split is temporal too: choosing on a random slice would let the
#: search see the future it is being tuned to predict.
INNER_HOLDOUT_YEARS = 3


def _fit_score(
    params: dict[str, Any],
    X: pd.DataFrame,
    y: np.ndarray,
    fit_mask: np.ndarray,
    score_mask: np.ndarray,
) -> tuple[float, np.ndarray]:
    """Fit with ``params`` on one mask and score on another. Returns (AUC, probs)."""
    pipe = make_pipeline()
    pipe.set_params(**{f"model__{k}": v for k, v in params.items()})
    pipe.fit(X[fit_mask], y[fit_mask])
    prob = pipe.predict_proba(X[score_mask])[:, 1]
    if len(np.unique(y[score_mask])) < 2:
        return float("nan"), prob
    return float(roc_auc_score(y[score_mask], prob)), prob


def choose_params(
    X: pd.DataFrame, y: np.ndarray, years: np.ndarray, train_below: int
) -> tuple[dict[str, Any], int]:
    """
    Pick hyperparameters using only the years available to this fold.

    The inner holdout is the last :data:`INNER_HOLDOUT_YEARS` of the fold's
    own training range, so the search is asked the same kind of question the
    fold is: predict years you have not seen. The fold's test year is not
    touched, which is the whole point of nesting.
    """
    inner_test = (years >= train_below - INNER_HOLDOUT_YEARS) & (years < train_below)
    inner_train = years < train_below - INNER_HOLDOUT_YEARS

    # Not enough inner signal to choose on: fall back to the first candidate
    # rather than choosing on noise, and say how many were really compared.
    if inner_train.sum() < 500 or y[inner_test].sum() < MIN_FOLD_WINNERS:
        return GRID[0], 0

    best, best_auc = GRID[0], -1.0
    for params in GRID:
        auc, _ = _fit_score(params, X, y, inner_train, inner_test)
        if not np.isnan(auc) and auc > best_auc:
            best, best_auc = params, auc
    return best, len(GRID)


def run(tune: bool = True) -> dict:
    """Roll the origin forward one year at a time and report every fold."""
    ensure_dirs()
    started = time.time()
    contenders, films = load_seed()
    X = build_contender_features(contenders, films, top_genres(films))
    y = contenders["won"].to_numpy(dtype=bool)
    years = contenders["year"].to_numpy()

    fold_years = [
        int(yr)
        for yr in sorted(set(years))
        if yr >= FIRST_FOLD_YEAR and (years == yr).sum() > 0 and y[years == yr].sum() >= MIN_FOLD_WINNERS
    ]
    print(f"rolling origin: {len(fold_years)} folds, {fold_years[0]}..{fold_years[-1]}")
    print(f"tuning: {'nested, ' + str(len(GRID)) + ' candidates per fold' if tune else 'off'}\n")
    print(f"  {'year':>6s} {'train':>8s} {'test':>6s} {'wins':>5s} {'AUC':>7s} {'AP':>7s}  params")

    folds = []
    for yr in fold_years:
        train_mask = years < yr
        test_mask = years == yr
        if train_mask.sum() < 1000:
            continue

        params, n_tried = choose_params(X, y, years, yr) if tune else (GRID[0], 0)
        auc, prob = _fit_score(params, X, y, train_mask, test_mask)
        ap = float(average_precision_score(y[test_mask], prob))
        shown = (
            f"lr={params['learning_rate']} leaves={params['max_leaf_nodes']} "
            f"leaf={params['min_samples_leaf']}"
        )
        print(
            f"  {yr:>6d} {int(train_mask.sum()):>8,} {int(test_mask.sum()):>6,} "
            f"{int(y[test_mask].sum()):>5d} {auc:>7.3f} {ap:>7.3f}  {shown}"
        )
        folds.append(
            {
                "year": yr,
                "n_train": int(train_mask.sum()),
                "n_test": int(test_mask.sum()),
                "n_winners": int(y[test_mask].sum()),
                "roc_auc": round(auc, 4),
                "average_precision": round(ap, 4),
                "params": params,
                "candidates_compared": n_tried,
            }
        )

    aucs = [f["roc_auc"] for f in folds if not np.isnan(f["roc_auc"])]
    summary = {
        "n_folds": len(folds),
        "mean_roc_auc": round(float(statistics.mean(aucs)), 4),
        "median_roc_auc": round(float(statistics.median(aucs)), 4),
        # Spread across folds, NOT a confidence interval: consecutive fits
        # share nearly all their training data, so the folds are correlated
        # and this understates true uncertainty. It measures stability.
        "sd_across_folds": round(float(statistics.stdev(aucs)), 4) if len(aucs) > 1 else 0.0,
        "min_roc_auc": round(min(aucs), 4),
        "max_roc_auc": round(max(aucs), 4),
        "worst_year": int(min(folds, key=lambda f: f["roc_auc"])["year"]),
    }

    # Which settings the search actually preferred, across folds. If the answer
    # is "a different one every time", the tuning is fitting noise and the
    # hand-picked constants were as good a choice as any.
    chosen: dict[str, int] = {}
    for f in folds:
        key = json.dumps(f["params"], sort_keys=True)
        chosen[key] = chosen.get(key, 0) + 1
    summary["params_chosen"] = [
        {"params": json.loads(k), "folds": v} for k, v in sorted(chosen.items(), key=lambda kv: -kv[1])
    ]
    summary["tuning"] = "nested" if tune else "off"
    summary["grid_size"] = len(GRID) if tune else 0
    summary["first_fold_year"] = FIRST_FOLD_YEAR
    summary["inner_holdout_years"] = INNER_HOLDOUT_YEARS
    summary["duration_seconds"] = round(time.time() - started, 1)

    # When tuning is on, score the untuned constants over the same folds too.
    # The comparison is the point of nesting: if the search does not beat the
    # settings that were already there, that is the finding, and it has to
    # live in the artifact rather than in someone's memory of a console.
    if tune:
        baseline_aucs = []
        for fold in folds:
            yr = fold["year"]
            auc, _ = _fit_score(GRID[0], X, y, years < yr, years == yr)
            baseline_aucs.append(auc)
        summary["untuned_baseline"] = {
            "params": GRID[0],
            "mean_roc_auc": round(float(statistics.mean(baseline_aucs)), 4),
            "sd_across_folds": round(float(statistics.stdev(baseline_aucs)), 4),
            "tuning_gain": round(float(statistics.mean(aucs) - statistics.mean(baseline_aucs)), 4),
        }
        gain = summary["untuned_baseline"]["tuning_gain"]
        summary["tuning_verdict"] = (
            "tuning did not beat the hand-picked constants; the search is fitting fold noise"
            if gain <= 0
            else f"tuning gained {gain:+.4f} mean AUC over the hand-picked constants"
        )
        print(
            f"\n  untuned constants over the same folds: "
            f"{summary['untuned_baseline']['mean_roc_auc']} "
            f"(tuning gain {gain:+.4f})"
        )
        print(f"  {summary['tuning_verdict']}")

    report = {"summary": summary, "folds": folds}
    path = MODELS_DIR / "rolling.json"
    path.write_text(json.dumps(report, indent=2) + "\n")

    print(
        f"\n  mean AUC {summary['mean_roc_auc']} across {summary['n_folds']} folds "
        f"(sd {summary['sd_across_folds']}, worst {summary['min_roc_auc']} in {summary['worst_year']})"
    )
    print(f"  wrote {path.name} in {summary['duration_seconds']}s")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-tuning", action="store_true", help="skip the nested search")
    args = parser.parse_args(argv)
    run(tune=not args.no_tuning)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
