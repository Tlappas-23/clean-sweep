"""
Which films fail to return their budget, and can you tell before release?

The regression answered a question with a known answer. Budget alone gets
47% of films within a factor of two, and thirty-seven more features get 57%.
That lift is real, but it is the same finding every box office project
reaches, and the model is weakest exactly where a studio needs it most: in the
bottom decile it projects nine times what the film earned.

So the target changes. The outcome clustering found three stable kinds of
result -- a write-off, a loss, a profit -- and this predicts which kind a film
becomes, from what is knowable before it opens.

THREE RULES THAT MAKE THE NUMBER MEAN SOMETHING

**The classes are the clustering's, not hand-drawn.** k=3 was the most stable
structure in the outcome space (bootstrap ARI 0.91), and the boundaries are
those centroids. They are computed once, on the whole released sample, and
frozen. Re-deriving them per fold would let the class definitions drift with
the training years and make the folds incomparable.

**Budget is context, never label.** A class defined partly by budget is partly
free to predict. Budget stays on the feature side, and the evaluation reports
every metric *within budget tier* against that tier's own base rate. Predicting
that a $200m tentpole turns a profit is worth nothing when 81% of them do.

**The bar is the stratified base rate, not the overall one.** A classifier that
predicts "profitable" for every film over $50m and "loss" for every film under
$15m is already right about 60% of the time. Beating that is the claim; beating
a coin is not.

Probabilities rather than labels are the output, because a greenlight is a
decision under uncertainty and the cost of the two errors is not symmetric.
Calibration is checked directly: when the model says 30%, it should be right
30% of the time, and the reliability table says whether it is.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.cluster import KMeans
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES, feature_columns

DATA = Path(FEATURES).parent
OUT_FOLDS = DATA / "classify_folds.parquet"
OUT_SUMMARY = DATA / "classify_summary.csv"
CLASSES = ["write-off", "loss", "profit"]
TIER_EDGES = [0, 15e6, 50e6, np.inf]
TIER_LABELS = ["<$15m", "$15-50m", "$50m+"]
FIRST_YEAR = 2010


PROBABILITY_FLOOR = 1e-3


def _floor(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, PROBABILITY_FLOOR, 1.0)
    return p / p.sum(axis=1, keepdims=True)


def make_classifier():
    """A booster that has been told it is working with two thousand rows.

    The library defaults produced 69% accuracy and a log loss *worse* than the
    base rate, which is what overconfidence looks like on paper: a third of
    films were assigned a class probability above 0.99, and 8% of those were
    wrong. When the model said 4% chance of profit, a quarter turned a profit.

    Two changes. The booster is regularised hard -- shallow trees, large leaves,
    few iterations, strong L2 -- because 2,000 rows and 38 columns is not a lot
    of evidence for a confident opinion. Then its scores are calibrated by
    isotonic regression on held-out slices *of the training years*, so the
    probability it emits is one that has been checked against outcomes it did
    not fit. The test year is never touched by either step.
    """
    base = HistGradientBoostingClassifier(
        max_iter=120,
        learning_rate=0.05,
        max_leaf_nodes=8,
        min_samples_leaf=40,
        l2_regularization=5.0,
        random_state=0,
    )
    return CalibratedClassifierCV(base, method="isotonic", cv=5)


def label_films(frame: pd.DataFrame) -> pd.Series:
    """The three outcome classes, assigned from frozen cluster centroids.

    Fitted on every released film at once and never refitted, so a 2012 fold
    and a 2026 fold are scored against the same three definitions.
    """
    released = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    budget = np.expm1(released["log_budget"])
    space = pd.DataFrame(
        {
            "log_revenue": np.log10(released["y_worldwide"]),
            "log_multiple": np.log10(released["y_worldwide"] / budget),
        }
    )
    scaler = StandardScaler().fit(space)
    km = KMeans(3, n_init=10, random_state=0).fit(scaler.transform(space))

    # Name the clusters by their multiple so the index is meaningful.
    medians = space.assign(c=km.labels_).groupby("c")["log_multiple"].median().sort_values()
    rank = {c: i for i, c in enumerate(medians.index)}
    return pd.Series([rank[c] for c in km.labels_], index=released.index)


def budget_tier(frame: pd.DataFrame) -> pd.Series:
    return pd.cut(np.expm1(frame["log_budget"]), TIER_EDGES, labels=TIER_LABELS, right=False)


def _tier_prior(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """The baseline: each tier's own class frequencies in the training years."""
    counts = pd.crosstab(train["tier"], train["y"], normalize="index")
    counts = counts.reindex(columns=range(3), fill_value=0.0)
    fallback = train["y"].value_counts(normalize=True).reindex(range(3), fill_value=0.0)
    rows = []
    for tier in test["tier"]:
        rows.append(counts.loc[tier].to_numpy() if tier in counts.index else fallback.to_numpy())
    return np.asarray(rows)


