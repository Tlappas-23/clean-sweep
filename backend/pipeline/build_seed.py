"""
Step 2 of the pipeline: build the seed tables from the raw downloads.

Usage (from ``backend/``)::

    python -m pipeline.build_seed [--top-n 40] [--min-year 1950] [--max-year 2025]
    python -m pipeline.build_seed --min-votes 25000   # trim obscure pool padding

Architecture note
-----------------
This is the only place that reads the 1.4 GB IMDb TSVs. DuckDB streams the
gzipped files directly (no unpacking), filters aggressively, and hands back
small pandas frames. The output is four parquet tables in ``data/seed``:

    films.parquet         one row per film that appears in any pool
    contenders.parquet    one row per (category, film[, person]) a player can pick
    nominations.parquet   normalised Oscar history for every category
    people.parquet        names for every person referenced above

Six of the eight ballot categories are real Academy Awards and take their
answer key straight from the nomination records. The last two - Best Horror
and Best Comedy - are categories the Academy never created, so their answer
key is *derived* here (see ``genre_crowns``) and written into the same
``nominated`` / ``won`` columns. Everything downstream therefore treats all
eight categories identically.

The heavy joins are expressed as SQL views so each stage can be inspected in
isolation; the percentile metrics are computed in pandas via
``pipeline.metrics`` so the enrichment step can reuse the same code.

See docs/DATA.md for the full column reference and pool rules.
"""

from __future__ import annotations

import argparse
import sys
import time

import duckdb
import pandas as pd

from pipeline.crowns import genre_crowns
from pipeline.metrics import add_percentile_metrics
from pipeline.paths import OSCARS_FILE, RAW_DIR, SEED_DIR, ensure_dirs

# Oscar categories that map onto ballot slots. Anything else is kept in
# ``nominations`` with ``category = NULL`` (useful for totals and features).
GAME_CATEGORIES: dict[str, str] = {
    "BEST PICTURE": "picture",
    "DIRECTING": "director",
    "ACTOR IN A LEADING ROLE": "actor",
    "ACTRESS IN A LEADING ROLE": "actress",
    "ACTOR IN A SUPPORTING ROLE": "supporting_actor",
    "ACTRESS IN A SUPPORTING ROLE": "supporting_actress",
}

# The two derived genre categories, and the IMDb genre tag each one draws on.
# The Academy has no award for either: Best Horror and Best Comedy are scored
# against a "genre crown" computed from the data (see ``genre_crowns``).
GENRE_CATEGORIES: dict[str, str] = {
    "horror": "Horror",
    "comedy": "Comedy",
}

# How many films per (year, genre) to guarantee in the pool. The main pool is
# the year's top 40 by vote count, which leaves horror thin - 11 years have no
# horror film at all in it and 25 have fewer than three. Pulling the top films
# of each genre separately makes both genre categories playable in every year.
GENRE_POOL_SIZE = 14

# How many films below the crown are treated as "nominees" of a genre category.
GENRE_NOMINEES = 4

# The catalog starts at 1950. The Academy's records go back to 1927, but the
# pools before then are padding rather than a game: 91% of the 1920s films the
# top-40 rule pulls in have under 10,000 IMDb votes, and 82% of the 1930s.
# Being handed five silent films nobody has heard of is not a round anyone can
# play, and the reels landing there was the single worst thing about the game.
# From 1950 the median pool film has ~70k votes instead of ~32k.
DEFAULT_MIN_YEAR = 1950
DEFAULT_MAX_YEAR = 2025

# Optional floor on IMDb votes for *non-nominee* pool films. The top-40 rule
# takes a fixed depth per year regardless of how many notable films that year
# actually had, so a thin year fills the rest of its pool with obscurities.
# A floor trims exactly that padding and nothing else: Oscar nominees and
# genre-crown contenders are always kept, whatever their vote count, because
# they are the answer key. 0 disables it.
DEFAULT_MIN_VOTES = 0

# Billing windows used to build acting pools from ``title.principals``.
# Lead pools take the top-billed cast; supporting pools skip the lead slot and
# reach deeper into the credits. Nominees are always added regardless.
LEAD_MAX_BILLING = 4
SUPPORTING_MIN_BILLING = 2
SUPPORTING_MAX_BILLING = 10


def _read_tsv(name: str, columns: str = "*") -> str:
    """SQL fragment that streams one IMDb TSV. ``\\N`` is IMDb's null marker."""
    path = RAW_DIR / name
    return (
        f"SELECT {columns} FROM read_csv('{path}', delim='\\t', header=true, "
        f"quote='', escape='', nullstr='\\\\N', all_varchar=true)"
    )


