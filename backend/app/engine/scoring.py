"""
Pick scoring (``app.engine.scoring``): five metrics -> one 0-100 number.

This is the game's score. Every pick is rated 0-100 on how good the *film*
is, all in, and a ballot is the sum of its eight picks. That is the number a
player chases and tries to beat, so it has to mean something on its own,
without a rulebook.

The rules are in docs/GAME_DESIGN.md §3. A contender's *pick score* is the
weighted mean of its metrics. Any of them can be missing, so rather than
treating a missing metric as zero (which would punish every pick equally and
compress the scale), the weights are renormalised over the metrics that *are*
present. A ballot scored before and after enrichment therefore lives on the
same 0-100 scale, only with more signal.

What the five are
-----------------
``ceremony``    what the Academy made of the pick, and of its film
``critics``     Rotten Tomatoes and Metascore, percentile within the year
``audience``    IMDb rating, percentile within the year
``box_office``  measured revenue, percentile within the year
``popularity``  IMDb vote count, percentile within the year

There is no model prediction in here. ``prestige``, the ranker's estimated
probability that a contender won, used to carry part of the score, which meant
a player's record partly depended on what a gradient-boosted tree guessed
rather than on anything they could look up. It is reported as analytics only
(see ``ml/validate.py``) and every point of a ballot comes from an observable
fact plus the actual outcome.

Why ``ceremony`` is not just "did they win"
-------------------------------------------
It used to be: 100 for a win in the category being played, 60 for a
nomination, 0 for anything else. The zero was doing damage. It reads as a
statement about the film when it is only a statement about one category.

Jurassic Park is the case that shows it. Three Oscars, a billion dollars, 8.2
on IMDb, and not one of those wins in a category this game plays, so every
Jurassic Park contender scored a flat zero on the largest component of the
score. Drafting a landmark film was scored as drafting a nobody.

So the metric takes the better of two readings: the contender's own result in
the category being played, and the standing of their film across the whole
Academy record (``pipeline.awards``). Taking the maximum, rather than blending,
is what keeps the ordering intact. A win in this category is still 100 and a
nomination is still 60, because film standing is capped below 60. Nothing a
film achieves elsewhere can outrank an actual nomination for the award on the
board; it can only stop an un-nominated pick from being scored as worthless.
"""

from __future__ import annotations

from typing import Protocol

# Relative importance of each metric.
#
# Why ceremony is 0.35 and not 0.60
# ---------------------------------
# It was 0.60, and that was not a judgement about films. It was propping up a
# rule: the season used to be won by taking all 30 ceremonies, and that rule
# only held if a single un-nominated pick reliably sank a ballot. Measured at
# the time, dropping ceremony to 0.46 let such a ballot sweep 37% of the time
# against a requirement of roughly zero. So the award had to dominate.
#
# The sweep is no longer the goal; the score is. That removes the constraint,
# and with it the reason to let one input own three fifths of a number that
# claims to describe a film. What 0.60 actually produced, measured across all
# 49,826 contenders:
#
#   Fight Club     32.1        a forgettable nominee, average   58.8
#   Blade Runner   33.8
#   Jurassic Park  44.5
#
# A film people love scoring below one nobody remembers is not a quality
# scale, it is an award lookup wearing one. At 0.35 the same films read
# 49.5, 49.5 and 57.8, while an actual winner still averages 82.8 against a
# nominee's 59.1: drafting the winner is still clearly the strongest play,
# which it has to be in a game about the Oscars, but it is now a lead rather
# than the whole score.
#
# The award still carries more than any other single input, because it is the
# only one that is a verdict rather than a measurement. The other four are
# roughly balanced: critics and audience slightly ahead of box office, and
# popularity last, since a lot of people seeing a film says more about its
# reach than its quality.
#
# Critics and audience are deliberately close. Neither is the authority on
# whether a film is good, and weighting one far above the other would be an
# opinion the data cannot support.
METRIC_WEIGHTS: dict[str, float] = {
    "ceremony": 0.35,
    "critics": 0.22,
    "audience": 0.18,
    "box_office": 0.15,
    "popularity": 0.10,
}
assert abs(sum(METRIC_WEIGHTS.values()) - 1.0) < 1e-9, METRIC_WEIGHTS

# The contender's own result in the category being played. Ground truth, not a
# percentile.
CEREMONY_WIN = 100.0
CEREMONY_NOMINATION = 60.0

# Human-facing descriptions for the meta endpoint (kept with the weights so
# the two cannot drift apart).
METRIC_INFO: list[dict[str, str]] = [
    {
        "id": "ceremony",
        "label": "Ceremony",
        "description": (
            "100 for winning this category, 60 for a nomination in it, and "
            "otherwise the film's standing across every Academy category, "
            "weighted by how senior the award is."
        ),
    },
    {
        "id": "critics",
        "label": "Critics",
        "description": "Rotten Tomatoes and Metascore, percentile within the film year.",
    },
    {
        "id": "audience",
        "label": "Audience",
        "description": "IMDb rating, percentile within the film year.",
    },
    {
        "id": "box_office",
        "label": "Box Office",
        "description": "Measured revenue, percentile within the film year. Estimates are not scored.",
    },
    {
        "id": "popularity",
        "label": "Popularity",
        "description": "IMDb vote count, percentile within the film year.",
    },
]


class Scorable(Protocol):
    """The subset of ``ContenderRecord`` the scorer reads (also satisfied by test fakes)."""

    nominated: bool
    won: bool
    award_standing: float | None
    critics: float | None
    audience: float | None
    popularity: float | None
    box_office: float | None


def ceremony_metric(record: Scorable) -> float:
    """
    What the Academy made of this pick: the better of its two readings.

    A win or a nomination in the category being played is ground truth and
    wins outright. Failing that, the film's standing across every category
    stands in, capped below a nomination so it can never overtake one.
    """
    if record.won:
        return CEREMONY_WIN
    standing = record.award_standing or 0.0
    if record.nominated:
        return max(CEREMONY_NOMINATION, standing)
    return standing


def metric_breakdown(record: Scorable) -> dict[str, float | None]:
    """All five metrics keyed by name, ``None`` where the data is not available."""
    return {
        "ceremony": ceremony_metric(record),
        "critics": record.critics,
        "audience": record.audience,
        "box_office": record.box_office,
        "popularity": record.popularity,
    }


def score_from_metrics(metrics: dict[str, float | None]) -> float:
    """
    Weighted mean over the non-null metrics, with weights renormalised to 1.

    Example: with only ceremony, audience and popularity present the effective
    weights become 0.60/0.78, 0.10/0.78 and 0.08/0.78.
    """
    available = {name: value for name, value in metrics.items() if value is not None}
    if not available:
        return 0.0
    total_weight = sum(METRIC_WEIGHTS[name] for name in available)
    weighted = sum(METRIC_WEIGHTS[name] * value for name, value in available.items())
    return weighted / total_weight


def pick_score(record: Scorable) -> float:
    """0-100 pick score of a contender (see module docstring)."""
    return score_from_metrics(metric_breakdown(record))
