"""
Are there natural kinds of box office outcome, or only a continuum?

The appealing version of this project predicts a category -- tentpole hit,
indie breakout, flop -- rather than a number. Categories are what a greenlight
conversation actually deals in, and a confusion matrix says more to a reader
than a mean absolute error in log space.

It is also the easiest place in this project to build something that scores
well and means nothing, in two distinct ways.

**Defining a class with a pre-release variable.** "Major studio" as budget over
$50m is knowable months before release. A model asked to predict a label that
is partly defined by its own input will predict it very well, and the number
will be reporting that budget equals budget. So the clustering runs on outcome
dimensions only: what the film earned, and what it earned relative to what it
cost. Budget appears on the feature side, never in the label.

**Assuming the clusters exist.** k-means returns k clusters from any cloud of
points, including a featureless one. Whether these are kinds or arbitrary cuts
through a continuum is a question with an answer, so it is asked here rather
than assumed: silhouette across k, and a bootstrap stability check that
re-clusters resampled data and measures how often pairs of films stay together.
If the labels move when the sample moves, they are cuts and should be drawn by
hand at thresholds that at least have a business meaning.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES

OUT = Path(FEATURES).parent / "outcome_clusters.csv"
K_RANGE = range(2, 9)
BOOTSTRAPS = 30
RNG = np.random.default_rng(0)


def outcome_space() -> tuple[pd.DataFrame, np.ndarray]:
    """The two post-release dimensions, in logs because both are heavy tailed."""
    frame = pd.read_parquet(FEATURES)
    frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)].copy()
    frame["budget"] = np.expm1(frame["log_budget"])
    frame = frame[(frame["budget"] > 0) & (frame["y_worldwide"] > 0)]

    frame["log_revenue"] = np.log10(frame["y_worldwide"])
    frame["log_multiple"] = np.log10(frame["y_worldwide"] / frame["budget"])
    return frame, StandardScaler().fit_transform(
        frame[["log_revenue", "log_multiple"]].to_numpy())


def stability(x: np.ndarray, k: int) -> float:
    """Mean adjusted Rand between clusterings of bootstrap resamples.

    A real cluster structure survives resampling: two films in the same group
    stay together when the sample changes. An arbitrary cut does not.
    """
    base = KMeans(k, n_init=10, random_state=0).fit_predict(x)
    scores = []
    for _ in range(BOOTSTRAPS):
        idx = RNG.integers(0, len(x), len(x))
        labels = KMeans(k, n_init=10, random_state=0).fit(x[idx]).predict(x)
        scores.append(adjusted_rand_score(base, labels))
    return float(np.mean(scores))


def main() -> pd.DataFrame:
    frame, x = outcome_space()
    print(f"{len(frame)} films in the outcome space\n")

    rows = []
    for k in K_RANGE:
        labels = KMeans(k, n_init=10, random_state=0).fit_predict(x)
        rows.append({"k": k,
                     "silhouette": silhouette_score(x, labels),
                     "stability_ari": stability(x, k),
                     "smallest_cluster": int(pd.Series(labels).value_counts().min())})
        print(f"  k={k}  silhouette {rows[-1]['silhouette']:.3f}  "
              f"stability {rows[-1]['stability_ari']:.3f}  "
              f"smallest {rows[-1]['smallest_cluster']}", flush=True)

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)

    best = int(out.sort_values("silhouette", ascending=False).iloc[0]["k"])
    labels = KMeans(best, n_init=10, random_state=0).fit_predict(x)
    frame["cluster"] = labels
    print(f"\nprofile at k={best} (chosen on silhouette):")
    profile = frame.groupby("cluster").agg(
        films=("y_worldwide", "size"),
        median_budget=("budget", "median"),
        median_revenue=("y_worldwide", "median"),
        median_multiple=("log_multiple", lambda s: 10 ** s.median()))
    profile["median_budget"] = (profile.median_budget / 1e6).round(1)
    profile["median_revenue"] = (profile.median_revenue / 1e6).round(1)
    print(profile.to_string(float_format=lambda v: f"{v:.2f}"))
    return out


if __name__ == "__main__":
    main()
