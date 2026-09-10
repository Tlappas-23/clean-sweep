"""
Turn cached TMDB records into a leakage-free feature matrix.

Every historical feature here answers the same shape of question: how did the
films this person, company or franchise released *before this one* perform?
That "before" is the entire difficulty. A groupby over the whole table answers
it with the future included, and the resulting column looks exactly like the
honest version.

So people and companies are exploded to one row per (film, entity) pair, the
as-of aggregate is computed per entity, and the result is folded back to one
row per film. Nothing here reads the target for the row it is describing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.leakage import AsOf, assert_clean

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "film"
OUT = ROOT / "data" / "features.parquet"

BUDGET_FLOOR = 1_000_000
GENRES = ("Action", "Comedy", "Drama", "Horror", "Science Fiction",
          "Family", "Thriller", "Documentary", "Animation", "Adventure")
MAJORS = {2, 3, 420, 1, 25, 174, 12, 33, 6704, 5, 34, 4, 1632, 21}


def load(today: pd.Timestamp | None = None) -> pd.DataFrame:
    """
    Every film the model touches: the released ones it learns from, and the
    unreleased ones it forecasts.

    The two are filtered differently on purpose. A training row needs a budget
    above the floor and a reported gross, because without the answer it teaches
    nothing. An unreleased row needs neither: a film opening in four months
    often has no budget published yet, and refusing to look at it would mean
    the slate a studio actually cares about is the part the model declines to
    forecast. Missing budget stays missing and the booster splits on it.
    """
    today = today or pd.Timestamp.today().normalize()
    rows = []
    for p in CACHE.glob("*.json"):
        body = json.loads(p.read_text())
        if not body or not body.get("release_date"):
            continue
        released = pd.to_datetime(body["release_date"], errors="coerce")
        if pd.isna(released):
            continue

        if released > today:
            body["is_upcoming"] = True
            rows.append(body)
            continue

        if (body.get("budget") or 0) < BUDGET_FLOOR or not (body.get("revenue") or 0):
            continue
        body["is_upcoming"] = False
        rows.append(body)

    df = pd.DataFrame(rows)
    df["release_date"] = pd.to_datetime(df["release_date"], errors="coerce")
    return df.dropna(subset=["release_date"]).sort_values("release_date").reset_index(drop=True)


def _entity_prior(df: pd.DataFrame, column: str, how: str, id_key: str = "id") -> pd.DataFrame:
    """
    As-of aggregate for a list-valued column such as cast or director.

    Explodes to one row per (film, person), computes the expanding aggregate
    per person with `AsOf`, then folds back to the film. The fold is where the
    per-film summary is chosen: median for the typical collaborator, max for
    the single biggest name attached.
    """
    pairs = df[["film_key", "release_date", "log_ww", column]].explode(column)
    pairs = pairs[pairs[column].notna()].copy()
    if pairs.empty:
        return pd.DataFrame(index=df.index)
    pairs["entity"] = pairs[column].apply(lambda d: d.get(id_key) if isinstance(d, dict) else d)
    pairs = pairs[pairs["entity"].notna()]

    pairs["prior"] = AsOf("entity", "log_ww").transform(pairs, how)
    grouped = pairs.groupby("film_key")["prior"]
    return pd.DataFrame({
        f"{column}_prior_median_log": grouped.median(),
        f"{column}_prior_max_log": grouped.max(),
        f"{column}_prior_count": pairs.assign(has=pairs["prior"].notna())
                                      .groupby("film_key")["has"].sum(),
    })


def build() -> pd.DataFrame:
    df = load()
    df["film_key"] = df.index
    upcoming = df["is_upcoming"].fillna(False).astype(bool)
    # An unreleased film reports revenue 0, and log1p(0) is 0, which is a
    # perfectly valid-looking log gross. Left alone it flows into every as-of
    # prior, so a cinematographer whose only earlier credit has not opened yet
    # gets a career average of zero dollars. Blank it before the priors are
    # built, not after.
    revenue = pd.to_numeric(df["revenue"], errors="coerce").where(~upcoming)
    df["log_ww"] = np.log1p(revenue.where(revenue > 0))
    budget = pd.to_numeric(df["budget"], errors="coerce")
    df["log_budget"] = np.log1p(budget.where(budget > 0))

    out = pd.DataFrame(index=df.index)
    out["film_key"] = df["film_key"]
    out["title"] = df["title"]
    out["imdb_id"] = df["imdb_id"]
    out["release_date"] = df["release_date"]
    out["log_budget"] = df["log_budget"]
    out["runtime_minutes"] = pd.to_numeric(df["runtime"], errors="coerce")
    out["original_language_en"] = (df["original_language"] == "en").astype(int)

    # Form. Franchise position is an as-of count: the third film in a series
    # knows about two predecessors, not about the fourth.
    out["is_sequel"] = df["collection"].notna().astype(int)
    # A constant column counted as-of gives "how many earlier films in this
    # collection", which is the franchise position without knowing the sequels.
    coll = df[["collection", "release_date"]].copy()
    coll["one"] = 1.0
    seen = AsOf("collection", "one").transform(coll, "count")
    out["franchise_position"] = seen.fillna(0.0)

    # Genre one-hots, from TMDB's own labels.
    for g in GENRES:
        out[f"genre_{g.lower().replace(' ', '')}"] = df["genres"].apply(
            lambda gs, g=g: int(g in (gs or []))).astype(int)

    # Calendar. Release timing is pure metadata and entirely pre-release.
    out["release_month"] = df["release_date"].dt.month
    out["release_week"] = df["release_date"].dt.isocalendar().week.astype(int)
    out["is_summer"] = df["release_date"].dt.month.isin([5, 6, 7]).astype(int)
    out["is_holiday_corridor"] = df["release_date"].dt.month.isin([11, 12]).astype(int)

    # Studio, director, cinematographer, composer, cast: all as-of.
    for column, how in [("companies", "median"), ("director", "median"),
                        ("cinematographer", "median"), ("composer", "median"),
                        ("cast", "median")]:
        out = out.join(_entity_prior(df, column, how))

    out["is_major_studio"] = df["companies"].apply(
        lambda cs: int(any(c.get("id") in MAJORS for c in (cs or [])))).astype(int)

    # Targets last, and named so the guard would catch them if they leaked into
    # the feature list by accident.
    out["y_log_worldwide"] = df["log_ww"]
    out["y_worldwide"] = pd.to_numeric(df["revenue"], errors="coerce")
    out["is_upcoming"] = upcoming
    # An unreleased film has no gross, and a zero would be read as one.
    out.loc[upcoming, ["y_log_worldwide", "y_worldwide"]] = np.nan
    return out


if __name__ == "__main__":
    frame = build()
    features = [c for c in frame.columns
                if not c.startswith("y_") and c not in
                ("film_key", "title", "imdb_id", "release_date", "is_upcoming")]
    assert_clean(frame[features])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(OUT, index=False)
    n_up = int(frame["is_upcoming"].sum())
    print(f"{len(frame)} films ({len(frame) - n_up} released, {n_up} upcoming), "
          f"{len(features)} features -> {OUT}")
    print(f"years {frame.release_date.dt.year.min()}-{frame.release_date.dt.year.max()}")
    cov = frame[features].notna().mean().sort_values()
    print("\nthinnest coverage:")
    print(cov.head(6).to_string())
