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
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.leakage import AsOf, assert_clean

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "film"
OUT = ROOT / "data" / "features.parquet"
HISTORY = ROOT / "data" / "history.parquet"
CORRECTIONS = ROOT / "data" / "target_corrections.parquet"

# Two switches over the career history, both settable from the environment so
# the comparison in model/history_ablation.py can run them without editing code.
#
# HISTORY_FLOOR drops credits whose reported gross is too small to be real.
# TMDB carries grosses of $1, $5 and $16 on real feature films: data entry
# rather than box office. A one-screen festival run clears ten thousand
# dollars, so anything under that is noise being handed to a median.
#
# USE_HISTORY defaults OFF, which is the outcome of the experiment in
# model/history_ablation.py rather than an oversight. The widened history is
# unambiguously the more truthful feature: it stopped recording `Mission:
# Impossible II` as a debut. It is also worse, on corrected targets and on every
# floor tried, by one to four points of within-2x.
#
# The most likely reason is that the blank was carrying information. "Nobody
# attached has a track record inside the studio frame" is a real signal about a
# film's scale, and the booster was reading it. Replacing it with a genuine
# number measured on a different population removes that signal and substitutes
# one on the wrong scale.
#
# The fetch and the code stay, because the finding is worth more than the
# feature would have been, and because the diagnosis it produced led to the
# target corrections that did help.
HISTORY_FLOOR = float(os.environ.get("BOXOFFICE_HISTORY_FLOOR", 10_000))
USE_HISTORY = os.environ.get("BOXOFFICE_USE_HISTORY", "0") != "0"

# How a person's prior performance is expressed. "absolute" is the median of
# their earlier log grosses, which is what this started as and which quietly
# compares a 1994 opening to a 2024 one. "relative" divides each credit by the
# market it opened into first, so the feature means "how this person's films do
# against their moment" rather than "how many dollars they took".
PRIOR_SCALE = os.environ.get("BOXOFFICE_PRIOR_SCALE", "absolute")
MARKET_WINDOW_YEARS = int(os.environ.get("BOXOFFICE_MARKET_WINDOW", 3))

BUDGET_FLOOR = 1_000_000
GENRES = (
    "Action",
    "Comedy",
    "Drama",
    "Horror",
    "Science Fiction",
    "Family",
    "Thriller",
    "Documentary",
    "Animation",
    "Adventure",
)
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


def _history_pairs(role: str) -> pd.DataFrame | None:
    """A person's credits from outside the modelling frame, as as-of inputs.

    The sampling frame decides which films are *predicted*. It should never
    have decided what the model knows about the people, and for a long time it
    did: a director whose earlier films had a different distributor or a
    smaller budget was indistinguishable from someone who had never directed.
    Measured against IMDb, only 26% of blank director histories were genuine
    first features.

    These rows carry no `film_key`. They exist to inform the expanding window
    and are dropped before the result is folded back onto the sample.
    """
    if not (USE_HISTORY and HISTORY.exists()):
        return None
    hist = pd.read_parquet(HISTORY)
    hist = hist[hist["role"] == role]
    if hist.empty:
        return None
    revenue = pd.to_numeric(hist["revenue"], errors="coerce")
    revenue = revenue.where(revenue >= HISTORY_FLOOR)
    return pd.DataFrame(
        {
            "film_key": pd.Series([pd.NA] * len(hist), dtype="object").to_numpy(),
            "release_date": hist["release_date"].to_numpy(),
            "log_ww": np.log1p(revenue.where(revenue > 0)).to_numpy(),
            "entity": hist["person_id"].to_numpy(),
            "film_id": hist["film_id"].to_numpy(),
        }
    )


def _market_index(pairs: pd.DataFrame) -> pd.Series:
    """Median log gross of the films released in the years just before each one.

    The point of the division is comparability. A $40m gross in 1998 and a $40m
    gross in 2023 are not the same achievement, and neither is $40m for a horror
    picture and $40m for a tentpole. This handles the first of those: every
    credit is expressed against the market it actually opened into.

    The window is strictly trailing and shifted, so a film is never part of its
    own index and never sees a film released after it. That keeps the
    normalisation inside the same as-of rule as everything else: when a target
    film reads a person's prior, every quantity underneath it was already
    public.
    """
    frame = pairs[["release_date", "log_ww"]].sort_values("release_date").copy()
    window = f"{MARKET_WINDOW_YEARS * 365}D"

    rolled = frame.set_index("release_date")["log_ww"].rolling(window, closed="left").median()
    index = pd.Series(rolled.to_numpy(), index=frame.index)

    # Early films have nothing behind them; fall back to the first value the
    # window does produce rather than dropping the credit entirely.
    index = index.reindex(pairs.index)
    return index.bfill()


