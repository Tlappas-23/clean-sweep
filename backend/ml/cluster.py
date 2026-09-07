"""
Cluster the film pool into named archetypes.

Usage (from ``backend/``)::

    python -m ml.cluster

Architecture note
-----------------
The archetype is a *film-level* label ("Prestige Drama", "Blockbuster", ...)
shown on contender cards as a hint and plotted on the analytics page. It is
learnt without any award information: the inputs are IMDb rating, vote
count, runtime, genre indicators and - once enrichment has run - box office
and critic scores. That independence is the point: the label describes what
kind of film something is, not how the Academy received it, so it never
leaks the answer the player is trying to guess.

Why release year is excluded
----------------------------
Year is by far the strongest single axis in the pool, and including it makes
KMeans rediscover the calendar: the clusters come back as "1940s films",
"1960s films", "2000s films" with silhouette 0.172. That is a worse label
*and* a redundant one, because the year is already printed on every
contender card. Dropping it raises the silhouette to 0.188 and turns the
clusters into what the hint is actually for - long, acclaimed, widely seen
films versus small older pictures versus high-reach/low-rating spectacle.
Mean year is still reported in each archetype's centroid, so the era
information is available without being the thing that defines the groups.

Why the genre block is down-weighted
-----------------------------------
After standardisation every column has unit variance, so the fifteen 0/1
genre indicators together carry several times the variance of the three
continuous descriptors (rating, votes, runtime). Left alone, KMeans
simply partitions by genre ("war films", "horror films", ...) and dumps half
the pool into one shapeless cluster - true, but useless as a hint. The genre
columns are therefore multiplied by ``1/sqrt(n_genres)`` after scaling so the
*block* contributes as much total variance as one continuous feature. The
result clusters on reputation, reach and scale, with genre as a tie-breaker.

Why KMeans + silhouette
-----------------------
The pool is ~4.5k films with a dozen standardised numeric features; KMeans
is fast, deterministic with a fixed seed, and its centroids are directly
interpretable, which is what the naming step needs. ``k`` is chosen by the
silhouette score over 4..8 - the game wants a handful of memorable labels,
not a taxonomy, so the search range is intentionally narrow and the table is
printed for the record. The 2-D PCA projection is for visualisation only.

Why rule-based names
--------------------
Cluster ids are arbitrary; the game needs stable, readable names. Rather
than hand-label ids (which silently break when the seed is rebuilt and the
ids permute), a small ordered rule table inspects each *standardised*
centroid - "rating well above average but votes well below" reads as a Cult
Favourite, and so on. Rules fire in priority order, a name is never used
twice, and anything unmatched falls back to "Archetype N". Which rule fired
for each cluster is printed so the mapping is auditable.

Outputs
-------
``data/models/archetypes.joblib``     imputer + scaler + kmeans, pca, names
``data/models/cluster_summary.json``  ClusterSummary (docs/API.md)
``data/seed/ml_scores.parquet``       ``archetype`` and ``cluster_id`` columns
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml import RANDOM_STATE
from ml.features import build_film_features, genre_columns, load_seed, top_genres
from ml.paths import ARCHETYPES_MODEL_PATH, CLUSTER_SUMMARY_PATH, ensure_dirs
from ml.scores import update_scores

K_RANGE = range(4, 9)  # 4..8 inclusive
N_EXAMPLES = 5
N_POINTS = 1500  # size of the scatter-plot sample shipped to the frontend

# Features present in the film matrix but deliberately kept out of the
# clustering (see "Why release year is excluded" above). They are still
# reported in the centroid summaries.
EXCLUDED_FEATURES: tuple[str, ...] = ("year",)

# Threshold (in standard deviations) above which a centroid coordinate
# counts as "high", below the negative as "low".
HI = 0.35
LO = -0.35


# ------------------------------------------------------------- naming rules
def _g(z: pd.Series, genre: str) -> float:
    """Standardised centroid value for a genre indicator, 0 if the genre is absent."""
    return float(z.get(f"genre_{genre}", 0.0))


def _any_high(z: pd.Series, *genres: str, thr: float = HI) -> bool:
    return any(_g(z, g) > thr for g in genres)


# Ordered (name, predicate) table evaluated on a standardised centroid.
# Earlier rules are more specific; later ones are broad fallbacks.
# Note: no rule reads ``year`` - it is not a clustering dimension, so a
# centroid has no meaningful position along it (see EXCLUDED_FEATURES).
NAMING_RULES: list[tuple[str, Callable[[pd.Series], bool]]] = [
    ("Modern Classic", lambda z: z["imdb_rating"] > 0.6 and z["log_votes"] > 0.6),
    ("War Epic", lambda z: _g(z, "War") > 1.0 and z["runtime_minutes"] > 0),
    ("Prestige Biopic", lambda z: _g(z, "Biography") > 1.0 and z["imdb_rating"] > 0),
    (
        "Prestige Drama",
        lambda z: z["runtime_minutes"] > HI and z["imdb_rating"] > 0.2 and _g(z, "Drama") > 0.2,
    ),
    ("Cult Favourite", lambda z: z["imdb_rating"] > HI and z["log_votes"] < LO),
    ("Blockbuster", lambda z: z["log_votes"] > HI and _any_high(z, "Action", "Adventure", "Sci-Fi")),
    ("Crowd-Pleaser", lambda z: z["log_votes"] > HI and abs(z["imdb_rating"]) <= HI),
    ("Family Favourite", lambda z: _any_high(z, "Family", "Animation")),
    ("Genre Picture", lambda z: _any_high(z, "Horror", "Thriller", "Sci-Fi", "Mystery")),
    ("Popcorn Comedy", lambda z: _g(z, "Comedy") > HI),
    ("Romantic Melodrama", lambda z: _g(z, "Romance") > HI),
    ("Crime Noir", lambda z: _any_high(z, "Crime", "Film-Noir")),
    ("Historical Epic", lambda z: _any_high(z, "War", "History", "Biography") and z["runtime_minutes"] > 0),
    ("Critical Darling", lambda z: z["imdb_rating"] > HI),
    ("Guilty Pleasure", lambda z: z["imdb_rating"] < -0.6 and z["log_votes"] > 0),
    ("Studio Programmer", lambda z: z["imdb_rating"] < LO and z["log_votes"] < LO),
    ("Character Drama", lambda z: _g(z, "Drama") > 0),
]


def name_clusters(standardised_centroids: pd.DataFrame) -> tuple[list[str], list[str]]:
    """
    Map each cluster's standardised centroid to a unique, readable name.

    Returns ``(names, fired_rules)`` aligned with the centroid rows. A rule
    whose name has already been claimed by an earlier cluster is skipped so
    names are always unique; clusters that match nothing become
    ``"Archetype <id>"``.
    """
    names: list[str] = []
    fired: list[str] = []
    taken: set[str] = set()
    for cid, z in standardised_centroids.iterrows():
        chosen, rule = f"Archetype {cid}", "fallback"
        for name, predicate in NAMING_RULES:
            if name in taken:
                continue
            if predicate(z):
                chosen, rule = name, name
                break
        taken.add(chosen)
        names.append(chosen)
        fired.append(rule)
    return names, fired


# -------------------------------------------------------------------- model
class BlockScaler(BaseEstimator, TransformerMixin):
    """Multiply a named block of columns by a constant (see module docstring)."""

    def __init__(self, columns: list[str], factor: float) -> None:
        self.columns = columns
        self.factor = factor

    def fit(self, X: pd.DataFrame, y=None) -> BlockScaler:
        self.feature_names_in_ = np.asarray(X.columns, dtype=object)
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        out = X.copy()
        present = [c for c in self.columns if c in out.columns]
        out[present] = out[present] * self.factor
        return out

    def get_feature_names_out(self, input_features=None) -> np.ndarray:
        names = input_features if input_features is not None else self.feature_names_in_
        return np.asarray(names, dtype=object)


def make_preprocessor(genre_cols: list[str]) -> Pipeline:
    """
    Median imputation -> standardisation -> genre block scaling.

    KMeans needs a complete matrix, so partially-null enrichment columns are
    median-imputed (a neutral value for a distance model). Standardising is
    essential: runtime is measured in minutes, log votes in nats and genres
    in {0, 1}; without it runtime would dominate every distance. The final
    step rebalances the genre block (module docstring).
    """
    weight = 1.0 / np.sqrt(len(genre_cols)) if genre_cols else 1.0
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median").set_output(transform="pandas")),
            ("scale", StandardScaler().set_output(transform="pandas")),
            ("genre_block", BlockScaler(genre_cols, weight)),
        ]
    )


def make_pipeline(k: int, genre_cols: list[str]) -> Pipeline:
    """Preprocessor + KMeans, as one persisted object."""
    return Pipeline(
        [
            ("prep", make_preprocessor(genre_cols)),
            ("kmeans", KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE)),
        ]
    )


def choose_k(X_scaled: np.ndarray) -> tuple[int, dict[int, float]]:
    """Silhouette over ``K_RANGE``; higher is better. Prints the table."""
    scores: dict[int, float] = {}
    print("  k  silhouette")
    for k in K_RANGE:
        labels = KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE).fit_predict(X_scaled)
        scores[k] = float(silhouette_score(X_scaled, labels, random_state=RANDOM_STATE))
        print(f"  {k}  {scores[k]:.4f}")
    best = max(scores, key=scores.__getitem__)
    print(f"  -> k = {best}")
    return best, scores


def stratified_points(
    films: pd.DataFrame, coords: np.ndarray, labels: np.ndarray, names: list[str], n: int
) -> list[dict]:
    """A seeded, per-cluster proportional sample of films for the scatter plot."""
    frame = films[["film_id", "title", "year"]].copy()
    frame["x"], frame["y"], frame["cluster"] = coords[:, 0], coords[:, 1], labels
    frac = min(1.0, n / len(frame))
    sample = (
        frame.groupby("cluster", group_keys=False)
        .apply(lambda g: g.sample(frac=frac, random_state=RANDOM_STATE), include_groups=False)
        .sort_index()
    )
    sample["cluster"] = frame.loc[sample.index, "cluster"]
    # Per-group rounding can overshoot by a handful of rows; trim to the cap.
    sample = sample.sample(n=min(n, len(sample)), random_state=RANDOM_STATE).sort_index()
    return [
        {
            "film_id": r.film_id,
            "title": r.title,
            "year": int(r.year),
            "x": round(float(r.x), 4),
            "y": round(float(r.y), 4),
            "archetype": names[int(r.cluster)],
        }
        for r in sample.itertuples(index=False)
    ]


# --------------------------------------------------------------------- main
def main() -> None:
    ensure_dirs()
    t0 = time.time()
    contenders, films = load_seed()
    genres = top_genres(films)
    X = build_film_features(films, genres)
    # Columns with no data at all (enrichment not run yet) carry no
    # information for a distance model and would only pad the centroids with
    # zeros, so they are left out of *this* run; they join automatically once
    # the enrichment step fills them.
    populated = [c for c in X.columns if X[c].notna().any()]
    dropped = sorted(set(X.columns) - set(populated))
    # ``X_full`` keeps every populated column for the centroid report; the
    # model itself is fitted on ``features``, which omits EXCLUDED_FEATURES.
    X_full = X[populated]
    features = [c for c in populated if c not in EXCLUDED_FEATURES]
    X = X_full[features]
    print(
        f"films: {len(X):,}  features: {len(features)}  "
        f"skipped (all null): {dropped}  excluded: {list(EXCLUDED_FEATURES)}"
    )

    # Choose k on the preprocessed matrix, then fit the final pipeline on it.
    genre_cols = [c for c in genre_columns(genres) if c in features]
    prep = make_preprocessor(genre_cols)
    X_scaled = prep.fit_transform(X).to_numpy()
    k, silhouettes = choose_k(X_scaled)
    pipe = make_pipeline(k, genre_cols).fit(X)
    labels = pipe.predict(X)
    kmeans: KMeans = pipe.named_steps["kmeans"]

    # Names from the standardised centroids. The genre block is divided by
    # its weight again so every coordinate reads as a plain z-score.
    z_centroids = pd.DataFrame(kmeans.cluster_centers_, columns=features)
    genre_weight = pipe.named_steps["prep"].named_steps["genre_block"].factor
    z_centroids[genre_cols] = z_centroids[genre_cols] / genre_weight
    names, fired = name_clusters(z_centroids)
    sizes = np.bincount(labels, minlength=k)
    print("  id  size  rule fired          name")
    for cid in range(k):
        print(f"  {cid:>2}  {sizes[cid]:>4}  {fired[cid]:<19} {names[cid]}")

    # PCA for the analytics scatter (fit on the same standardised matrix).
    pca = PCA(n_components=2, random_state=RANDOM_STATE).fit(X_scaled)
    coords = pca.transform(X_scaled)
    print(f"  PCA explained variance: {pca.explained_variance_ratio_.round(3).tolist()}")

    # Un-standardised centroids = plain means of the raw features per cluster
    # (readable numbers: "avg rating 7.9, avg runtime 128 min").
    raw_means = X_full.groupby(labels).mean()
    votes = pd.to_numeric(films["imdb_votes"], errors="coerce")
    archetypes = []
    for cid in range(k):
        members = films.index[labels == cid]
        examples = films.loc[members].assign(_v=votes.loc[members]).nlargest(N_EXAMPLES, "_v")["title"]
        centroid = {f: round(float(v), 4) for f, v in raw_means.loc[cid].items() if np.isfinite(v)}
        archetypes.append(
            {
                "label": names[cid],
                "size": int(sizes[cid]),
                "centroid": centroid,
                "examples": examples.tolist(),
            }
        )

    summary = {
        "archetypes": archetypes,
        "points": stratified_points(films, coords, labels, names, N_POINTS),
        "features": features,
        # Reported in every centroid for context but *not* clustered on, so a
        # reader can see each archetype's era without it having shaped the
        # groups (see "Why release year is excluded").
        "excluded_features": list(EXCLUDED_FEATURES),
        "k": int(k),
        "silhouette": {str(kk): round(v, 4) for kk, v in silhouettes.items()},
        "pca_explained_variance": [round(float(v), 4) for v in pca.explained_variance_ratio_],
    }
    CLUSTER_SUMMARY_PATH.write_text(json.dumps(summary, indent=2) + "\n")
    joblib.dump(
        {
            "pipeline": pipe,
            "pca": pca,
            "features": features,
            "genres": genres,
            "genre_weight": float(pipe.named_steps["prep"].named_steps["genre_block"].factor),
            "names": names,
            "k": int(k),
            "silhouette": silhouettes[k],
            "random_state": RANDOM_STATE,
        },
        ARCHETYPES_MODEL_PATH,
    )

    # Film-level labels -> every contender of that film.
    film_labels = pd.DataFrame(
        {
            "film_id": films["film_id"],
            "cluster_id": labels.astype("int32"),
            "archetype": [names[i] for i in labels],
        }
    )
    per_contender = contenders[["contender_id", "film_id"]].merge(film_labels, on="film_id", how="left")
    assert per_contender["cluster_id"].notna().all(), "every contender's film must be clustered"
    update_scores(
        per_contender["contender_id"],
        per_contender.set_index("contender_id")[["archetype", "cluster_id"]],
    )
    print(
        f"wrote {ARCHETYPES_MODEL_PATH.name}, {CLUSTER_SUMMARY_PATH.name}, "
        f"ml_scores.parquet in {time.time() - t0:.1f}s"
    )


if __name__ == "__main__":
    main()
