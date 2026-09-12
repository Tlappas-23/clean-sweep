"""
Hyperparameter search that cannot flatter itself.

The shipped configuration was hand-set and is beaten by scikit-learn's
defaults, so tuning is worth doing properly. Doing it badly is easy and the
failure mode is specific: try two hundred configurations against the same 17
folds, take the best, and report its score. That number is not an estimate of
anything. With enough candidates, one of them fits the validation folds by
luck, and the reported figure is the luck.

So the folds are split and the split is respected.

    2010-2018   development. Every candidate is scored here, and the winner
                is chosen here. These nine folds are spent.
    2019-2026   held out from the search entirely. The winner is scored here
                exactly once, against the incumbent and the defaults, and that
                is the number that may be quoted.

This is a temporal holdout rather than a nested cross-validation, which would
be stricter and far slower. The choice is recorded rather than hidden: with
eight evaluation folds the held-out estimate is itself noisy, and a difference
of a point or two on it should not be read as a real improvement without the
paired test in model/significance.py.

Search is randomised rather than exhaustive. A grid over five parameters spends
most of its budget on combinations that differ in ways the data cannot resolve,
and random search covers the space better for the same number of fits.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES, _within_2x, feature_columns

OUT = Path(FEATURES).parent / "tuning.csv"
DEV_LAST_YEAR = 2018
N_CANDIDATES = 40
RNG = np.random.default_rng(0)

# The configuration that shipped before this search, kept so the row is
# reproducible after the swap.
SHIPPED = dict(
    max_iter=400,
    learning_rate=0.06,
    max_depth=None,
    min_samples_leaf=20,
    l2_regularization=1.0,
    random_state=0,
)
DEFAULTS: dict = dict(random_state=0)

SPACE = {
    "learning_rate": [0.02, 0.03, 0.05, 0.08, 0.1, 0.15],
    "max_iter": [150, 250, 400, 600, 900],
    "min_samples_leaf": [5, 10, 20, 40, 80],
    "l2_regularization": [0.0, 0.1, 1.0, 5.0, 20.0],
    "max_leaf_nodes": [15, 31, 63, 127],
    "max_features": [0.5, 0.7, 1.0],
}


def candidates(n: int) -> list[dict]:
    seen, out = set(), []
    while len(out) < n:
        pick = {k: v[RNG.integers(len(v))] for k, v in SPACE.items()}
        key = tuple(sorted(pick.items()))
        if key in seen:
            continue
        seen.add(key)
        pick["random_state"] = 0
        out.append(pick)
    return out


def score(
    frame: pd.DataFrame, cols: list[str], params: dict, years: range | list[int]
) -> tuple[float, float]:
    """Mean MAE and hit rate over the named fold years."""
    frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    frame = frame.sort_values("release_date")
    year = frame["release_date"].dt.year

    maes, hits = [], []
    for y in years:
        train, test = frame[year < y], frame[year == y]
        if len(train) < 200 or len(test) < 20:
            continue
        y_tr = train["y_log_worldwide"].to_numpy()
        y_te = test["y_log_worldwide"].to_numpy()
        pred = (
            HistGradientBoostingRegressor(**params)
            .fit(train[cols].to_numpy(dtype="float64"), y_tr)
            .predict(test[cols].to_numpy(dtype="float64"))
        )
        maes.append(float(np.mean(np.abs(pred - y_te))))
        hits.append(_within_2x(y_te, pred))
    return float(np.mean(maes)), float(np.mean(hits))


INT_PARAMS = {"max_iter", "min_samples_leaf", "max_leaf_nodes", "random_state"}


def _params(row: pd.Series) -> dict:
    """A candidate read back off a DataFrame row.

    Pandas stores a row of mixed ints and floats as floats, and scikit-learn
    refuses `max_iter=250.0`. The first run of this search spent eighty minutes
    on the candidates and died on that cast, so it lives in one place now.
    """
    out = {}
    for k in list(SPACE) + ["random_state"]:
        v = row[k]
        out[k] = int(v) if k in INT_PARAMS else float(v)
    return out


def evaluate_saved() -> pd.DataFrame:
    """The held-out step alone, from a search that already ran."""
    frame = pd.read_parquet(FEATURES)
    cols = feature_columns(frame)
    released = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    last = int(released["release_date"].dt.year.max())
    held = range(DEV_LAST_YEAR + 1, last + 1)
    search = pd.read_csv(OUT).sort_values("dev_within_2x", ascending=False)
    best = _params(search.iloc[0])
    rows = []
    for name, params in [
        ("hand-tuned, retired", SHIPPED),
        ("sklearn defaults", DEFAULTS),
        ("tuned on 2010-2018", best),
    ]:
        mae, hit = score(frame, cols, params, held)
        rows.append({"configuration": name, "held_out_mae": mae, "held_out_within_2x": hit})
    print(f"best of {len(search)} on development folds: {best}\n")
    print(f"held-out folds {DEV_LAST_YEAR + 1}-{last}, scored once:")
    out = pd.DataFrame(rows)
    print(out.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    return out


def main() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    cols = feature_columns(frame)
    released = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    last = int(released["release_date"].dt.year.max())
    dev = range(2010, DEV_LAST_YEAR + 1)
    held = range(DEV_LAST_YEAR + 1, last + 1)

    rows = []
    for i, params in enumerate(candidates(N_CANDIDATES), 1):
        mae, hit = score(frame, cols, params, dev)
        rows.append({**params, "dev_mae": mae, "dev_within_2x": hit})
        if i % 10 == 0:
            print(f"  {i}/{N_CANDIDATES} candidates scored", flush=True)

    search = pd.DataFrame(rows).sort_values("dev_within_2x", ascending=False)
    search.to_csv(OUT, index=False)

    # One evaluation each on the held-out folds. Three numbers, one look.
    best = _params(search.iloc[0])
    final = []
    for name, params in [
        ("hand-tuned, retired", SHIPPED),
        ("sklearn defaults", DEFAULTS),
        ("tuned on 2010-2018", best),
    ]:
        mae, hit = score(frame, cols, params, held)
        final.append({"configuration": name, "held_out_mae": mae, "held_out_within_2x": hit})

    print(f"\ndevelopment folds 2010-{DEV_LAST_YEAR}, best of {N_CANDIDATES}:")
    print(f"  {best}")
    print(f"\nheld-out folds {DEV_LAST_YEAR + 1}-{last}, scored once:")
    print(pd.DataFrame(final).to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    return search


if __name__ == "__main__":
    import sys as _sys

    evaluate_saved() if "--evaluate-only" in _sys.argv else main()
