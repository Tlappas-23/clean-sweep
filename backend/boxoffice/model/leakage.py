"""
The leakage rule, written down and enforced.

Box office models fail in one of two ways, and both look like success on the
metric. The first is obvious: put revenue-adjacent columns in the feature
matrix. The second is subtle and is what actually happens in practice: use a
column that is legitimate in principle but compute it over the whole dataset,
so a 2015 film is described using facts that were not true until 2021.

This module holds both rules. `BANNED` is the list of columns that can never be
used at any point in time. `as_of` is the guard for everything else: a feature
is only allowed to see rows whose release date is strictly earlier than the row
being described.

The test suite asserts that a feature matrix contains no banned column and that
every historical aggregate was built through `as_of`. A rule nobody checks is a
comment, and this project is about the rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Columns that exist in the neighbouring Clean Sweep seed and can never be used
# here. Each accumulates only after the film has been in front of an audience,
# so knowing it on the day the campaign starts is impossible.
# --------------------------------------------------------------------------
BANNED: dict[str, str] = {
    "imdb_rating": "accumulates from votes cast after release",
    "imdb_votes": "accumulates from votes cast after release",
    "rt_critic": "aggregate settles after the review embargo lifts",
    "rt_audience": "audience score requires an audience",
    "metascore": "aggregate settles after the review embargo lifts",
    "nominations": "awarded months to years after release",
    "wins": "awarded months to years after release",
    "award_points": "derived from nominations and wins",
    "award_standing": "derived from nominations and wins",
    "box_office_usd": "the target",
    "box_office_est_usd": "an estimate of the target",
    "revenue": "the target",
    "domestic": "the target",
    "international": "the target",
}

# Legitimate pre-release signals, grouped so the ablation study can add them one
# group at a time and measure what each is worth. Studio sits here deliberately:
# the distributor is announced months out and is not leakage.
FEATURE_GROUPS: dict[str, tuple[str, ...]] = {
    "budget": ("log_budget", "budget_is_estimated"),
    "form": (
        "runtime_minutes",
        "is_sequel",
        "franchise_position",
        "certificate",
        "is_animated",
        "original_language",
    ),
    "genre": (
        "genre_action",
        "genre_comedy",
        "genre_drama",
        "genre_horror",
        "genre_scifi",
        "genre_family",
        "genre_thriller",
        "genre_documentary",
    ),
    "calendar": (
        "release_month",
        "release_week",
        "is_summer",
        "is_holiday_corridor",
        "days_to_nearest_tentpole",
    ),
    "studio": ("studio_prior_median_log", "studio_prior_count", "is_major_studio"),
    "director": ("director_prior_median_log", "director_prior_count", "director_prior_best_log"),
    "cast": ("lead_prior_median_log", "cast_prior_median_log", "cast_prior_max_log", "cast_prior_count"),
    "craft": ("cinematographer_prior_median_log", "composer_prior_median_log"),
}


class LeakageError(AssertionError):
    """Raised when a banned column reaches the feature matrix."""


def assert_clean(frame: pd.DataFrame) -> None:
    """Fail loudly if any banned column is present in a feature matrix."""
    found = [c for c in frame.columns if c in BANNED]
    if found:
        why = "; ".join(f"{c}: {BANNED[c]}" for c in found)
        raise LeakageError(f"post-release columns in the feature matrix -> {why}")


@dataclass(frozen=True)
class AsOf:
    """
    An expanding-window aggregator keyed on release date.

    Every historical feature in this project is some version of "how did the
    films this person or company released *before now* perform". Computing that
    with a plain groupby uses the whole career, including films that had not
    opened yet, which is the leak that survives code review because the column
    name still sounds innocent.

    Rows are sorted by release date and each row sees only strictly earlier
    rows. Ties on the same date are excluded rather than included: two films
    opening the same weekend cannot inform each other.
    """

    key: str  # column holding the entity, e.g. director_id
    value: str  # column holding the outcome, e.g. log_worldwide
    when: str = "release_date"

    def transform(self, frame: pd.DataFrame, how: str = "median") -> pd.Series:
        # Work positionally rather than on labels. Callers explode cast and crew
        # lists to one row per (film, person), which duplicates index labels, and
        # label-based assignment cannot write into a duplicated index.
        work = frame[[self.key, self.value, self.when]].reset_index(drop=True)
        work = work.sort_values(self.when, kind="mergesort")

        out = np.full(len(work), np.nan, dtype="float64")
        for _, block in work.groupby(self.key, sort=False):
            values = block[self.value]
            dates = block[self.when]
            # expanding() includes the current row, so shift the window by one
            # to drop it, then hold the value steady across a shared date.
            prior = getattr(values.expanding(), how)().shift(1)
            first_of_day = dates.ne(dates.shift(1))
            # Where several films share a date, all of them must see the same
            # history: the state as of the first of them.
            prior = prior.where(first_of_day).ffill()
            out[block.index.to_numpy()] = prior.to_numpy()
        return pd.Series(out, index=frame.index)


def horizon(frame: pd.DataFrame, cutoff: date) -> pd.DataFrame:
    """Rows strictly before `cutoff`, which is what a model at that date knew."""
    return frame[frame["release_date"] < pd.Timestamp(cutoff)]
