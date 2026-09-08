"""
Weighted Oscar standing per film (``pipeline.awards``).

Why this exists
---------------
The game used to score a pick's Academy result as a single ground-truth
number: 100 if that contender won the category being played, 60 if nominated,
0 otherwise. The 0 is the problem. It is not a claim that the film is
worthless, only that the Academy did not nominate it *in this category*, and
those are very different statements.

Jurassic Park is the case that makes it obvious. It won three Oscars, took
just over a billion dollars, and sits at 8.2 on IMDb with 1.2 million votes.
None of those three wins was in one of the six categories the game plays, so
under the old metric every Jurassic Park contender scored a flat zero on the
biggest component of the score. A player who drafted it was told, in effect,
that they had picked a nobody.

So the metric now asks a second question. Not just "did this contender win
this award", but "what did the Academy make of this film at all". The seed
already holds every nomination in every category (about 16,700 rows over
55 categories), and the old scorer used six of them.

How the standing is built
-------------------------
**Not every Oscar is the same size.** Best Picture is not Sound Mixing, and a
metric that counted them equally would say Jurassic Park had a better night
than a film that lost Best Picture. Categories are therefore banded by weight
(:data:`CATEGORY_TIERS`), with the above-the-line awards worth most.

**A loss still counts, at a discount.** Being nominated for Best Picture and
losing is a real achievement and the record should say so, so a nomination
scores :data:`LOSS_CREDIT` of what the win would.

**The scale saturates.** Points are mapped through ``p / (p + K)`` rather than
scaled linearly, because the difference between zero Oscars and three is much
larger than the difference between eight and eleven. Without it, Ben-Hur would
tower over everything else on the board.

**It can never outrank a real nomination.** The result is capped at
:data:`STANDING_CEILING`, which sits below the 60 a nominee scores. An actor
who was not nominated does not get to beat an actor who was, however well the
film did elsewhere. The cap is what keeps the game about the ballot.

A note on the source data
-------------------------
``nominations.parquet`` records ``won`` as a nullable boolean holding only
``True`` and null: a *loss* is null, not ``False``. Reading it without
``fillna(False)`` silently drops every losing nomination, which makes films
like The Shawshank Redemption (seven nominations, no wins) look as though the
Academy ignored them completely. :func:`film_points` handles it in one place
so no caller has to remember.

Nominations are also stored one row per nominee, so a category with four
credited producers appears four times. They are deduplicated on
``(film_id, ceremony, category_raw)`` before anything is counted.
"""

from __future__ import annotations

import pandas as pd

#: What each band of award is worth. Matched against the raw Academy category
#: name, longest-standing conventions first, and the first band that matches
#: wins. The numbers are ordinal rather than measured: they encode the ordinary
#: understanding that Best Picture outranks Best Sound, which is a judgement
#: the data cannot make for us.
CATEGORY_TIERS: tuple[tuple[float, tuple[str, ...]], ...] = (
    # Shorts and documentaries are their own films, not credits on a feature.
    # They are excluded rather than down-weighted so a feature never picks up
    # standing from a short that happens to share an id.
    (0.0, ("SHORT", "DOCUMENTARY")),
    # Above the line: the awards a film is remembered for.
    (4.0, ("PICTURE", "DIRECTING", "ACTOR", "ACTRESS", "WRITING")),
    # The senior craft awards.
    (
        2.0,
        (
            "CINEMATOGRAPHY",
            "FILM EDITING",
            "ORIGINAL SCORE",
            "ART DIRECTION",
            "PRODUCTION DESIGN",
            "INTERNATIONAL FEATURE",
            "FOREIGN LANGUAGE",
            "ANIMATED FEATURE",
        ),
    ),
)

#: Everything else: sound, visual effects, costume, makeup, song.
DEFAULT_TIER = 1.5

#: What a losing nomination is worth against a win in the same category.
LOSS_CREDIT = 0.4

#: Half-saturation point of the standing curve, in weighted points. A film on
#: exactly this many points scores half the ceiling. Eight is roughly the 90th
#: percentile of the catalogue, so the curve spends its resolution where almost
#: every film actually sits rather than on the handful of record holders.
SATURATION = 8.0

#: The most a film's overall standing can contribute.
#:
#: This constant is where two goals meet, and it was settled by measurement
#: rather than taste. Standing has to lift a film like Jurassic Park off zero,
#: but the season table also has to keep punishing a genuinely bad pick, and
#: those pull against each other: the higher the ceiling, the closer an
#: un-nominated pick sits to a nominee.
#:
#: Gridded over ceiling x ceremony weight x ``T_MAX``, 20,000 draws a cell, the
#: strongest ballot carrying one un-nominated pick sweeps:
#:
#:     ceiling     55      35      25      15
#:     rate     0.598   0.020   0.000   0.000    (weight 0.60, T_MAX 76)
#:
#: The old rule wanted that rate at zero, which is what a ceiling of 26 or
#: lower buys. It was tried and rejected, because at that height the lift is
#: not worth having: Jurassic Park moved 39.4 to 39.0, which is no change at
#: all, and the whole exercise was pointless.
#:
#: 50 is the deliberate other choice. It accepts that the rule now
#: discriminates on quality rather than on nomination. Measured over 6,000
#: draws at the committed constants:
#:
#:     perfect ballot                sweeps 1.000
#:     one great un-nominated pick   sweeps 0.179
#:     one weak un-nominated pick    sweeps 0.000
#:     six losing nominees           sweeps 0.000
#:
#: A weak pick still sinks a season every time. A landmark film the Academy
#: overlooked no longer does automatically, and that is the point of the
#: change. See docs/BALANCE.md.
STANDING_CEILING = 50.0


def category_weight(category_raw: str | None) -> float:
    """What one award in this category is worth. See :data:`CATEGORY_TIERS`."""
    name = (category_raw or "").upper()
    for weight, keywords in CATEGORY_TIERS:
        if any(keyword in name for keyword in keywords):
            return weight
    return DEFAULT_TIER


def film_points(nominations: pd.DataFrame) -> pd.Series:
    """
    Weighted award points per film, indexed by ``film_id``.

    Deduplicates the per-nominee rows, reads a null ``won`` as a loss rather
    than as missing data, and weights each result by its category band.
    """
    rows = nominations.dropna(subset=["film_id"]).drop_duplicates(["film_id", "ceremony", "category_raw"])
    weight = rows["category_raw"].map(category_weight)
    # A null ``won`` means the nomination lost. Treating it as missing would
    # drop every losing nomination and erase films that were nominated
    # repeatedly without winning.
    won = rows["won"].fillna(False).astype(bool)
    credit = won.map({True: 1.0, False: LOSS_CREDIT})
    return (weight * credit).groupby(rows["film_id"]).sum()


def standing(points: pd.Series) -> pd.Series:
    """
    Map weighted points onto 0-:data:`STANDING_CEILING`.

    Saturating rather than linear, so the first Oscar moves a film far more
    than the ninth does.
    """
    return STANDING_CEILING * points / (points + SATURATION)


def add_film_standing(films: pd.DataFrame, nominations: pd.DataFrame) -> pd.DataFrame:
    """
    Attach ``award_points`` and ``award_standing`` to a films frame.

    Films with no Academy record at all get 0 for both, which is the truth
    about them rather than missing data, so the scorer should not renormalise
    it away.
    """
    out = films.copy()
    points = film_points(nominations)
    out["award_points"] = out["film_id"].map(points).fillna(0.0)
    out["award_standing"] = standing(out["award_points"])
    return out
