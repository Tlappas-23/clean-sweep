"""
Shared feature engineering for the ranker and the clustering model.

Architecture note
-----------------
Both models consume the same seed tables (``contenders.parquet`` and
``films.parquet``) and both need the same derived columns (log vote counts,
genre indicators, decade). Keeping that logic in one module guarantees the
ranker and the clusterer agree on what a "feature" is, and it gives the
leakage rules a single home that can be unit-tested.

Two frames are produced:

* :func:`build_contender_features` - one row per contender (the ranker's
  training set). Film attributes are joined in via ``film_id``.
* :func:`build_film_features` - one row per film (the clusterer's input).

Leakage guards
--------------
The ranker's label is the Oscar outcome, so nothing that encodes the outcome
of the *same* row may enter the feature matrix. Concretely:

* ``contenders.nominated`` / ``contenders.won`` are the labels - excluded.
* ``films.nominations`` / ``films.wins`` are film-level totals of Oscar
  nominations and wins. A Best Picture nominee trivially has
  ``nominations >= 1``, so these are label leakage in disguise - excluded.
* ``prior_nominations`` / ``prior_wins`` are computed by the pipeline as the
  person's nominations *before this film year* (``x.year < f.year`` in
  ``pipeline/build_seed.py``). They describe career momentum that was known
  before the ceremony, which is exactly the kind of signal a pundit would
  use, so they are allowed.
* ``acclaim`` / ``popularity`` / ``box_office`` are percentiles of IMDb
  rating, vote count and revenue within the (year, category) pool. They are
  derived from audience data, not from Oscar data, so they are allowed.
  (They do carry a subtle hindsight effect - today's vote counts reflect
  decades of reputation - but that applies equally to every row and is not
  the label.)

:func:`assert_no_leakage` is called by every consumer so an accidental
addition of an outcome column fails loudly rather than producing a model
that looks impressively accurate.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

from ml.paths import CONTENDERS_PATH, FILMS_PATH

# Number of genre indicator columns. IMDb films carry up to three genres; the
# top 15 by frequency cover more than 95% of genre mentions in the pool, and
# rarer tags (Documentary, Sport, ...) would only add near-constant columns.
N_TOP_GENRES = 15

# Columns that must never enter a feature matrix (see module docstring).
OUTCOME_COLUMNS: frozenset[str] = frozenset({"nominated", "won", "nominations", "wins"})

# Enrichment columns that are nullable until ``pipeline.enrich`` has run.
# They are carried through as NaN so that re-training after enrichment is a
# no-op code-wise: HistGradientBoosting handles NaN natively and the
# clusterer imputes them.
ENRICHMENT_COLUMNS: tuple[str, ...] = ("rt_critic", "metascore")

# Numeric contender-level features consumed by the ranker.
CONTENDER_NUMERIC: tuple[str, ...] = (
    "imdb_rating",
    "log_votes",
    "acclaim",
    "popularity",
    "box_office",  # percentile of revenue within pool; NaN until enrichment
    "runtime_minutes",
    "year",
    "decade",
    "billing",  # NaN for Best Picture / Director rows
    "prior_nominations",
    "prior_wins",
    *ENRICHMENT_COLUMNS,
)
# The single categorical feature (six ballot categories).
CONTENDER_CATEGORICAL: tuple[str, ...] = ("category",)

# Numeric film-level features consumed by the clusterer.
FILM_NUMERIC: tuple[str, ...] = (
    "imdb_rating",
    "log_votes",
    "runtime_minutes",
    "year",
    "log_box_office",  # log1p(box_office_usd); NaN until enrichment
    *ENRICHMENT_COLUMNS,
)


# --------------------------------------------------------------------------- io
def load_seed() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Read ``contenders.parquet`` and ``films.parquet``."""
    return pd.read_parquet(CONTENDERS_PATH), pd.read_parquet(FILMS_PATH)


# ------------------------------------------------------------------- helpers
def _to_float(s: pd.Series) -> pd.Series:
    """
    Coerce a possibly-nullable / object column to float64 with NaN for nulls.

    Parquet round-trips nullable ints as ``Int64`` and all-null enrichment
    columns as ``object``; scikit-learn wants plain float64 either way.
    """
    return pd.to_numeric(s, errors="coerce").astype("float64")


def _genre_lists(genres: pd.Series) -> list[list[str]]:
    """Normalise the ``genres`` list column (numpy arrays / None) to Python lists."""
    return [list(g) if g is not None and len(g) else [] for g in genres]


def top_genres(films: pd.DataFrame, n: int = N_TOP_GENRES) -> list[str]:
    """
    The ``n`` most frequent genre tags in the film pool, most frequent first.

    The list is stored inside the model artifacts so that scoring after an
    enrichment run uses exactly the columns the model was trained on.
    """
    counts = pd.Series([g for gs in _genre_lists(films["genres"]) for g in gs]).value_counts()
    return counts.head(n).index.tolist()


def genre_one_hots(genres: pd.Series, genre_list: Iterable[str]) -> pd.DataFrame:
    """Return a 0/1 float frame with one ``genre_<Name>`` column per genre."""
    lists = _genre_lists(genres)
    cols = {f"genre_{g}": [float(g in gs) for gs in lists] for g in genre_list}
    return pd.DataFrame(cols, index=genres.index)


def genre_columns(genre_list: Iterable[str]) -> list[str]:
    """Column names produced by :func:`genre_one_hots` for ``genre_list``."""
    return [f"genre_{g}" for g in genre_list]


