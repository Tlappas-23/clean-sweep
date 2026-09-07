"""
Pick scoring (``app.engine.scoring``): five metrics -> one 0-100 number.

The rules are in docs/GAME_DESIGN.md §3. A contender's *pick score* is the
weighted mean of its metrics. Two of the five can be missing:

* ``prestige`` is null until the ML ranker has been run, and
* ``box_office`` is null until the TMDB enrichment fills in revenue.

Rather than treating a missing metric as zero (which would punish every
pick equally and compress the scale), the weights are renormalised over
the metrics that *are* present. A ballot scored before and after enrichment
therefore lives on the same 0-100 scale, only with more signal.
"""

from __future__ import annotations

from typing import Protocol

# Relative importance of each metric. Academy dominates because knowing who
# actually won is the whole point of the game; the other four reward picks
# that were at least strong candidates when no nomination is at hand.
METRIC_WEIGHTS: dict[str, float] = {
    "academy": 0.40,
    "prestige": 0.20,
    "acclaim": 0.15,
    "popularity": 0.10,
    "box_office": 0.15,
}

# The Academy metric is ground truth, not a percentile.
ACADEMY_WIN = 100.0
ACADEMY_NOMINATION = 60.0
ACADEMY_NONE = 0.0

# Human-facing descriptions for the meta endpoint (kept with the weights so
# the two cannot drift apart).
METRIC_INFO: list[dict[str, str]] = [
    {
        "id": "academy",
        "label": "Academy",
        "description": "100 for the winner, 60 for a nominee, 0 otherwise.",
    },
    {
        "id": "prestige",
        "label": "Prestige",
        "description": "Ranker probability of winning, percentile within the year.",
    },
    {
        "id": "acclaim",
        "label": "Acclaim",
        "description": "IMDb rating, percentile within the film year.",
    },
    {
        "id": "popularity",
        "label": "Popularity",
        "description": "IMDb vote count, percentile within the film year.",
    },
    {
        "id": "box_office",
        "label": "Box Office",
        "description": "Revenue, percentile within the film year.",
    },
]


class Scorable(Protocol):
    """The subset of ``ContenderRecord`` the scorer reads (also satisfied by test fakes)."""

    nominated: bool
    won: bool
    acclaim: float | None
    popularity: float | None
    box_office: float | None
    prestige: float | None


def academy_metric(record: Scorable) -> float:
    """Ground-truth metric: 100 won / 60 nominated / 0."""
    if record.won:
        return ACADEMY_WIN
    if record.nominated:
        return ACADEMY_NOMINATION
    return ACADEMY_NONE


def metric_breakdown(record: Scorable) -> dict[str, float | None]:
    """All five metrics keyed by name, ``None`` where the data is not available."""
    return {
        "academy": academy_metric(record),
        "prestige": record.prestige,
        "acclaim": record.acclaim,
        "popularity": record.popularity,
        "box_office": record.box_office,
    }


def score_from_metrics(metrics: dict[str, float | None]) -> float:
    """
    Weighted mean over the non-null metrics with weights renormalised to sum to 1.

    Example: with only academy / acclaim / popularity present the effective
    weights become 0.40/0.65, 0.15/0.65 and 0.10/0.65.
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
