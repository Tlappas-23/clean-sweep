"""
The genre crown: a derived answer key for Best Horror and Best Comedy.

Architecture note
-----------------
Six of the eight ballot categories are real Academy Awards, so their answer
key is a matter of record: the nomination data says who was nominated and who
won. The Academy never created a horror or comedy award, though. Horror in
particular has 8 wins in 99 years across *all* categories, so "did it win an
Oscar" cannot decide a Best Horror round - almost every year would be
unwinnable.

Instead each (year, genre) pool elects its own winner from the data, and that
election is written into the same ``nominated`` / ``won`` columns the Oscar
categories use. Everything downstream - the scorer, the season simulation,
the reveal screen - then treats all eight categories identically.

Why a Bayesian weighted rating
------------------------------
Ranking a genre-year by raw IMDb rating hands the crown to obscure films: a
7.9 from 900 votes outranks a 7.8 from 900,000. Ranking by vote count instead
just crowns the year's biggest release regardless of quality. The standard
fix is the weighted rating IMDb itself uses for its Top 250, which pulls a
film's rating toward the pool mean in proportion to how little evidence backs
it::

    WR = (v / (v + m)) * R + (m / (v + m)) * C

``R`` is the film's rating and ``v`` its vote count; ``C`` is the mean rating
of the pool it is competing in and ``m`` is a vote threshold. A film with far
more votes than ``m`` keeps essentially its own rating; one with far fewer is
dragged most of the way back to ``C`` and cannot win on a thin sample.

Both ``C`` and ``m`` are computed *within the (year, genre) pool*, matching
how every other metric in this project is scoped: a 1931 horror film is
judged against 1931 horror films, never against 2019.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Floor for the vote threshold so a tiny pool cannot end up with m ~ 0, which
# would collapse the weighted rating back to the raw rating it is correcting.
MIN_VOTE_THRESHOLD = 1_000


def weighted_rating(ratings: pd.Series, votes: pd.Series) -> pd.Series:
    """
    Bayesian weighted rating of one pool (see module docstring).

    ``C`` is the pool's mean rating and ``m`` its median vote count (floored),
    so half the pool sits above the threshold and half is pulled toward the
    mean. Films with no rating or no votes score NaN and never win a crown.
    """
    ratings = pd.to_numeric(ratings, errors="coerce").astype("float64")
    votes = pd.to_numeric(votes, errors="coerce").astype("float64")

    known = ratings.notna() & votes.notna()
    if not known.any():
        return pd.Series(np.nan, index=ratings.index, dtype="float64")

    pool_mean = float(ratings[known].mean())
    threshold = max(float(votes[known].median()), MIN_VOTE_THRESHOLD)

    weight = votes / (votes + threshold)
    return (weight * ratings + (1.0 - weight) * pool_mean).where(known)


def genre_crowns(films: pd.DataFrame, genre: str, n_nominees: int) -> pd.DataFrame:
    """
    Elect a crown (and its runners-up) for every year of one genre.

    ``films`` needs ``film_id``, ``year``, ``genres``, ``imdb_rating`` and
    ``imdb_votes``. Returns one row per film in the genre with the columns
    ``film_id``, ``year``, ``crown_score``, ``crown_rank``, ``nominated`` and
    ``won`` - the last two shaped exactly like the Oscar answer key, so the
    caller can concatenate them without special-casing.

    The top film of a year takes the crown (``won``); it and the next
    ``n_nominees`` count as nominated. A year with a single eligible film
    still crowns it: the slot stays winnable, which is the whole point.
    """
    in_genre = films["genres"].apply(lambda gs: genre in list(gs) if gs is not None else False)
    pool = films.loc[in_genre, ["film_id", "year", "imdb_rating", "imdb_votes"]].copy()
    if pool.empty:
        return pd.DataFrame(columns=["film_id", "year", "crown_score", "crown_rank", "nominated", "won"])

    # Score inside each year, never across years.
    pool["crown_score"] = pool.groupby("year", group_keys=False).apply(
        lambda g: weighted_rating(g["imdb_rating"], g["imdb_votes"]), include_groups=False
    )

    # Rank descending; unscored films sort last and can never be crowned.
    pool["crown_rank"] = (
        pool.groupby("year")["crown_score"].rank(method="first", ascending=False).astype("Int32")
    )
    pool["won"] = pool["crown_rank"].eq(1) & pool["crown_score"].notna()
    pool["nominated"] = pool["crown_rank"].le(1 + n_nominees) & pool["crown_score"].notna()
    return pool[["film_id", "year", "crown_score", "crown_rank", "nominated", "won"]]
