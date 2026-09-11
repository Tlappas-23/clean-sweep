"""
Tests for the two rules the project rests on.

The claim this codebase makes is that its features are answerable before a film
opens. That claim is worth exactly as much as the tests behind it, and until
now there were none: the guards were checked once by hand and then trusted.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from boxoffice.model.leakage import BANNED, AsOf, LeakageError, assert_clean, horizon


class TestBannedColumns:
    def test_clean_frame_passes(self):
        assert_clean(pd.DataFrame({"log_budget": [1.0], "runtime_minutes": [120]}))

    @pytest.mark.parametrize("column", sorted(BANNED))
    def test_every_banned_column_is_caught(self, column):
        frame = pd.DataFrame({"log_budget": [1.0], column: [1.0]})
        with pytest.raises(LeakageError):
            assert_clean(frame)

    def test_the_error_names_the_column_and_the_reason(self):
        with pytest.raises(LeakageError) as caught:
            assert_clean(pd.DataFrame({"imdb_rating": [7.2]}))
        assert "imdb_rating" in str(caught.value)
        assert "after release" in str(caught.value)

    def test_post_release_ratings_are_all_covered(self):
        """The eight columns in the neighbouring seed that postdate release."""
        for column in (
            "imdb_rating",
            "imdb_votes",
            "rt_critic",
            "rt_audience",
            "metascore",
            "nominations",
            "wins",
            "award_standing",
        ):
            assert column in BANNED


class TestAsOf:
    @pytest.fixture
    def career(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "who": ["d1"] * 4,
                "release_date": pd.to_datetime(["2010-01-01", "2012-01-01", "2014-06-01", "2014-06-01"]),
                "value": [10.0, 20.0, 99.0, 99.0],
            }
        )

    def test_first_row_has_no_history(self, career):
        assert pd.isna(AsOf("who", "value").transform(career, "median").iloc[0])

    def test_each_row_sees_only_earlier_rows(self, career):
        got = AsOf("who", "value").transform(career, "median")
        assert got.iloc[1] == 10.0  # B sees A
        assert got.iloc[2] == 15.0  # C sees A and B

    def test_same_day_releases_cannot_see_each_other(self, career):
        """The case that makes this hard: two films opening the same morning."""
        got = AsOf("who", "value").transform(career, "median")
        assert got.iloc[2] == got.iloc[3] == 15.0
        assert 99.0 not in set(got.dropna())

    def test_no_row_ever_sees_a_later_value(self, career):
        got = AsOf("who", "value").transform(career, "median")
        for i, prior in enumerate(got):
            if pd.isna(prior):
                continue
            future = career["value"].iloc[i:]
            assert prior not in set(future) or prior in set(career["value"].iloc[:i])

    def test_survives_a_duplicated_index(self, career):
        """`explode()` duplicates index labels; positional writes must still work."""
        duped = career.copy()
        duped.index = [0, 0, 1, 1]
        got = AsOf("who", "value").transform(duped, "median")
        assert list(got.round(1)) == pytest.approx([np.nan, 10.0, 15.0, 15.0], nan_ok=True)

    def test_entities_do_not_leak_into_each_other(self):
        frame = pd.DataFrame(
            {
                "who": ["a", "b", "a", "b"],
                "release_date": pd.to_datetime(["2010-01-01"] * 2 + ["2015-01-01"] * 2),
                "value": [10.0, 500.0, 1.0, 1.0],
            }
        )
        got = AsOf("who", "value").transform(frame, "median")
        assert got.iloc[2] == 10.0  # a sees only a
        assert got.iloc[3] == 500.0  # b sees only b

    def test_rows_are_returned_in_input_order(self):
        """Sorting happens internally; the caller's order must come back intact."""
        frame = pd.DataFrame(
            {
                "who": ["x"] * 3,
                "release_date": pd.to_datetime(["2020-01-01", "2010-01-01", "2015-01-01"]),
                "value": [3.0, 1.0, 2.0],
            }
        )
        got = AsOf("who", "value").transform(frame, "median")
        assert pd.isna(got.iloc[1])  # 2010 is earliest, no history
        assert got.iloc[2] == 1.0  # 2015 sees 2010
        assert got.iloc[0] == 1.5  # 2020 sees both


class TestHorizon:
    def test_returns_only_rows_before_the_cutoff(self):
        import datetime as dt

        frame = pd.DataFrame({"release_date": pd.to_datetime(["2019-12-31", "2020-01-01", "2020-01-02"])})
        assert len(horizon(frame, dt.date(2020, 1, 1))) == 1
