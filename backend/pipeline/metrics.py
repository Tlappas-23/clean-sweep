"""
Percentile metrics shared by ``build_seed`` and ``enrich``.

Architecture note
-----------------
The game compares contenders *within their own year* (a 1940 film is judged
against 1940 films, see docs/GAME_DESIGN.md §3). These helpers turn raw
numbers (IMDb rating, vote count, revenue) into 0–100 percentiles inside each
``(year, category)`` pool. They live in their own module because the
enrichment step must recompute ``box_office`` after new revenue data arrives
without rebuilding the whole seed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# The columns that drive each percentile metric. ``log_votes`` is used for
# popularity because vote counts are heavy-tailed (a few films have millions).
METRIC_SOURCES: dict[str, str] = {
    "acclaim": "imdb_rating",
    "popularity": "log_votes",
    "box_office": "box_office_usd",
}


def _percentile_within_group(df: pd.DataFrame, value_col: str) -> pd.Series:
    """
    Rank ``value_col`` inside each (year, category) group and scale to 0–100.

    ``rank(pct=True)`` gives (0, 1]; we rescale so the lowest entry in a pool
    is 0 and the highest is 100, which reads better on a card. Groups with a
    single member get 50. NaN inputs stay NaN so the scorer can renormalise.
    """
    grp = df.groupby(["year", "category"])[value_col]
    ranks = grp.rank(method="average", pct=False)  # 1..n, NaN preserved
    counts = grp.transform("count")  # non-null count per group
    with np.errstate(invalid="ignore", divide="ignore"):
        pct = (ranks - 1) / (counts - 1) * 100.0
    pct = pct.where(counts > 1, 50.0)  # singleton pool -> neutral 50
    return pct.where(df[value_col].notna())


def add_percentile_metrics(contenders: pd.DataFrame) -> pd.DataFrame:
    """
    Attach ``acclaim``, ``popularity`` and ``box_office`` percentile columns.

    Expects ``imdb_rating``, ``imdb_votes`` and ``box_office_usd`` (nullable)
    to be present on the contender frame (joined from ``films``).
    """
    out = contenders.copy()
    out["log_votes"] = np.log1p(out["imdb_votes"].astype("float64"))
    for metric, source in METRIC_SOURCES.items():
        out[metric] = _percentile_within_group(out, source)
    return out.drop(columns=["log_votes"])
