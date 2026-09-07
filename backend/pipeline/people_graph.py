"""
The people layer: actor profiles and the co-star graph (``pipeline.people_graph``).

Usage (from ``backend/``)::

    python -m pipeline.people_graph

Architecture note
-----------------
The Oscars mode only ever needs one contender at a time, so the seed until now
described *performances*. The two side modes need the people themselves:

* **Recast** asks who else could have played this part, which needs a profile
  per actor (what kind of roles they take, how big they are, when they worked)
  so that similar actors can be found.
* **Co-star Grid** asks which film two actors share, which needs the graph of
  who appeared with whom, and every film each pair has in common.

Both are derived from ``contenders.parquet``, which already holds one row per
credited performance with its billing and character, so nothing new is
downloaded. Two tables come out:

    actors.parquet    one row per actor: reach, era, role mix, genre mix
    costars.parquet   one row per co-starring pair, with their shared films

Scope
-----
Only actors with at least :data:`MIN_FILMS` credits in the catalog are kept.
Below that a "profile" is noise - one supporting part says nothing about the
kind of actor someone is - and a co-star graph built on one-film actors is
mostly coincidence. The threshold is what turns a sparse, mostly-useless graph
into one where a playable grid can be found.
"""

from __future__ import annotations

import sys
from itertools import combinations

import numpy as np
import pandas as pd

from pipeline.paths import SEED_DIR, ensure_dirs

# Credits an actor needs in the catalog before they get a profile. Five is
# where a role mix starts to mean something rather than describing one job.
MIN_FILMS = 5

# Billing at or above which a credit counts as a lead. IMDb orders principals
# by prominence, so the top two are the parts a poster is sold on.
LEAD_BILLING = 2

# Genres kept per actor profile.
N_TOP_GENRES = 3

ACTING_CATEGORIES = ("actor", "actress", "supporting_actor", "supporting_actress")


def build_actors(cast: pd.DataFrame, films: pd.DataFrame) -> pd.DataFrame:
    """
    One row per actor: how much reach they have, when they worked, what they play.

    ``fame`` is the log of their films' total vote count. Log because reach is
    multiplicative - the gap between a 5k-vote actor and a 50k-vote one matters
    far more than the gap between 2M and 2.05M - and because the recast pool
    compares actors on it directly.
    """
    joined = cast.merge(
        films[["film_id", "year", "imdb_rating", "imdb_votes", "genres"]], on="film_id", how="left"
    )
    joined["votes"] = pd.to_numeric(joined["imdb_votes"], errors="coerce").fillna(0.0)

    grouped = joined.groupby("person_id")
    profile = grouped.agg(
        name=("person_name", "first"),
        n_films=("film_id", "nunique"),
        total_votes=("votes", "sum"),
        mean_rating=("imdb_rating", "mean"),
        first_year=("year", "min"),
        last_year=("year", "max"),
        median_year=("year", "median"),
        mean_billing=("billing", "mean"),
    )
    profile["fame"] = np.log1p(profile["total_votes"])
    # Share of credits that are leading parts - the single most useful thing to
    # know when deciding whether someone could take over a lead role.
    profile["lead_share"] = (
        joined.assign(is_lead=joined["billing"].le(LEAD_BILLING)).groupby("person_id")["is_lead"].mean()
    )
    profile["career_span"] = profile["last_year"] - profile["first_year"]

    # Genre mix: the tags their films carry most often.
    exploded = joined.explode("genres").dropna(subset=["genres"])
    counts = exploded.groupby(["person_id", "genres"]).size().rename("n").reset_index()
    counts = counts.sort_values(["person_id", "n"], ascending=[True, False])
    top = counts.groupby("person_id").head(N_TOP_GENRES).groupby("person_id")["genres"].apply(list)
    profile["top_genres"] = profile.index.map(top).map(lambda g: g if isinstance(g, list) else [])

    profile = profile[profile["n_films"] >= MIN_FILMS].reset_index()
    return profile.sort_values("fame", ascending=False).reset_index(drop=True)


def build_costars(cast: pd.DataFrame, films: pd.DataFrame, actors: pd.DataFrame) -> pd.DataFrame:
    """
    One row per co-starring pair, carrying every film they share, best first.

    Pairs are keyed with the lexicographically smaller id first so a lookup
    never has to try both orders. ``film_ids`` is ordered by notability, which
    is what the grid scores a guess against and what it reveals as the best
    answer.
    """
    keep = set(actors["person_id"])
    working = cast[cast["person_id"].isin(keep)][["person_id", "film_id"]].drop_duplicates()

    notability = _notability(films)
    pairs: dict[tuple[str, str], list[str]] = {}
    for film_id, group in working.groupby("film_id"):
        people = sorted(group["person_id"].unique())
        # A single film with a huge credited cast would contribute O(n^2)
        # pairs of people who barely share a scene; the billing cut upstream
        # already caps this at ten, so the cost stays linear in practice.
        for left, right in combinations(people, 2):
            pairs.setdefault((left, right), []).append(film_id)

    rows = []
    for (left, right), film_ids in pairs.items():
        ordered = sorted(film_ids, key=lambda f: -notability.get(f, 0.0))
        rows.append(
            {
                "actor_a": left,
                "actor_b": right,
                "n_films": len(ordered),
                "film_ids": ordered,
                "best_film_id": ordered[0],
                "best_notability": float(notability.get(ordered[0], 0.0)),
            }
        )
    return pd.DataFrame(rows).sort_values("best_notability", ascending=False).reset_index(drop=True)


def _notability(films: pd.DataFrame) -> dict[str, float]:
    """
    How well known a film is, on a 0-100 scale.

    Votes carry the weight and rating breaks ties: for "which film do these two
    share", the one people have actually seen is the better answer, but between
    two equally-seen films the better one should win.
    """
    votes = np.log1p(pd.to_numeric(films["imdb_votes"], errors="coerce").fillna(0.0))
    rating = pd.to_numeric(films["imdb_rating"], errors="coerce").fillna(0.0)
    span = votes.max() - votes.min()
    scaled = (votes - votes.min()) / span * 100 if span else votes * 0
    return dict(zip(films["film_id"], (0.85 * scaled + 1.5 * rating).astype(float), strict=True))


def build() -> None:
    ensure_dirs()
    contenders = pd.read_parquet(SEED_DIR / "contenders.parquet")
    films = pd.read_parquet(SEED_DIR / "films.parquet")

    cast = (
        contenders[contenders["category"].isin(ACTING_CATEGORIES)]
        .dropna(subset=["person_id"])[["person_id", "person_name", "film_id", "billing", "character"]]
        .drop_duplicates(subset=["person_id", "film_id"])
    )
    print(f"credited performances: {len(cast):,} across {cast['person_id'].nunique():,} people")

    actors = build_actors(cast, films)
    print(f"actors with >= {MIN_FILMS} credits: {len(actors):,}")

    costars = build_costars(cast, films, actors)
    print(f"co-star pairs: {len(costars):,} ({int((costars['n_films'] >= 2).sum()):,} share 2+ films)")

    actors.to_parquet(SEED_DIR / "actors.parquet", index=False)
    costars.to_parquet(SEED_DIR / "costars.parquet", index=False)

    print("\nmost-connected actors:")
    degree = pd.concat([costars["actor_a"], costars["actor_b"]]).value_counts()
    names = dict(zip(actors["person_id"], actors["name"], strict=True))
    for person_id, n in degree.head(5).items():
        print(f"  {names.get(person_id, person_id):24s} {n} co-stars")


def main(argv: list[str] | None = None) -> int:
    build()
    return 0


if __name__ == "__main__":
    sys.exit(main())