def assert_no_leakage(columns: Iterable[str]) -> None:
    """Raise if any outcome column made it into a feature list."""
    leaked = OUTCOME_COLUMNS.intersection(columns)
    if leaked:
        raise ValueError(f"outcome columns must not be used as features: {sorted(leaked)}")


class NullColumnGuard(BaseEstimator, TransformerMixin):
    """
    Make entirely-null feature columns harmless inside a scikit-learn pipeline.

    Before enrichment, ``box_office`` / ``rt_critic`` / ``metascore`` are 100%
    NaN. HistGradientBoosting handles *some* NaN per column but its binner
    fails when a column has no finite value at all. Dropping the columns would
    change the model's signature between "before" and "after" enrichment;
    instead this step remembers which columns were all-null at fit time and
    fills them with a constant, which a tree model simply never splits on.
    Columns that gain values after enrichment are passed through untouched
    on the next training run.
    """

    def __init__(self, fill_value: float = 0.0) -> None:
        self.fill_value = fill_value

    def fit(self, X: pd.DataFrame, y=None) -> NullColumnGuard:
        self.null_columns_ = [c for c in X.columns if X[c].isna().all()]
        self.feature_names_in_ = np.asarray(X.columns, dtype=object)
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        if not self.null_columns_:
            return X
        out = X.copy()
        out[self.null_columns_] = out[self.null_columns_].fillna(self.fill_value)
        return out

    def get_feature_names_out(self, input_features=None) -> np.ndarray:
        names = input_features if input_features is not None else self.feature_names_in_
        return np.asarray(names, dtype=object)


# ------------------------------------------------------------- film features
def build_film_features(films: pd.DataFrame, genre_list: list[str] | None = None) -> pd.DataFrame:
    """
    One row per film, indexed like ``films``; columns = ``FILM_NUMERIC`` + genre one-hots.

    Nullable enrichment columns are kept as NaN; the caller decides whether to
    impute or drop (the clusterer drops columns that are entirely null and
    median-imputes the rest).
    """
    genre_list = genre_list if genre_list is not None else top_genres(films)
    out = pd.DataFrame(index=films.index)
    out["imdb_rating"] = _to_float(films["imdb_rating"])
    # Vote counts span five orders of magnitude; log1p keeps the scale sane
    # for both the tree model (bin edges) and KMeans (Euclidean distance).
    out["log_votes"] = np.log1p(_to_float(films["imdb_votes"]))
    out["runtime_minutes"] = _to_float(films["runtime_minutes"])
    out["year"] = _to_float(films["year"])
    out["log_box_office"] = np.log1p(_to_float(films["box_office_usd"]))
    for col in ENRICHMENT_COLUMNS:
        out[col] = _to_float(films[col]) if col in films else np.nan
    out = pd.concat([out, genre_one_hots(films["genres"], genre_list)], axis=1)
    assert_no_leakage(out.columns)
    return out


# -------------------------------------------------------- contender features
def build_contender_features(
    contenders: pd.DataFrame,
    films: pd.DataFrame,
    genre_list: list[str] | None = None,
) -> pd.DataFrame:
    """
    The ranker's design matrix: one row per contender, aligned with ``contenders``.

    Returns only feature columns (``CONTENDER_NUMERIC`` + ``category`` +
    genre one-hots). Identifier and label columns stay on the caller's
    ``contenders`` frame so they can never be picked up by accident.
    """
    genre_list = genre_list if genre_list is not None else top_genres(films)

    # Film attributes needed for contender rows. ``nominations`` / ``wins``
    # are deliberately not selected here (see the leakage notes above).
    film_cols = ["film_id", "imdb_rating", "imdb_votes", "runtime_minutes", "genres", *ENRICHMENT_COLUMNS]
    film_cols = [c for c in film_cols if c in films.columns]
    joined = contenders[["film_id"]].merge(films[film_cols], on="film_id", how="left", validate="m:1")
    joined.index = contenders.index

    out = pd.DataFrame(index=contenders.index)
    out["imdb_rating"] = _to_float(joined["imdb_rating"])
    out["log_votes"] = np.log1p(_to_float(joined["imdb_votes"]))
    out["acclaim"] = _to_float(contenders["acclaim"])
    out["popularity"] = _to_float(contenders["popularity"])
    out["box_office"] = _to_float(contenders["box_office"])
    out["runtime_minutes"] = _to_float(joined["runtime_minutes"])
    out["year"] = _to_float(contenders["year"])
    # Decade as a coarse era indicator: the Academy's taste drifts (silent
    # era melodrama, 1950s epics, 1970s New Hollywood, ...) and a ten-year bucket
    # lets the trees learn era effects with fewer splits than raw ``year``.
    out["decade"] = (out["year"] // 10) * 10
    out["billing"] = _to_float(contenders["billing"])
    out["prior_nominations"] = _to_float(contenders["prior_nominations"])
    out["prior_wins"] = _to_float(contenders["prior_wins"])
    for col in ENRICHMENT_COLUMNS:
        out[col] = _to_float(joined[col]) if col in joined else np.nan
    # Category is a genuine categorical (six unordered values). The ranker's
    # preprocessing ordinal-encodes it and tells the boosting model to treat
    # it as categorical, so no one-hot expansion is needed here.
    out["category"] = contenders["category"].astype("object")
    out = pd.concat([out, genre_one_hots(joined["genres"], genre_list)], axis=1)

    expected = [*CONTENDER_NUMERIC, *CONTENDER_CATEGORICAL, *genre_columns(genre_list)]
    out = out[expected]
    assert_no_leakage(out.columns)
    return out
