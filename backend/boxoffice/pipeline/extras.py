"""
Further pre-release signals, and one that is genuinely known and rarely used.

**Release-week competition.** Every distributor knows months out what else is
opening that weekend, and counter-programming is a real decision made on that
information. It is a legitimate feature and an unusual one, because it is a
property of the slate rather than of the film. Counting the other films in the
sample opening within seven days is a proxy for how crowded the corridor is.

**Franchise gap.** Six years between sequels is a different proposition from
eighteen months. Computed as-of, so the third film knows when the second opened
and nothing about the fourth.

**Recency over career.** A director's median gross across twenty years weights
a 2003 hit the same as last year's. The most recent prior film is a different
signal and often a better one, so both are offered and the ablation decides.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from boxoffice.model.leakage import AsOf  # noqa: E402  (sys.path is set two lines up, on purpose)

DATA = ROOT / "backend/boxoffice/data"
CACHE = DATA / "cache" / "film"
OUT = DATA / "extras.parquet"


def build() -> pd.DataFrame:
    feats = pd.read_parquet(DATA / "features.parquet")
    feats = feats[["imdb_id", "release_date", "y_log_worldwide"]].dropna(subset=["imdb_id"])
    feats = feats.sort_values("release_date").reset_index(drop=True)

    out = feats[["imdb_id"]].copy()

    # Competition: other films in the slate opening within a week either side.
    dates = feats["release_date"].to_numpy("datetime64[D]").astype("int64")
    window = 7
    counts = np.array([int(((dates >= d - window) & (dates <= d + window)).sum() - 1) for d in dates])
    out["releases_within_a_week"] = counts

    # Franchise gap, in years, from the cached collection ids.
    coll = {}
    for p in CACHE.glob("*.json"):
        body = json.loads(p.read_text())
        if body and body.get("imdb_id") and body.get("collection"):
            coll[body["imdb_id"]] = body["collection"]
    feats["collection"] = feats["imdb_id"].map(coll)

    gap = feats[["collection", "release_date"]].copy()
    # Convert to whole days explicitly rather than dividing the integer view by
    # a nanoseconds-per-day constant. pandas may hold these as datetime64[us]
    # rather than [ns], and the hand-rolled version was silently a thousand
    # times too small, turning a six-year franchise gap into two days.
    gap["stamp"] = feats["release_date"].values.astype("datetime64[D]").astype("int64")
    prev = AsOf("collection", "stamp").transform(gap, "max")
    out["years_since_franchise_entry"] = ((gap["stamp"] - prev) / 365.25).clip(lower=0)

    # Recency: the single most recent prior gross, alongside the career median
    # that already exists. Which one carries information is for the ablation.
    ent = feats[["imdb_id", "release_date", "y_log_worldwide"]].copy()
    ent["director"] = ent["imdb_id"].map(_directors())
    ent = ent.dropna(subset=["director"])
    ent["prior_latest"] = AsOf("director", "y_log_worldwide").transform(ent, "max")
    latest = ent.set_index("imdb_id")["prior_latest"]
    out["director_prior_latest_log"] = out["imdb_id"].map(latest)

    return out


def _directors() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for p in CACHE.glob("*.json"):
        body = json.loads(p.read_text())
        if body and body.get("imdb_id") and body.get("director"):
            mapping[body["imdb_id"]] = str(body["director"][0]["id"])
    return mapping


if __name__ == "__main__":
    frame = build()
    frame.to_parquet(OUT, index=False)
    print(f"{len(frame)} films -> {OUT.name}")
    print(frame.describe().loc[["mean", "50%", "max"]].to_string())
