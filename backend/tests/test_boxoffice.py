"""
Tests for the box-office estimator (``tests.test_boxoffice``).

The estimator fills a gap in data the game shows to players, so what needs
pinning down is not its accuracy - that is measured by the validation harness
against held-out films - but its honesty: that it never overwrites a
measurement, that every estimate is identifiable as one, and that it falls
back sensibly when a group is too thin to learn from.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import boxoffice


def films_frame(rows: list[dict]) -> pd.DataFrame:
    defaults = {"title": "A Film", "year": 1960, "genres": ["Drama"], "imdb_votes": 50_000}
    return pd.DataFrame([{**defaults, **r} for r in rows])


def _block(n: int, year: int, votes_base: int, revenue: float) -> list[dict]:
    """A group of known films, big enough for the estimator to trust."""
    return [
        {
            "film_id": f"tt{year}{i}",
            "year": year,
            "imdb_votes": votes_base * (i + 1),
            "box_office_usd": revenue * (i + 1),
        }
        for i in range(n)
    ]


def test_a_measured_revenue_is_never_overwritten():
    """The estimate lives in its own column; measurement is untouchable."""
    films = films_frame(_block(12, 1960, 10_000, 1e6))
    out = boxoffice.estimate(films)

    pd.testing.assert_series_equal(
        pd.to_numeric(out[boxoffice.MEASURED_COLUMN]),
        pd.to_numeric(films["box_office_usd"]),
        check_names=False,
    )
    assert out[boxoffice.ESTIMATE_COLUMN].isna().all(), "nothing was missing, so nothing is estimated"


def test_a_missing_revenue_is_estimated_and_identifiable():
    films = films_frame([*_block(12, 1960, 10_000, 1e6), {"film_id": "tt_gap", "year": 1960}])
    out = boxoffice.estimate(films)

    gap = out[out.film_id == "tt_gap"].iloc[0]
    assert pd.isna(gap[boxoffice.MEASURED_COLUMN]), "an estimate must not masquerade as measured"
    assert gap[boxoffice.ESTIMATE_COLUMN] > 0

    # And the combined view is what a card would show.
    combined = boxoffice.combined(out)
    assert combined.notna().all()


def test_better_known_films_in_a_group_are_estimated_higher():
    """
    The votes term is what stops every film in a year getting one answer.

    Without it the estimator would be a group median, which the validation
    shows is markedly worse at reproducing the within-year ranking.
    """
    known = _block(12, 1960, 10_000, 1e6)
    films = films_frame(
        [
            *known,
            {"film_id": "tt_small", "year": 1960, "imdb_votes": 5_000},
            {"film_id": "tt_big", "year": 1960, "imdb_votes": 900_000},
        ]
    )
    out = boxoffice.estimate(films).set_index("film_id")
    assert out.loc["tt_big", boxoffice.ESTIMATE_COLUMN] > out.loc["tt_small", boxoffice.ESTIMATE_COLUMN]


def test_a_thin_group_falls_back_to_a_broader_one():
    """
    A year with two known films must not have its median treated as evidence.

    The ladder should step out to the decade rather than inventing a figure
    from almost nothing.
    """
    films = films_frame(
        [
            *_block(12, 1962, 20_000, 5e6),  # a solid 1960s block
            {"film_id": "tt_a", "year": 1965, "box_office_usd": 9e9},  # freak pair
            {"film_id": "tt_b", "year": 1965, "box_office_usd": 8e9},
            {"film_id": "tt_gap", "year": 1965, "imdb_votes": 20_000},
        ]
    )
    out = boxoffice.estimate(films).set_index("film_id")
    estimate = out.loc["tt_gap", boxoffice.ESTIMATE_COLUMN]
    # Had it trusted the two-film 1965 median it would land in the billions.
    assert estimate < 1e9


def test_placeholder_revenues_are_treated_as_unknown():
    """TMDB stores 0 for 'not recorded', and token values are not a gross."""
    films = films_frame(
        [*_block(12, 1960, 10_000, 1e6), {"film_id": "tt_zero", "year": 1960, "box_office_usd": 0.0}]
    )
    out = boxoffice.estimate(films).set_index("film_id")
    assert pd.isna(out.loc["tt_zero", boxoffice.MEASURED_COLUMN])
    assert out.loc["tt_zero", boxoffice.ESTIMATE_COLUMN] > 0


def test_the_elasticity_is_fitted_within_groups_not_across_eras():
    """
    Fitting on the pooled cloud would measure inflation, not the within-year
    relationship the estimator uses.
    """
    # Two eras with opposite scales but the same internal relationship.
    old = _block(12, 1955, 10_000, 1e5)
    new = _block(12, 2015, 500_000, 1e8)
    beta = boxoffice.fit_elasticity(boxoffice.prepare(films_frame([*old, *new])))
    assert 0.2 < beta < 3.0, f"implausible elasticity {beta}"


def test_validation_reports_a_paired_comparison_against_baselines():
    """The harness must produce the numbers the docs quote."""
    rng = np.random.default_rng(0)
    rows = []
    for year in range(1990, 2005):
        for i in range(14):
            votes = int(rng.integers(5_000, 900_000))
            rows.append(
                {
                    "film_id": f"tt{year}_{i}",
                    "year": year,
                    "imdb_votes": votes,
                    "box_office_usd": float(votes) * rng.uniform(50, 500),
                }
            )
    report = boxoffice.validate(films_frame(rows), folds=3)

    assert set(report["within_year_spearman"]) == {"estimator", "group_median", "votes_only"}
    for key in ("vs_group_median", "vs_votes_only"):
        assert key in report
    assert report["n_known"] > 0
