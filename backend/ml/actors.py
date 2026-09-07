"""
Clustering actors into casting types (``python -m ml.actors``).

Architecture note
-----------------
This is the third model in the project and the one the Recast mode is built
on. The film clusterer (``ml.cluster``) answers "what kind of film is this?";
this answers "what kind of actor is this?", which is the question a casting
director is really asking when they replace someone.

The recast pool for a role is drawn from the original actor's cluster. That is
the whole reason the model exists: offering every actor in the catalog as a
replacement would make the round a search box rather than a casting decision,
and offering a random sample would put a silent-era character player up for a
Marvel lead. Drawing from the cluster means the alternatives are people who
work the same way, so choosing between them is a judgement about fit.

Features (all from ``actors.parquet``, never from awards)
---------------------------------------------------------
``fame`` (log total votes), ``n_films``, ``mean_rating`` of their films,
``mean_billing``, ``lead_share``, ``median_year`` and ``career_span``, plus
genre indicators. Nothing here encodes an Oscar outcome, so an actor's
cluster cannot leak the answer to the Oscars mode.

``median_year`` is kept here, unlike in the film clusterer where it was
dropped for rediscovering the calendar. For actors era is not a nuisance
dimension, it is a casting fact: replacing a 1955 lead with someone who
started work in 2015 is not a recast, it is a different film. The era term is
down-weighted rather than removed so it shapes the clusters without
dominating them.
"""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml.paths import MODELS_DIR, SEED_DIR, ensure_dirs

try:  # joblib ships with scikit-learn
    import joblib
except ImportError:  # pragma: no cover
    joblib = None

RANDOM_STATE = 42
K_RANGE = range(4, 10)

# Genre columns kept for the casting profile.
N_TOP_GENRES = 12

# Era is a casting fact, not a nuisance dimension, but left at full weight it
# would split every type into "old" and "new" versions of itself. Half weight
# keeps it shaping the clusters without owning them.
ERA_WEIGHT = 0.5

NUMERIC_FEATURES = (
    "fame",
    "n_films",
    "mean_rating",
    "mean_billing",
    "lead_share",
    "career_span",
)
ERA_FEATURE = "median_year"

# Ordered (name, predicate) table read on standardised centroids, same idea as
# the film clusterer: cluster ids permute between runs, names must not.
HI, LO = 0.4, -0.4
NAMING_RULES: list[tuple[str, Callable[[pd.Series], bool]]] = [
    ("Marquee Lead", lambda z: z["fame"] > HI and z["lead_share"] > HI),
    ("Prestige Lead", lambda z: z["lead_share"] > HI and z["mean_rating"] > HI),
    ("Blockbuster Regular", lambda z: z["fame"] > HI and z["n_films"] > 0),
    ("Character Actor", lambda z: z["lead_share"] < LO and z["n_films"] > HI),
    ("Ensemble Player", lambda z: z["lead_share"] < LO),
    ("Golden Age Star", lambda z: z[ERA_FEATURE] < LO and z["lead_share"] > 0),
    ("Modern Lead", lambda z: z[ERA_FEATURE] > HI and z["lead_share"] > 0),
    ("Journeyman", lambda z: z["n_films"] > HI),
    ("Working Actor", lambda z: True),
]