def _sql_case_categories() -> str:
    """CASE expression mapping CanonicalCategory -> game category."""
    whens = "\n".join(f"WHEN '{k}' THEN '{v}'" for k, v in GAME_CATEGORIES.items())
    return f"CASE CanonicalCategory {whens} ELSE NULL END"


def build(  # noqa: C901 (linear script)
    top_n: int, min_year: int, max_year: int, min_votes: int = DEFAULT_MIN_VOTES
) -> None:
    ensure_dirs()
    con = duckdb.connect()  # in-memory; nothing persists except the parquet output
    t0 = time.time()

    def step(msg: str) -> None:
        print(f"[{time.time() - t0:6.1f}s] {msg}", flush=True)

    # ------------------------------------------------------------------ Oscars
    # Explode multi-film (``FilmId = 'tt1|tt2'``) and multi-person nominations so
    # each row is one (category, film, person). ``Year`` like '1927/28' -> 1927.
    step("loading oscars.csv")
    con.execute(
        f"""
        CREATE TABLE oscars_raw AS
        SELECT * FROM read_csv('{RAW_DIR / OSCARS_FILE}', delim='\\t', header=true,
                               quote='', escape='', all_varchar=true, null_padding=true)
        """
    )
    con.execute(
        f"""
        CREATE TABLE nominations AS
        WITH base AS (
            SELECT
                CAST(Ceremony AS INTEGER)                    AS ceremony,
                CAST(substr(Year, 1, 4) AS INTEGER)          AS year,
                Class                                        AS class,
                CanonicalCategory                            AS category_raw,
                {_sql_case_categories()}                     AS category,
                string_split(FilmId, '|')                    AS film_ids,
                -- Best Picture nominees are producers; we keep them for prior-nomination
                -- counts but the *contender* for picture is the film itself.
                CASE WHEN NomineeIds IS NULL THEN [] ELSE string_split(NomineeIds, '|') END AS person_ids,
                Winner = 'True'                              AS won
            FROM oscars_raw
            WHERE FilmId IS NOT NULL
        ),
        films AS (
            SELECT ceremony, year, class, category_raw, category, won, person_ids,
                   unnest(film_ids) AS film_id
            FROM base
        )
        SELECT ceremony, year, class, category_raw, category, won, film_id,
               unnest(CASE WHEN len(person_ids) = 0 THEN [NULL] ELSE person_ids END) AS person_id
        FROM films
        """
    )
    n_nom = con.execute("SELECT count(*) FROM nominations").fetchone()[0]
    step(f"nominations: {n_nom:,} rows")

    # ------------------------------------------------------------------ IMDb
    step("loading title.basics + title.ratings (movies only)")
    con.execute(
        f"""
        CREATE TABLE movies AS
        SELECT b.tconst,
               b.primaryTitle                                  AS title,
               TRY_CAST(b.startYear AS INTEGER)                AS start_year,
               TRY_CAST(b.runtimeMinutes AS INTEGER)           AS runtime_minutes,
               b.genres                                        AS genres_csv,
               TRY_CAST(r.averageRating AS DOUBLE)             AS imdb_rating,
               TRY_CAST(r.numVotes AS BIGINT)                  AS imdb_votes
        FROM ({_read_tsv("title.basics.tsv.gz")}) b
        LEFT JOIN ({_read_tsv("title.ratings.tsv.gz")}) r USING (tconst)
        WHERE b.titleType = 'movie' AND b.isAdult = '0'
        """
    )

    # Films nominated in a game category carry the *Oscar* year (docs/DATA.md).
    con.execute(
        f"""
        CREATE TABLE nominee_films AS
        SELECT film_id AS tconst, min(year) AS year
        FROM nominations
        WHERE category IS NOT NULL AND year BETWEEN {min_year} AND {max_year}
        GROUP BY film_id
        """
    )

    # Pool = top-N by votes for each start year ∪ nominee films ∪ the top
    # films of each genre category. ``main_pool`` marks the first two groups:
    # those are the films the Picture / Director / acting rounds draft from.
    # Genre-only additions exist so Best Horror and Best Comedy have a real
    # pool in thin years, but they never widen the Oscar rounds.
    # One ranked window per genre tag, unioned: taking the top films *within*
    # each genre is the only way to guarantee a pool for a thin genre like
    # horror. A single window over "is any game genre" would be dominated by
    # comedy, which outnumbers horror three to one.
    genre_top_sql = "\n            UNION ALL\n            ".join(
        f"""SELECT tconst, year FROM (
                SELECT tconst, year,
                       row_number() OVER (PARTITION BY year ORDER BY rn) AS grn
                FROM ranked
                WHERE list_contains(string_split(genres_csv, ','), '{tag}')
            ) WHERE grn <= {GENRE_POOL_SIZE}"""
        for tag in GENRE_CATEGORIES.values()
    )
    floor_note = f", votes >= {min_votes:,}" if min_votes else ""
    step(f"selecting pool films (top {top_n}/year{floor_note} ∪ nominees ∪ top {GENRE_POOL_SIZE}/genre)")
    con.execute(
        f"""
        CREATE TABLE pool_films AS
        WITH ranked AS (
            SELECT tconst, start_year AS year, genres_csv, imdb_votes,
                   row_number() OVER (PARTITION BY start_year ORDER BY imdb_votes DESC NULLS LAST) AS rn
            FROM movies
            WHERE start_year BETWEEN {min_year} AND {max_year} AND imdb_votes IS NOT NULL
        ),
        top AS (
            SELECT tconst, year FROM ranked
            WHERE rn <= {top_n} AND imdb_votes >= {min_votes}
        ),
        genre_top AS ({genre_top_sql}),
        main AS (
            SELECT tconst, year, true AS main_pool FROM nominee_films
            UNION ALL
            SELECT t.tconst, t.year, true FROM top t
            WHERE t.tconst NOT IN (SELECT tconst FROM nominee_films)
        )
        SELECT tconst, year, true AS main_pool FROM main
        UNION ALL
        -- DISTINCT because a film tagged with both game genres (a horror
        -- comedy) is picked up by each genre window.
        SELECT DISTINCT g.tconst, g.year, false FROM genre_top g
        WHERE g.tconst NOT IN (SELECT tconst FROM main)
        """
    )

    con.execute(
        """
        CREATE TABLE films AS
        SELECT p.tconst AS film_id, m.title, p.year, m.runtime_minutes, p.main_pool,
               CASE WHEN m.genres_csv IS NULL THEN [] ELSE string_split(m.genres_csv, ',') END AS genres,
               m.imdb_rating, m.imdb_votes,
               coalesce(n.nominations, 0) AS nominations,
               coalesce(n.wins, 0)        AS wins
        FROM pool_films p
        JOIN movies m USING (tconst)
        LEFT JOIN (
            -- Oscar totals across *all* categories, counted per nomination row,
            -- collapsing multi-person nominations (e.g. co-producers) to one.
            SELECT film_id,
                   count(DISTINCT (ceremony, category_raw)) AS nominations,
                   count(DISTINCT CASE WHEN won THEN (ceremony, category_raw) END) AS wins
            FROM nominations GROUP BY film_id
        ) n ON n.film_id = p.tconst
        """
    )
    n_films = con.execute("SELECT count(*) FROM films").fetchone()[0]
    step(f"films: {n_films:,}")

    # ------------------------------------------------------------------ cast & crew
    step("loading title.principals (actors/actresses of pool films only)")
    con.execute(
        f"""
        CREATE TABLE film_cast AS
        WITH raw AS (
            SELECT p.tconst, p.nconst, p.category, p.characters, CAST(p.ordering AS INTEGER) AS ordering
            FROM ({_read_tsv("title.principals.tsv.gz", "tconst, ordering, nconst, category, characters")}) p
            WHERE p.category IN ('actor', 'actress')
              AND p.tconst IN (SELECT film_id FROM films WHERE main_pool)
            -- An actor credited twice in one film (dual roles) keeps only the
            -- highest-billed credit, so each (film, person) is a single row.
            QUALIFY row_number() OVER (PARTITION BY p.tconst, p.nconst ORDER BY ordering) = 1
        )
        SELECT tconst AS film_id, nconst AS person_id, category AS imdb_category,
               -- characters is a JSON-ish list: '["Andy Dufresne"]' -> 'Andy Dufresne'
               nullif(trim(both '"' FROM string_split(trim(both '[]' FROM characters), '","')[1]), '')
                   AS character,
               row_number() OVER (PARTITION BY tconst ORDER BY ordering) AS billing
        FROM raw
        """
    )
    step("loading title.crew (directors of pool films)")
    con.execute(
        f"""
        CREATE TABLE directors AS
        SELECT c.tconst AS film_id, unnest(string_split(c.directors, ',')) AS person_id
        FROM ({_read_tsv("title.crew.tsv.gz", "tconst, directors")}) c
        WHERE c.directors IS NOT NULL
          AND c.tconst IN (SELECT film_id FROM films WHERE main_pool)
        """
    )

    # ------------------------------------------------------------------ contenders
    # Union of pool-derived rows and nominee rows, de-duplicated on
    # (category, film, person). Nominee rows come first so their flags win.
    # A genre round drafts a *film*, like Best Picture, so these rows carry no
    # person. Every film tagged with the genre is eligible, main pool or not.
    genre_contenders_sql = "\n            UNION ALL\n            ".join(
        f"""SELECT '{cat}' AS category, film_id, NULL AS person_id FROM films
                WHERE list_contains(genres, '{tag}')"""
        for cat, tag in GENRE_CATEGORIES.items()
    )
    step("assembling contender pools")
    con.execute(
        f"""
        CREATE TABLE contenders_raw AS
        WITH
        pic AS (
            -- Only main-pool films: genre-only additions exist to stock the
            -- Horror and Comedy rounds, not to widen Best Picture.
            SELECT 'picture' AS category, film_id, NULL AS person_id FROM films WHERE main_pool
        ),
        genre AS ({genre_contenders_sql}),
        dir AS (
            SELECT 'director' AS category, film_id, person_id FROM directors
        ),
        lead AS (
            SELECT CASE imdb_category WHEN 'actor' THEN 'actor' ELSE 'actress' END AS category,
                   film_id, person_id
            FROM film_cast WHERE billing <= {LEAD_MAX_BILLING}
        ),
        sup AS (
            SELECT CASE imdb_category WHEN 'actor' THEN 'supporting_actor'
                                      ELSE 'supporting_actress' END AS category,
                   film_id, person_id
            FROM film_cast WHERE billing BETWEEN {SUPPORTING_MIN_BILLING} AND {SUPPORTING_MAX_BILLING}
        ),
        nominee_rows AS (
            SELECT category, film_id,
                   CASE WHEN category = 'picture' THEN NULL ELSE person_id END AS person_id
            FROM nominations
            WHERE category IS NOT NULL AND film_id IN (SELECT film_id FROM films)
        ),
        everything AS (
            SELECT * FROM nominee_rows UNION
            SELECT * FROM pic UNION SELECT * FROM dir UNION
            SELECT * FROM lead UNION SELECT * FROM sup UNION
            SELECT * FROM genre
        )
        SELECT DISTINCT category, film_id, person_id FROM everything
        """
    )

    con.execute(
        """
        CREATE TABLE contenders AS
        SELECT
            -- Namespaced by category: the same performance can sit in both the
            -- lead and supporting pools and must be a distinct pick in each.
            c.category || ':' ||
            CASE WHEN c.person_id IS NULL THEN c.film_id
                 ELSE c.person_id || ':' || c.film_id END              AS contender_id,
            c.category, f.year, c.film_id, c.person_id,
            ca.character, ca.billing,
            coalesce(n.nominated, false)                               AS nominated,
            coalesce(n.won, false)                                     AS won,
            -- Career context *before* this film year (no leakage from the same year).
            coalesce(pr.prior_nominations, 0)                          AS prior_nominations,
            coalesce(pr.prior_wins, 0)                                 AS prior_wins
        FROM contenders_raw c
        JOIN films f USING (film_id)
        LEFT JOIN film_cast ca ON ca.film_id = c.film_id AND ca.person_id = c.person_id
        LEFT JOIN (
            -- One row per (category, film, person). Best Picture nominations list
            -- several producers; collapsing person_id to NULL for that category
            -- turns them into a single film-level nomination.
            SELECT category, film_id,
                   CASE WHEN category = 'picture' THEN NULL ELSE person_id END AS person_id,
                   true AS nominated, bool_or(won) AS won
            FROM nominations WHERE category IS NOT NULL
            GROUP BY 1, 2, 3
        ) n ON n.category = c.category AND n.film_id = c.film_id
            AND (n.person_id = c.person_id OR (n.person_id IS NULL AND c.person_id IS NULL))
        LEFT JOIN LATERAL (
            SELECT count(*) AS prior_nominations,
                   count(CASE WHEN won THEN 1 END) AS prior_wins
            FROM nominations x
            WHERE x.person_id = c.person_id AND x.year < f.year
        ) pr ON true
        """
    )

    # ------------------------------------------------------------------ people
    step("loading name.basics (referenced people only)")
    con.execute(
        f"""
        CREATE TABLE people AS
        SELECT nconst AS person_id, primaryName AS name,
               TRY_CAST(birthYear AS INTEGER) AS birth_year,
               TRY_CAST(deathYear AS INTEGER) AS death_year,
               primaryProfession AS professions
        FROM ({_read_tsv("name.basics.tsv.gz")})
        WHERE nconst IN (SELECT person_id FROM contenders WHERE person_id IS NOT NULL)
           OR nconst IN (SELECT person_id FROM nominations WHERE person_id IS NOT NULL)
        """
    )

    # ------------------------------------------------------------------ to pandas
    step("computing percentile metrics")
    films_df = con.execute("SELECT * FROM films ORDER BY year, film_id").df()
    # Enrichment columns start empty; ``pipeline.enrich`` fills them later.
    for col in ("box_office_usd", "budget_usd", "rt_critic", "rt_audience", "metascore", "poster_path"):
        films_df[col] = pd.Series([None] * len(films_df), dtype="object")
    films_df["in_pool"] = True

    contenders_df = con.execute(
        """
        SELECT c.*, p.name AS person_name
        FROM contenders c LEFT JOIN people p USING (person_id)
        ORDER BY year, category, contender_id
        """
    ).df()

    # The two derived categories elect their own winner per year. The result is
    # written into the same ``nominated`` / ``won`` columns the Oscar rows use,
    # so nothing downstream has to know these awards were never handed out.
    step("electing genre crowns")
    for category, tag in GENRE_CATEGORIES.items():
        crowns = genre_crowns(films_df, tag, GENRE_NOMINEES).set_index("film_id")
        rows = contenders_df["category"] == category
        contenders_df.loc[rows, "nominated"] = (
            contenders_df.loc[rows, "film_id"].map(crowns["nominated"]).fillna(False).to_numpy()
        )
        contenders_df.loc[rows, "won"] = (
            contenders_df.loc[rows, "film_id"].map(crowns["won"]).fillna(False).to_numpy()
        )
        crowned = contenders_df.loc[rows & contenders_df["won"]]
        print(
            f"  {category}: {rows.sum():,} contenders, "
            f"{crowned['year'].nunique()} years crowned, "
            f"{contenders_df.loc[rows, 'nominated'].sum():,} nominated"
        )
    # Join the film-level numbers needed for percentiles, then drop them again
    # (contenders stay narrow; the API joins films at load time).
    join_cols = ["film_id", "imdb_rating", "imdb_votes", "box_office_usd"]
    contenders_df = contenders_df.merge(films_df[join_cols], on="film_id", how="left")
    contenders_df = add_percentile_metrics(contenders_df).drop(columns=join_cols[1:])

    nominations_df = con.execute("SELECT * FROM nominations ORDER BY ceremony, category_raw").df()
    people_df = con.execute("SELECT * FROM people ORDER BY person_id").df()

    # Enforce compact dtypes so the parquet files stay small and stable.
    films_df = films_df.astype({"year": "int32", "nominations": "int16", "wins": "int16"})
    contenders_df = contenders_df.astype(
        {
            "year": "int32",
            "billing": "Int16",
            "prior_nominations": "int16",
            "prior_wins": "int16",
            "nominated": "bool",
            "won": "bool",
        }
    )

    step("writing parquet")
    films_df.to_parquet(SEED_DIR / "films.parquet", index=False)
    contenders_df.to_parquet(SEED_DIR / "contenders.parquet", index=False)
    nominations_df.to_parquet(SEED_DIR / "nominations.parquet", index=False)
    people_df.to_parquet(SEED_DIR / "people.parquet", index=False)

    step("done")
    print(
        f"  films={len(films_df):,} contenders={len(contenders_df):,} "
        f"nominations={len(nominations_df):,} people={len(people_df):,}"
    )
    print(contenders_df.groupby("category").size().to_string())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top-n", type=int, default=40, help="films per year by vote count")
    parser.add_argument("--min-year", type=int, default=DEFAULT_MIN_YEAR)
    parser.add_argument("--max-year", type=int, default=DEFAULT_MAX_YEAR)
    parser.add_argument(
        "--min-votes",
        type=int,
        default=DEFAULT_MIN_VOTES,
        help="drop non-nominee pool films below this vote count (0 = keep all)",
    )
    args = parser.parse_args(argv)
    build(args.top_n, args.min_year, args.max_year, args.min_votes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
