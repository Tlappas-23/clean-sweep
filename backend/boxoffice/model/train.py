"""
Rolling-origin evaluation against the baselines that matter.

Three decisions are worth naming, because each had a more convenient
alternative that would have flattered the result.

**Temporal folds, never random.** Train on everything released before a cutoff
year, score the films released in it, roll the cutoff forward. Random K-fold on
this problem lets a model learn 2019 from 2021 and is the second most common
way box office models get flattered, after using the ratings.

**Gradient boosting with native missing-value support, no imputation.** A first
film from a first-time director genuinely has no prior gross. Imputing the
median there invents a career that did not exist and tells the model that every
debut is average. `HistGradientBoostingRegressor` splits on missingness
directly, so "no track record" stays a fact rather than becoming a guess.

**Judged in log space and in dollars.** The model is fit on log revenue because
the target spans five orders of magnitude and squared error in dollars is
decided by six films. But nobody greenlights in logs, so the headline metric is
the share of predictions inside a factor of two, which is how the forecast
would actually be used.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.leakage import assert_clean

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "data" / "features.parquet"
META = ("film_key", "title", "imdb_id", "release_date")


# The shipped configuration, defined once. Every study imports this rather than
# writing its own copy, because six copies is how "tuned" and "shipped" drifted
# apart and nobody noticed.
#
# It is scikit-learn's defaults, and that is the outcome of model/tune.py rather
# than a shrug. A hand-set configuration shipped for months and was beaten by
# the defaults on held-out folds; a randomised search then picked a winner on
# 2010-2018 that turned out to be the *worst* of the three on 2019-2026. Both
# lost the same way, by fitting the folds they were chosen on. The least-fitted
# option generalised best, and when the differences are inside noise that is
# the option to ship.
SHIPPED_PARAMS: dict = dict(random_state=0)


def model() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(**SHIPPED_PARAMS)


@dataclass
class Fold:
    year: int
    n_train: int
    n_test: int
    mae_log: dict[str, float]
    within_2x: dict[str, float]


def feature_columns(frame: pd.DataFrame) -> list[str]:
    """Every modelling column in a feature matrix, selected by exclusion.

    The numeric filter is not cosmetic. Selecting by exclusion means anything
    joined onto the matrix later becomes a feature by default, and a frame with
    projections merged in will happily offer the model its own predictions.
    Restricting to numeric columns does not catch that on its own, so callers
    pass the matrix as built rather than as augmented; this is the backstop.
    """
    return [
        c
        for c in frame.columns
        if not c.startswith("y_")
        and c not in META
        and c != "is_upcoming"
        and pd.api.types.is_numeric_dtype(frame[c])
    ]


def _within_2x(truth_log: np.ndarray, pred_log: np.ndarray) -> float:
    """Share of predictions inside a factor of two of the actual gross."""
    ratio = np.expm1(pred_log) / np.maximum(np.expm1(truth_log), 1.0)
    return float(np.mean((ratio >= 0.5) & (ratio <= 2.0)))


def run(frame: pd.DataFrame, cols: list[str], first_year: int = 2010) -> list[Fold]:
    assert_clean(frame[cols])
    # Unreleased films carry no target and must never enter a fold, in either
    # direction: they cannot be trained on and they cannot be scored.
    if "is_upcoming" in frame.columns:
        frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    frame = frame.sort_values("release_date")
    years = sorted(y for y in frame["release_date"].dt.year.unique() if y >= first_year)

    folds: list[Fold] = []
    for year in years:
        train = frame[frame["release_date"].dt.year < year]
        test = frame[frame["release_date"].dt.year == year]
        if len(train) < 200 or len(test) < 20:
            continue

        y_tr = train["y_log_worldwide"].to_numpy()
        y_te = test["y_log_worldwide"].to_numpy()
        preds: dict[str, np.ndarray] = {}

        # Baseline 1: the median film. The bar any model must clear.
        preds["median"] = np.full(len(test), float(np.median(y_tr)))

        # Baseline 2: budget alone. This is the real bar, and it is a strong
        # one: what a studio spends is most of what a studio makes.
        bt = train[["log_budget"]].to_numpy()
        lr = LinearRegression().fit(bt, y_tr)
        preds["budget_only"] = lr.predict(test[["log_budget"]].to_numpy())

        # The model.
        gb = model()
        gb.fit(train[cols].to_numpy(dtype="float64"), y_tr)
        preds["model"] = gb.predict(test[cols].to_numpy(dtype="float64"))

        folds.append(
            Fold(
                year=year,
                n_train=len(train),
                n_test=len(test),
                mae_log={k: float(np.mean(np.abs(v - y_te))) for k, v in preds.items()},
                within_2x={k: _within_2x(y_te, v) for k, v in preds.items()},
            )
        )
    return folds


def summarise(folds: list[Fold]) -> pd.DataFrame:
    rows = []
    for name in ("median", "budget_only", "model"):
        rows.append(
            {
                "estimator": name,
                "mae_log": np.mean([f.mae_log[name] for f in folds]),
                "within_2x": np.mean([f.within_2x[name] for f in folds]),
            }
        )
    return pd.DataFrame(rows)


if __name__ == "__main__":
    data = pd.read_parquet(FEATURES)
    cols = feature_columns(data)
    result = run(data, cols)
    print(f"{len(result)} rolling-origin folds, {result[0].year}-{result[-1].year}\n")
    print(summarise(result).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("\nper fold (model vs budget-only, share within 2x):")
    for f in result:
        print(
            f"  {f.year}  n={f.n_test:3d}  model {f.within_2x['model']:.2f}"
            f"   budget {f.within_2x['budget_only']:.2f}"
        )
