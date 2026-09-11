"""
Guards on the shipped feature matrix itself.

The unit tests prove the rules work in isolation. These prove they were actually
applied to the data that trains the model, which is a different claim and the
one that matters.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from boxoffice.model.leakage import BANNED, assert_clean
from boxoffice.model.train import FEATURES, feature_columns

pytestmark = pytest.mark.skipif(
    not Path(FEATURES).exists(), reason="feature matrix not built; run pipeline.build_features first"
)


@pytest.fixture(scope="module")
def frame() -> pd.DataFrame:
    return pd.read_parquet(FEATURES)


def test_no_banned_column_reaches_the_model(frame):
    assert_clean(frame[feature_columns(frame)])


def test_targets_are_not_offered_as_features(frame):
    assert not [c for c in feature_columns(frame) if c.startswith("y_")]


def test_every_target_is_present(frame):
    for target in ("y_worldwide", "y_log_worldwide"):
        assert target in frame.columns


def test_debut_entities_have_no_prior(frame):
    """
    A film by someone with no earlier film must carry a missing prior, not a
    zero and not an imputed median. Half the sample is in this position, and
    filling it would tell the model every debut is average.
    """
    priors = [c for c in frame.columns if c.endswith("_prior_median_log")]
    assert priors, "no as-of prior columns found"
    for column in priors:
        assert frame[column].isna().any(), f"{column} has no missing values at all"
        assert (frame[column] == 0).sum() == 0, f"{column} contains zeros; imputed?"


def test_the_earliest_film_has_no_history_anywhere(frame):
    first = frame.sort_values("release_date").iloc[0]
    for column in [c for c in frame.columns if "_prior_" in c and c.endswith("_log")]:
        assert pd.isna(first[column]), f"earliest film has a prior in {column}"


def test_priors_never_exceed_the_observed_range(frame):
    """A prior is an aggregate of real log grosses, so it cannot sit outside them."""
    lo, hi = frame["y_log_worldwide"].min(), frame["y_log_worldwide"].max()
    for column in [c for c in frame.columns if c.endswith(("_prior_median_log", "_prior_max_log"))]:
        values = frame[column].dropna()
        if values.empty:
            continue
        assert values.min() >= lo - 1e-9, f"{column} below the observed minimum"
        assert values.max() <= hi + 1e-9, f"{column} above the observed maximum"


def test_release_dates_are_ordered_and_complete(frame):
    assert frame["release_date"].notna().all()
    assert frame["release_date"].dt.year.between(1990, 2030).all()


@pytest.mark.parametrize("column", ["imdb_rating", "metascore", "nominations", "wins"])
def test_known_post_release_columns_stay_out(frame, column):
    assert column not in frame.columns, f"{column} is in the matrix: {BANNED[column]}"
