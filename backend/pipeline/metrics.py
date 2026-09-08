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
    "audience": "imdb_rating",
    "critics": "critic_mean",
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


def critic_mean(contenders: pd.DataFrame) -> pd.Series:
    """
    One critic number per film from whichever of the two exist.

    Rotten Tomatoes and Metascore are both 0-100 critic aggregates measuring
    much the same thing, and each is missing for a different set of films, so
    averaging whichever are present covers more of the catalogue than either
    alone. Films with neither stay null and the scorer renormalises around
    them, exactly as it does for missing box office.

    Note that this is the critic score only. Rotten Tomatoes' *audience* score
    is not available from either data source: OMDb returns the Tomatometer
    under the name "Rotten Tomatoes" and exposes no audience figure at all,
    which is why ``rt_audience`` is empty for every film in the seed. The
    audience side of the score is carried by the IMDb rating instead.
    """
    columns = [c for c in ("rt_critic", "metascore") if c in contenders]
    if not columns:
        return pd.Series(np.nan, index=contenders.index, dtype="float64")
    return contenders[columns].astype("float64").mean(axis=1, skipna=True)


def add_percentile_metrics(contenders: pd.DataFrame) -> pd.DataFrame:
    """
    Attach the percentile metric columns named in :data:`METRIC_SOURCES`.

    Expects ``imdb_rating``, ``imdb_votes``, ``box_office_usd`` and the two
    critic columns (all nullable) to be present on the contender frame, joined
    from ``films``.
    """
    out = contenders.copy()
    out["log_votes"] = np.log1p(out["imdb_votes"].astype("float64"))
    out["critic_mean"] = critic_mean(out)
    for metric, source in METRIC_SOURCES.items():
        out[metric] = _percentile_within_group(out, source)
    return out.drop(columns=["log_votes", "critic_mean"])
