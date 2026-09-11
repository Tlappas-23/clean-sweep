"""
Oscar pedigree and other pre-release signals the first feature pass missed.

The obvious way to use Academy data here is wrong. A film's own nominations are
announced in January and awarded in March of the following year, so for a film
released in June they arrive roughly nine months after it has finished playing.
They are in `leakage.BANNED` and they stay there.

What *is* known on release day is the record of the people attached. "From the
director of a Best Picture winner" is a line studios put on posters precisely
because it is public and precisely because it moves tickets. That is the
legitimate half of the idea and it is what this module builds.

Timing is handled explicitly rather than by year arithmetic. A nomination for
film year Y is announced at a ceremony in the first quarter of Y+1, so it is
treated as public from 1 March of Y+1 and counted only for films released after
that date. A film opening in February 2016 does not know about the ceremony
happening later that month.

People come from IMDb's `title.principals`, which carries the same `nconst`
identifiers as the Academy data, so director and cast join to nominations
directly with no id mapping and no API calls.
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

FEATURES = ROOT / "backend/boxoffice/data/features.parquet"
PRINCIPALS = ROOT / "data/raw/title.principals.tsv.gz"
NOMINATIONS = ROOT / "data/seed/nominations.parquet"
OUT = ROOT / "backend/boxoffice/data/pedigree.parquet"

# Roles whose Oscar record a marketing department would actually cite.
ROLES = ("director", "actor", "actress", "writer")


def build() -> pd.DataFrame:
    films = pd.read_parquet(FEATURES)[["imdb_id", "release_date"]].dropna()
    con = duckdb.connect()
    con.register("films", films)

    # One row per (film, person, role) for the films in our sample only.
    people = con.execute(f"""
        SELECT p.tconst AS imdb_id, p.nconst AS person_id, p.category AS role,
               p.ordering
        FROM read_csv('{PRINCIPALS}', delim='\t', header=true, quote='',
                      nullstr='\\N') p
        JOIN films f ON f.imdb_id = p.tconst
        WHERE p.category IN {ROLES}
    """).fetchdf()

    noms = pd.read_parquet(NOMINATIONS)[["year", "won", "person_id"]].dropna(subset=["person_id"])
    # A nomination for film year Y is public from the ceremony in Y+1. Using
    # 1 March is deliberately conservative: ceremonies land in February or
    # March, so nothing is credited before it could have been known.
    noms["public_from"] = pd.to_datetime((noms["year"] + 1).astype(int).astype(str) + "-03-01")
    noms["won"] = noms["won"].fillna(False).astype(bool)

    merged = people.merge(films, on="imdb_id").merge(noms, on="person_id", how="left")

    # Credit a nomination only if it was public before this film opened.
    known = merged["public_from"].notna() & (merged["public_from"] < merged["release_date"])
    merged["prior_nom"] = known.astype(int)
    merged["prior_win"] = (known & merged["won"]).astype(int)

    per_person = (
        merged.groupby(["imdb_id", "person_id", "role"])[["prior_nom", "prior_win"]].sum().reset_index()
    )

    def wide(role_filter, prefix: str) -> pd.DataFrame:
        block = per_person[per_person["role"].isin(role_filter)]
        g = block.groupby("imdb_id")
        return pd.DataFrame(
            {
                f"{prefix}_prior_oscar_noms": g["prior_nom"].sum(),
                f"{prefix}_prior_oscar_wins": g["prior_win"].sum(),
                f"{prefix}_best_prior_noms": g["prior_nom"].max(),
            }
        )

    out = (
        films.set_index("imdb_id")[[]]
        .join(wide(["director"], "director"))
        .join(wide(["actor", "actress"], "cast"))
        .join(wide(["writer"], "writer"))
    )
    out = out.fillna(0.0)

    # A single readable flag: is anyone attached an Academy Award winner?
    out["has_oscar_winner_attached"] = (
        (out["director_prior_oscar_wins"] + out["cast_prior_oscar_wins"] + out["writer_prior_oscar_wins"]) > 0
    ).astype(int)

    return out.reset_index()


if __name__ == "__main__":
    frame = build()
    frame.to_parquet(OUT, index=False)
    print(f"{len(frame)} films -> {OUT.name}")
    print(f"\nfilms with an Oscar winner attached: {frame.has_oscar_winner_attached.mean():.1%}")
    print(
        frame[["director_prior_oscar_noms", "cast_prior_oscar_noms", "writer_prior_oscar_noms"]]
        .describe()
        .loc[["mean", "50%", "max"]]
        .to_string()
    )