def run() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    cols = feature_columns(frame)
    released = frame[~frame["is_upcoming"].fillna(False).astype(bool)].copy()
    released["y"] = label_films(frame)
    released["tier"] = budget_tier(released)
    released["year"] = released["release_date"].dt.year
    released = released.sort_values("release_date")

    rows = []
    for year in sorted(y for y in released["year"].unique() if y >= FIRST_YEAR):
        train = released[released["year"] < year]
        test = released[released["year"] == year]
        if len(train) < 200 or len(test) < 20:
            continue

        clf = make_classifier()
        clf.fit(train[cols].to_numpy(dtype="float64"), train["y"].to_numpy())
        proba = clf.predict_proba(test[cols].to_numpy(dtype="float64"))
        # Classes absent from a training year leave a column missing.
        full = np.zeros((len(test), 3))
        full[:, clf.classes_] = proba

        prior = _tier_prior(train, test)
        # Neither side may say "never". Isotonic calibration can emit an exact
        # zero, and the tier prior can too when a class was absent from the
        # training years; either way a single film then scores a log loss of
        # 27, and two such films dominated the mid-tier interval in the first
        # run. A floor of one in a thousand is the smallest probability a
        # model trained on two thousand films has any business asserting.
        full = _floor(full)
        prior = _floor(prior)
        for i, (_, r) in enumerate(test.iterrows()):
            rows.append(
                {
                    "imdb_id": r["imdb_id"],
                    "year": year,
                    "tier": str(r["tier"]),
                    "y": int(r["y"]),
                    "p_writeoff": full[i, 0],
                    "p_loss": full[i, 1],
                    "p_profit": full[i, 2],
                    "prior_writeoff": prior[i, 0],
                    "prior_loss": prior[i, 1],
                    "prior_profit": prior[i, 2],
                }
            )
        print(f"  {year} done", flush=True)

    out = pd.DataFrame(rows)
    out.to_parquet(OUT_FOLDS, index=False)
    return out


def summarise(folds: pd.DataFrame) -> pd.DataFrame:
    """Model against the tier-stratified prior, overall and per tier."""

    def block(d: pd.DataFrame, name: str) -> dict:
        y = d["y"].to_numpy()
        p_model = d[["p_writeoff", "p_loss", "p_profit"]].to_numpy()
        p_prior = d[["prior_writeoff", "prior_loss", "prior_profit"]].to_numpy()
        y_bin = (y == 2).astype(int)
        return {
            "slice": name,
            "films": len(d),
            "base_rate_profit": float(y_bin.mean()),
            "logloss_model": log_loss(y, p_model, labels=[0, 1, 2]),
            "logloss_prior": log_loss(y, p_prior, labels=[0, 1, 2]),
            "brier_profit_model": brier_score_loss(y_bin, p_model[:, 2]),
            "brier_profit_prior": brier_score_loss(y_bin, p_prior[:, 2]),
            "accuracy_model": float((p_model.argmax(1) == y).mean()),
            "accuracy_prior": float((p_prior.argmax(1) == y).mean()),
        }

    rows = [block(folds, "all")]
    for tier in TIER_LABELS:
        rows.append(block(folds[folds["tier"] == tier], tier))
    out = pd.DataFrame(rows)
    out.to_csv(OUT_SUMMARY, index=False)
    return out


if __name__ == "__main__":
    folds = run()
    table = summarise(folds)
    print()
    print(table.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