def _entity_prior(
    df: pd.DataFrame, column: str, how: str, id_key: str = "id", role: str | None = None
) -> pd.DataFrame:
    """
    As-of aggregate for a list-valued column such as cast or director.

    Explodes to one row per (film, person), computes the expanding aggregate
    per person with `AsOf`, then folds back to the film. The fold is where the
    per-film summary is chosen: median for the typical collaborator, max for
    the single biggest name attached.

    When `role` names a group with a fetched career history, that history is
    unioned in first, so "earlier film" means earlier anywhere rather than
    earlier in this sample. The as-of rule is untouched and still does the
    work: a film sees strictly earlier credits and never a later one.
    """
    pairs = df[["film_key", "release_date", "log_ww", column, "tmdb_id"]].explode(column)
    pairs = pairs[pairs[column].notna()].copy()
    if pairs.empty:
        return pd.DataFrame(index=df.index)
    pairs["entity"] = pairs[column].apply(lambda d: d.get(id_key) if isinstance(d, dict) else d)
    pairs = pairs[pairs["entity"].notna()]
    pairs = pairs.rename(columns={"tmdb_id": "film_id"})[
        ["film_key", "release_date", "log_ww", "entity", "film_id"]
    ]

    history = _history_pairs(role) if role else None
    if history is not None:
        # A sample film also appears in its own director's filmography, so the
        # same credit would otherwise be counted twice and drag the median.
        seen = pd.MultiIndex.from_arrays([pairs["entity"], pairs["film_id"]])
        incoming = pd.MultiIndex.from_arrays([history["entity"], history["film_id"]])
        history = history[~incoming.isin(seen)]
        pairs = pd.concat([pairs, history], ignore_index=True)

    pairs = pairs.sort_values("release_date", kind="mergesort").reset_index(drop=True)

    value = "log_ww"
    if PRIOR_SCALE == "relative":
        pairs["rel_ww"] = pairs["log_ww"] - _market_index(pairs)
        value = "rel_ww"
    pairs["prior"] = AsOf("entity", value).transform(pairs, how)
    # External rows have done their job informing the window.
    pairs = pairs[pairs["film_key"].notna()]
    grouped = pairs.groupby("film_key")["prior"]
    return pd.DataFrame(
        {
            f"{column}_prior_median_log": grouped.median(),
            f"{column}_prior_max_log": grouped.max(),
            f"{column}_prior_count": pairs.assign(has=pairs["prior"].notna())
            .groupby("film_key")["has"]
            .sum(),
        }
    )


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

    # Corrected before the log, and so before every career prior built from it.
    # TMDB reports a domestic figure as worldwide for a small number of films,
    # and the target is also the input to the priors, so one mislabelled credit
    # follows a director into every later film. Order matters here.
    if CORRECTIONS.exists():
        fix = pd.read_parquet(CORRECTIONS).set_index("imdb_id")["corrected_worldwide"]
        mapped = df["imdb_id"].map(fix)
        revenue = mapped.where(mapped.notna() & ~upcoming, revenue)

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
        out[f"genre_{g.lower().replace(' ', '')}"] = (
            df["genres"].apply(lambda gs, g=g: int(g in (gs or []))).astype(int)
        )

    # Calendar. Release timing is pure metadata and entirely pre-release.
    out["release_month"] = df["release_date"].dt.month
    out["release_week"] = df["release_date"].dt.isocalendar().week.astype(int)
    out["is_summer"] = df["release_date"].dt.month.isin([5, 6, 7]).astype(int)
    out["is_holiday_corridor"] = df["release_date"].dt.month.isin([11, 12]).astype(int)

    # Studio, director, cinematographer, composer, cast: all as-of. The three
    # with a fetched career history get it; companies and cast do not, because
    # a distributor's back catalogue is already almost fully inside the frame
    # and cast coverage is 95% before any widening.
    # Writer was fetched from the first run and went unused for months, which
    # is its own small lesson: the credit was sitting in the cache the whole
    # time. It is as pre-release as the director and carries a different claim
    # about a film, so it gets tested rather than assumed either way.
    for column, how, role in [
        ("companies", "median", None),
        ("director", "median", "director"),
        ("cinematographer", "median", "cinematographer"),
        ("composer", "median", "composer"),
        ("writer", "median", None),
        ("cast", "median", None),
    ]:
        out = out.join(_entity_prior(df, column, how, role=role))

    out["is_major_studio"] = (
        df["companies"].apply(lambda cs: int(any(c.get("id") in MAJORS for c in (cs or [])))).astype(int)
    )

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
    features = [
        c
        for c in frame.columns
        if not c.startswith("y_") and c not in ("film_key", "title", "imdb_id", "release_date", "is_upcoming")
    ]
    assert_clean(frame[features])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(OUT, index=False)
    n_up = int(frame["is_upcoming"].sum())
    print(
        f"{len(frame)} films ({len(frame) - n_up} released, {n_up} upcoming), "
        f"{len(features)} features -> {OUT}"
    )
    print(f"years {frame.release_date.dt.year.min()}-{frame.release_date.dt.year.max()}")
    cov = frame[features].notna().mean().sort_values()
    print("\nthinnest coverage:")
    print(cov.head(6).to_string())
