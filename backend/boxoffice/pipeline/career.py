"""
Where a person is in their career, as of the film they are about to release.

The career histories fetched in `filmography.py` failed as a source of average
grosses, but the *dates* in them were never used and they answer a different
question. Revenue is reported for only 42% of those credits; a release date is
reported for all of them. So career structure is available at close to full
coverage where career earnings were not.

WHAT THIS MEASURES

    career_length_years   from their first credit to this film
    films_to_date         how many they have made before this one
    films_per_year        pace, which separates a prolific decade from a long
                          thin one of the same length
    years_since_last      the gap they are coming off
    gap_bucket           that gap in bands, because the difference between one
                          year and three is not the difference between eight
                          and ten
    is_returning          coming back from a gap of seven years or more

ONE THING IT DELIBERATELY DOES NOT MEASURE

Whether someone is "no longer active" cannot be a feature here, however useful
it sounds. Knowing that a director never worked again requires looking at
credits that did not exist on the day this film opened, and a model told which
careers ended would be reading the future. What is knowable on the day is the
gap they are currently coming off, which is `years_since_last`, and that is
what gets used. A fifteen-year silence that later turns out to be retirement
and one that later turns out to be a comeback look identical here, and they
should, because on release day they were identical.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "backend"))

FEATURES = ROOT / "data" / "features.parquet"
HISTORY = ROOT / "data" / "history.parquet"
FILM_CACHE = ROOT / "data" / "cache" / "film"
OUT = ROOT / "data" / "career.parquet"

ROLES = ("director", "cinematographer", "composer")
GAP_EDGES = [0, 2, 5, 10, 15, np.inf]
GAP_LABELS = [0, 1, 2, 3, 4]  # <2y, 2-5, 5-10, 10-15, 15y+


def _film_people() -> pd.DataFrame:
    """One row per (film, person, role) for the films in the sample."""
    import json

    ids = set(pd.read_parquet(FEATURES)["imdb_id"].dropna())
    rows = []
    for path in FILM_CACHE.glob("*.json"):
        try:
            body = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if body.get("imdb_id") not in ids:
            continue
        for role in ROLES:
            for person in body.get(role) or []:
                rows.append({"imdb_id": body["imdb_id"], "role": role, "person_id": int(person["id"])})
    return pd.DataFrame(rows).drop_duplicates()


def build() -> pd.DataFrame:
    films = pd.read_parquet(FEATURES)[["imdb_id", "release_date"]].dropna(subset=["imdb_id"])
    history = pd.read_parquet(HISTORY)[["person_id", "role", "release_date"]]
    history = history.rename(columns={"release_date": "credit_date"})

    pairs = _film_people().merge(films, on="imdb_id", how="inner")
    joined = pairs.merge(history, on=["person_id", "role"], how="left")

    # Strictly earlier credits only. A film is never part of its own history,
    # and a credit released the same day is not yet evidence of anything.
    prior = joined[joined["credit_date"] < joined["release_date"]]

    agg = (
        prior.groupby(["imdb_id", "role"])
        .agg(
            first_credit=("credit_date", "min"),
            last_credit=("credit_date", "max"),
            films_to_date=("credit_date", "size"),
        )
        .reset_index()
    )

    agg = agg.merge(films, on="imdb_id", how="left")
    year = 365.25
    agg["career_length_years"] = (agg["release_date"] - agg["first_credit"]).dt.days / year
    agg["years_since_last"] = (agg["release_date"] - agg["last_credit"]).dt.days / year
    agg["films_per_year"] = agg["films_to_date"] / agg["career_length_years"].clip(lower=1.0)
    agg["gap_bucket"] = pd.cut(
        agg["years_since_last"], bins=GAP_EDGES, labels=GAP_LABELS, right=False
    ).astype("float")
    agg["is_returning"] = (agg["years_since_last"] >= 7).astype(int)

    # One row per film, columns prefixed by role. Where a film has several
    # people in a role, the most experienced is the one described.
    agg = agg.sort_values("films_to_date", ascending=False).drop_duplicates(["imdb_id", "role"])
    wide = None
    keep = [
        "career_length_years",
        "films_to_date",
        "films_per_year",
        "years_since_last",
        "gap_bucket",
        "is_returning",
    ]
    for role in ROLES:
        block = agg[agg["role"] == role][["imdb_id"] + keep]
        block = block.rename(columns={c: f"{role}_{c}" for c in keep})
        wide = block if wide is None else wide.merge(block, on="imdb_id", how="outer")

    wide.to_parquet(OUT, index=False)
    return wide


if __name__ == "__main__":
    out = build()
    print(f"{len(out)} films with career structure -> {OUT.name}\n")
    for c in sorted(out.columns):
        if c != "imdb_id":
            print(f"  {c:38s} coverage {out[c].notna().mean():5.1%}")