def build_features(actors: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Numeric casting profile plus genre indicators, one row per actor."""
    frame = pd.DataFrame(index=actors.index)
    for column in NUMERIC_FEATURES:
        frame[column] = pd.to_numeric(actors[column], errors="coerce").astype("float64")
    frame[ERA_FEATURE] = pd.to_numeric(actors[ERA_FEATURE], errors="coerce").astype("float64")

    exploded = actors[["top_genres"]].explode("top_genres").dropna()
    top = exploded["top_genres"].value_counts().head(N_TOP_GENRES).index.tolist()
    for genre in top:
        frame[f"genre_{genre}"] = actors["top_genres"].apply(
            lambda gs, g=genre: float(g in list(gs) if gs is not None else False)
        )
    return frame.fillna(frame.median(numeric_only=True)), [f"genre_{g}" for g in top]


class BlockWeights:
    """Scale named column blocks after standardisation (era down, genre down)."""

    def __init__(self, weights: dict[str, float]):
        self.weights = weights

    def fit(self, X, y=None):  # noqa: D102 - sklearn protocol
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        out = X.copy()
        for column, weight in self.weights.items():
            if column in out.columns:
                out[column] = out[column] * weight
        return out

    def set_output(self, *, transform=None):  # noqa: D102 - sklearn protocol
        return self


def make_pipeline(k: int, genre_columns: list[str]) -> Pipeline:
    """Standardise, down-weight era and the genre block, then cluster."""
    # The genre block is many 0/1 columns; without down-weighting it would
    # outvote the six continuous casting features put together.
    weights = {ERA_FEATURE: ERA_WEIGHT}
    if genre_columns:
        share = 1.0 / np.sqrt(len(genre_columns))
        weights |= {c: share for c in genre_columns}
    return Pipeline(
        [
            ("scale", StandardScaler().set_output(transform="pandas")),
            ("weights", BlockWeights(weights)),
            ("kmeans", KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE)),
        ]
    )


def _composed_name(z: pd.Series, taken: set[str]) -> str:
    """
    Last-resort name built from the centroid's most extreme coordinate.

    A cluster that matches no rule is still a real group of actors, and
    shipping "Type 4" onto a casting card would be a visible dead end. The
    strongest signal in the centroid picks the name, so every casting type a
    player sees means something.
    """
    candidates: list[tuple[str, float]] = [
        ("Leading Player", float(z["lead_share"])),
        ("Supporting Regular", -float(z["lead_share"])),
        ("Prolific Veteran", float(z["n_films"])),
        ("Critics' Favourite", float(z["mean_rating"])),
        ("Household Name", float(z["fame"])),
        ("Golden Age Star", -float(z[ERA_FEATURE])),
        ("Modern Star", float(z[ERA_FEATURE])),
    ]
    for name, _ in sorted(candidates, key=lambda c: -c[1]):
        if name not in taken:
            return name
    return f"Type {len(taken) + 1}"  # pragma: no cover - names exhausted


def name_clusters(centroids: pd.DataFrame) -> list[str]:
    """Give every cluster a unique, readable casting-type name."""
    names: list[str] = []
    taken: set[str] = set()
    for _, z in centroids.iterrows():
        chosen = None
        for name, predicate in NAMING_RULES:
            if name in taken:
                continue
            if predicate(z):
                chosen = name
                break
        chosen = chosen or _composed_name(z, taken)
        taken.add(chosen)
        names.append(chosen)
    return names


def main(argv: list[str] | None = None) -> int:
    ensure_dirs()
    started = time.time()
    actors = pd.read_parquet(SEED_DIR / "actors.parquet")
    features, genre_columns = build_features(actors)
    print(f"actors: {len(actors):,}  features: {features.shape[1]}")

    scaled = make_pipeline(K_RANGE.start, genre_columns)[:-1].fit_transform(features).to_numpy()
    print("  k  silhouette")
    scores: dict[int, float] = {}
    for k in K_RANGE:
        labels = KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE).fit_predict(scaled)
        scores[k] = float(silhouette_score(scaled, labels, random_state=RANDOM_STATE))
        print(f"  {k}  {scores[k]:.4f}")
    best_k = max(scores, key=scores.__getitem__)
    print(f"  -> k = {best_k}")

    pipeline = make_pipeline(best_k, genre_columns).fit(features)
    labels = pipeline.predict(features)
    kmeans: KMeans = pipeline.named_steps["kmeans"]

    centroids = pd.DataFrame(kmeans.cluster_centers_, columns=features.columns)
    names = name_clusters(centroids)
    actors = actors.assign(cluster_id=labels.astype("int32"))
    actors["casting_type"] = [names[i] for i in labels]

    print("\n  id  size  name                  fame  lead%  films  median yr")
    for cid in range(best_k):
        block = actors[actors.cluster_id == cid]
        print(
            f"  {cid:>2}  {len(block):>4}  {names[cid]:<20}  "
            f"{block.fame.mean():5.1f}  {block.lead_share.mean():5.2f}  "
            f"{block.n_films.mean():5.1f}  {block.median_year.median():.0f}"
        )
        examples = block.nlargest(3, "fame")["name"].tolist()
        print(f"        e.g. {', '.join(examples)}")

    actors.to_parquet(SEED_DIR / "actors.parquet", index=False)
    summary = {
        "k": int(best_k),
        "silhouette": {str(k): round(v, 4) for k, v in scores.items()},
        "features": list(features.columns),
        "era_weight": ERA_WEIGHT,
        "types": [
            {
                "label": names[cid],
                "size": int((labels == cid).sum()),
                "mean_fame": round(float(actors[actors.cluster_id == cid].fame.mean()), 3),
                "mean_lead_share": round(float(actors[actors.cluster_id == cid].lead_share.mean()), 3),
                "median_year": int(actors[actors.cluster_id == cid].median_year.median()),
                "examples": actors[actors.cluster_id == cid].nlargest(5, "fame")["name"].tolist(),
            }
            for cid in range(best_k)
        ],
    }
    (MODELS_DIR / "casting_types.json").write_text(json.dumps(summary, indent=2))
    if joblib is not None:
        joblib.dump(
            {"pipeline": pipeline, "features": list(features.columns), "names": names},
            MODELS_DIR / "casting_types.joblib",
        )
    print(f"\nwrote casting_types.json in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
