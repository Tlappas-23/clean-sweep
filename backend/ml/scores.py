"""
Read/merge/write helpers for ``data/seed/ml_scores.parquet``.

Architecture note
-----------------
``ml_scores.parquet`` is the hand-off between the ML layer and the API: one
row per contender with the model outputs (``prestige``, ``archetype``,
``cluster_id``). The ranker and the clusterer are independent scripts that
each own a subset of those columns, so they must be able to run in either
order, or alone, without clobbering each other's work. :func:`update_scores`
implements that: it reads the existing file if present, re-anchors it on
the *current* list of contender ids, overwrites only the columns supplied by
the caller and writes the result back.

The score table is keyed by ``contender_id`` rather than row position so it
survives a pipeline rebuild that reorders or drops contenders.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ml.paths import ML_SCORES_PATH, ensure_dirs

# Canonical column order and dtypes of the scores table (docs/DATA.md).
SCORE_DTYPES: dict[str, str] = {
    "prestige": "float64",
    "archetype": "str",
    "cluster_id": "int32",
}


def percentile_within_pool(df: pd.DataFrame, value_col: str) -> pd.Series:
    """
    Rank ``value_col`` inside each (year, category) pool and scale to 0-100.

    This mirrors ``pipeline.metrics`` so ``prestige`` reads like the other
    card metrics: the weakest contender in a pool is 0, the strongest 100,
    a singleton pool gets a neutral 50. Comparing within the pool (rather
    than using the raw probability) is what makes a 1940 contender
    comparable with a 2020 one: the model's absolute probabilities drift
    with era (vote counts, pool sizes), the ordering inside a pool does not.
    """
    grp = df.groupby(["year", "category"])[value_col]
    ranks = grp.rank(method="average")
    counts = grp.transform("count")
    with np.errstate(invalid="ignore", divide="ignore"):
        pct = (ranks - 1) / (counts - 1) * 100.0
    pct = pct.where(counts > 1, 50.0)
    return pct.where(df[value_col].notna())


def read_scores() -> pd.DataFrame | None:
    """Return the current scores table or ``None`` if it has not been written yet."""
    if not ML_SCORES_PATH.exists():
        return None
    return pd.read_parquet(ML_SCORES_PATH)


def update_scores(contender_ids: pd.Series, new_columns: pd.DataFrame) -> pd.DataFrame:
    """
    Merge ``new_columns`` (indexed by ``contender_id``) into the scores table and write it.

    ``contender_ids`` is the authoritative list of ids from ``contenders.parquet``;
    rows for ids that no longer exist are dropped, rows for new ids are added
    with nulls in the columns this call does not provide.
    """
    ensure_dirs()
    base = pd.DataFrame({"contender_id": contender_ids.astype("str").to_numpy()})
    if base["contender_id"].duplicated().any():
        raise ValueError("contender_id must be unique")

    existing = read_scores()
    if existing is not None:
        keep = [c for c in existing.columns if c != "contender_id" and c not in new_columns.columns]
        base = base.merge(existing[["contender_id", *keep]], on="contender_id", how="left")

    incoming = new_columns.copy()
    incoming.index = incoming.index.astype("str")
    incoming.index.name = "contender_id"
    base = base.merge(incoming.reset_index(), on="contender_id", how="left")

    # Stable column order + dtypes; columns absent from both sources are left out
    # (the test-suite / API decide whether a partial table is acceptable).
    ordered = ["contender_id", *[c for c in SCORE_DTYPES if c in base.columns]]
    base = base[ordered]
    for col, dtype in SCORE_DTYPES.items():
        if col in base.columns and not base[col].isna().any():
            base[col] = base[col].astype(dtype)
    base.to_parquet(ML_SCORES_PATH, index=False)
    return base
