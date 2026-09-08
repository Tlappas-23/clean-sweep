"""
Award standing tests (``tests.test_awards``).

The module these cover exists because of one specific complaint: a film that
won three Oscars in categories the game does not play used to score zero on
the largest component of the pick score. So the tests that matter here are the
ones about *not* scoring such a film as worthless, and about the two traps in
the source data that would silently reintroduce the bug.
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.engine.scoring import CEREMONY_NOMINATION, CEREMONY_WIN, ceremony_metric
from pipeline import awards


def nominations(rows: list[tuple[str, int, str, bool | None]]) -> pd.DataFrame:
    """Build a nominations frame. ``won`` is nullable exactly as the seed has it."""
    return pd.DataFrame(
        [{"film_id": f, "ceremony": c, "category_raw": cat, "won": w} for f, c, cat, w in rows]
    ).astype({"won": "boolean"})


class Record:
    """The slice of a contender the scorer reads."""

    def __init__(self, *, nominated=False, won=False, award_standing=0.0):
        self.nominated = nominated
        self.won = won
        self.award_standing = award_standing
        self.critics = self.audience = self.popularity = self.box_office = None


# --- the two data traps ------------------------------------------------------
def test_a_losing_nomination_is_a_loss_not_missing_data():
    """
    The trap that would erase every film nominated without winning.

    ``won`` in the seed is a nullable boolean holding only True and null: a
    loss is null. Read naively that drops every losing nomination, and a film
    like The Shawshank Redemption, seven nominations and no wins, comes back
    looking as though the Academy never noticed it.
    """
    frame = nominations(
        [("tt1", 67, "BEST PICTURE", None), ("tt1", 67, "WRITING (Adapted Screenplay)", None)]
    )
    points = awards.film_points(frame)
    assert points["tt1"] == pytest.approx(2 * 4.0 * awards.LOSS_CREDIT)
    assert points["tt1"] > 0, "a losing nomination must still count for something"


def test_one_award_with_several_nominees_counts_once():
    """
    Nominations are stored one row per nominee, so a category with four
    credited producers appears four times. The film won it once.
    """
    frame = nominations([("tt1", 66, "VISUAL EFFECTS", True)] * 4)
    assert awards.film_points(frame)["tt1"] == pytest.approx(awards.DEFAULT_TIER)


# --- the weighting -----------------------------------------------------------
def test_a_senior_award_outweighs_a_technical_one():
    """Best Picture is not Sound Mixing, and the metric has to know it."""
    assert awards.category_weight("BEST PICTURE") > awards.category_weight("SOUND MIXING")
    assert awards.category_weight("DIRECTING") > awards.category_weight("CINEMATOGRAPHY")
    assert awards.category_weight("CINEMATOGRAPHY") > awards.category_weight("COSTUME DESIGN")


def test_shorts_and_documentaries_are_not_credits_on_a_feature():
    """They are their own films, so they must not lend a feature any standing."""
    assert awards.category_weight("SHORT FILM (Animated)") == 0.0
    assert awards.category_weight("DOCUMENTARY (Feature)") == 0.0


def test_a_win_outweighs_a_nomination_in_the_same_category():
    won = nominations([("tt1", 60, "BEST PICTURE", True)])
    lost = nominations([("tt2", 60, "BEST PICTURE", None)])
    assert awards.film_points(won)["tt1"] > awards.film_points(lost)["tt2"]


def test_standing_saturates_rather_than_running_away():
    """
    The first Oscar has to move a film far more than the ninth.

    Without this the record holders would tower over everything else and the
    metric would stop discriminating among the films players actually see.
    """
    points = pd.Series([0.0, 4.0, 8.0, 16.0, 32.0])
    values = awards.standing(points)
    assert values.iloc[0] == 0.0
    assert values.is_monotonic_increasing
    # Half the ceiling at the half-saturation point, by construction.
    assert values.iloc[2] == pytest.approx(awards.STANDING_CEILING / 2)
    # Doubling the points again buys less than the previous doubling did.
    assert (values.iloc[4] - values.iloc[3]) < (values.iloc[3] - values.iloc[2])
    assert values.max() < awards.STANDING_CEILING


# --- the rule the whole change turns on --------------------------------------
def test_standing_can_never_outrank_a_real_nomination():
    """
    The cap is what keeps the game about the ballot.

    However many Oscars a film won elsewhere, an actor who was not nominated
    does not get to score above an actor who was.
    """
    assert awards.STANDING_CEILING < CEREMONY_NOMINATION
    best_possible = awards.standing(pd.Series([1e6])).iloc[0]
    assert ceremony_metric(Record(award_standing=best_possible)) < CEREMONY_NOMINATION


def test_an_overlooked_film_is_not_scored_as_worthless():
    """
    The complaint that prompted the metric.

    A film that won three Oscars outside the six categories the game plays
    used to score a flat zero. It must now score something.
    """
    jurassic = nominations(
        [
            ("tt0107290", 66, "SOUND EDITING", True),
            ("tt0107290", 66, "SOUND MIXING", True),
            ("tt0107290", 66, "VISUAL EFFECTS", True),
        ]
    )
    stand = awards.standing(awards.film_points(jurassic)).iloc[0]
    scored = ceremony_metric(Record(nominated=False, won=False, award_standing=stand))
    assert scored > 0.0, "three Oscars must not score zero"
    assert scored < CEREMONY_NOMINATION, "but still below an actual nomination"


def test_the_played_category_result_always_wins():
    """A win here is 100 and a nomination here is at least 60, whatever else."""
    assert ceremony_metric(Record(won=True, nominated=True, award_standing=0.0)) == CEREMONY_WIN
    assert ceremony_metric(Record(nominated=True, award_standing=0.0)) == CEREMONY_NOMINATION
    # A strong film cannot drag a nomination *down*.
    high = Record(nominated=True, award_standing=awards.STANDING_CEILING)
    assert ceremony_metric(high) >= CEREMONY_NOMINATION


def test_a_film_the_academy_never_saw_scores_zero():
    """Zero is the truth about it, not missing data, so it is not renormalised away."""
    assert ceremony_metric(Record(award_standing=0.0)) == 0.0
    assert ceremony_metric(Record(award_standing=None)) == 0.0
