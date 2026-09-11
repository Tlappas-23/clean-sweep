"""
Which learner, and what did the tuning buy?

The project asserted gradient boosting in a docstring and never showed the
alternatives, which is the kind of claim a reviewer is right to distrust. This
module answers it on the same rolling-origin folds as everything else, so the
numbers sit beside the ablation without a caveat.

Four candidates, chosen because each represents a different bet about the
problem rather than a different library:

**Ridge.** Box office in log space against log budget is close to linear, and a
regularised linear model is the honest null for "does this problem need
anything clever". It cannot see interactions and it cannot handle a missing
prior, which is the point: it has to impute, and the cost of imputing shows up
here as a number rather than as an argument.

**Random forest.** Trees without boosting. Same feature space, same missingness
problem, different bias-variance trade. If bagging matches boosting then the
sequential fitting is not earning its complexity.

**Gradient boosting, out of the box.** The shipped configuration is tuned, and
a tuned number quoted against untuned alternatives is a rigged comparison. This
row separates "boosting was the right family" from "the hyperparameters were
right", which are different claims and are usually conflated.

**A neural network.** Two hidden layers on the same 35 features. Worth running
because it is the thing people assume is missing, and worth running *properly*
so the answer is not an artefact of feeding it raw dollars: it gets the same
median imputation with indicators as the others, and then standardisation to
mean zero and unit variance, which is what a gradient-trained model needs.

A note on scaling, since it is the part most often got wrong. Trees do not care:
a split at `budget > 40m` is the same split whichever units budget is in, which
is why the boosters take the matrix untouched. Gradient-trained models do care,
because a feature measured in hundreds of millions and a zero-one flag sharing
one learning rate means one of them is effectively ignored. Standardising is the
convention rather than squeezing into a zero-to-one box, and an exact zero is a
perfectly good input value.

**Gradient boosting, as shipped.** The incumbent.

A note on fairness to the linear models. Ridge and the forest cannot take NaN,
so they get a median imputer *with missing indicators*, which is the strongest
version of imputation rather than the weakest. Handing them a silently filled
median and then declaring trees the winner would prove nothing. The comparison
is between learners doing their best, and the boosting advantage is measured
against that.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.leakage import assert_clean
from boxoffice.model.train import FEATURES, SHIPPED_PARAMS, _within_2x, feature_columns

OUT = Path(FEATURES).parent / "bakeoff.csv"

# The shipped configuration, named once so the incumbent row and train.py
# cannot drift apart silently.
SHIPPED = SHIPPED_PARAMS


def _imputed(estimator):
    """Median imputation with indicator columns, then scaling.

    The indicators matter. Without them the model is told a debut director
    earned the median, with them it is told the median *and* that the value was
    absent, which is as close as a learner without native missing support can
    get to what the booster does for free.
    """
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        StandardScaler(),
        estimator,
    )


def candidates() -> dict[str, object]:
    return {
        "ridge": _imputed(Ridge(alpha=10.0)),
        "random forest": _imputed(
            RandomForestRegressor(n_estimators=400, min_samples_leaf=5, n_jobs=-1, random_state=0)
        ),
        "neural net (2x64)": _imputed(
            MLPRegressor(
                hidden_layer_sizes=(64, 64),
                alpha=1e-3,
                learning_rate_init=3e-3,
                max_iter=1500,
                early_stopping=True,
                n_iter_no_change=25,
                random_state=0,
            )
        ),
        # The shipped model is now the defaults, so the old hand-tuned
        # configuration is kept as a named row rather than dropped: the reader
        # should be able to see what it lost to.
        "boosting (hand-tuned, retired)": HistGradientBoostingRegressor(
            max_iter=400,
            learning_rate=0.06,
            max_depth=None,
            min_samples_leaf=20,
            l2_regularization=1.0,
            random_state=0,
        ),
        "boosting (shipped)": HistGradientBoostingRegressor(**SHIPPED),
    }


def run(frame: pd.DataFrame, cols: list[str], first_year: int = 2010) -> pd.DataFrame:
    """One row per (learner, fold). Folds are identical to train.run's."""
    assert_clean(frame[cols])
    if "is_upcoming" in frame.columns:
        frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    frame = frame.sort_values("release_date")
    years = sorted(y for y in frame["release_date"].dt.year.unique() if y >= first_year)

    rows: list[dict] = []
    for year in years:
        train = frame[frame["release_date"].dt.year < year]
        test = frame[frame["release_date"].dt.year == year]
        if len(train) < 200 or len(test) < 20:
            continue

        y_tr = train["y_log_worldwide"].to_numpy()
        y_te = test["y_log_worldwide"].to_numpy()
        x_tr = train[cols].to_numpy(dtype="float64")
        x_te = test[cols].to_numpy(dtype="float64")

        preds = {
            "budget only": LinearRegression()
            .fit(train[["log_budget"]].to_numpy(), y_tr)
            .predict(test[["log_budget"]].to_numpy())
        }
        for name, est in candidates().items():
            preds[name] = est.fit(x_tr, y_tr).predict(x_te)

        for name, pred in preds.items():
            rows.append(
                {
                    "learner": name,
                    "year": year,
                    "n_test": len(test),
                    "mae_log": float(np.mean(np.abs(pred - y_te))),
                    "within_2x": _within_2x(y_te, pred),
                }
            )
    return pd.DataFrame(rows)


def summarise(folds: pd.DataFrame) -> pd.DataFrame:
    """Averages, plus how often each learner beat the incumbent fold for fold.

    The fold count is the part worth reading. A learner can win on the mean by
    doing well in one heavy year, and 16 folds is few enough that it happens.
    """
    shipped = folds[folds.learner == "boosting (shipped)"].set_index("year")
    order = [
        "budget only",
        "ridge",
        "random forest",
        "neural net (2x64)",
        "boosting (hand-tuned, retired)",
        "boosting (shipped)",
    ]

    rows = []
    for name in order:
        block = folds[folds.learner == name].set_index("year")
        beats = int((block["within_2x"] > shipped["within_2x"]).sum())
        rows.append(
            {
                "learner": name,
                "mae_log": block["mae_log"].mean(),
                "within_2x": block["within_2x"].mean(),
                "folds_beating_shipped": "-" if name == "boosting (shipped)" else f"{beats}/{len(block)}",
            }
        )
    return pd.DataFrame(rows)


def main() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    folds = run(frame, feature_columns(frame))
    folds.to_csv(OUT, index=False)
    return folds


if __name__ == "__main__":
    per_fold = main()
    print(summarise(per_fold).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"\nper-fold detail -> {OUT}")
