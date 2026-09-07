"""
Step 3 (optional) of the pipeline: enrich films with box office and critic
scores from TMDB and/or OMDb.

Usage (from ``backend/``)::

    python -m pipeline.enrich --tmdb           # needs TMDB_API_KEY in .env
    python -m pipeline.enrich --omdb           # needs OMDB_API_KEY in .env
    python -m pipeline.enrich --tmdb --omdb --limit 500

Architecture note
-----------------
The game runs on IMDb + Oscar data alone; this step *adds* columns to
``films.parquet`` (box_office_usd, budget_usd, poster_path, rt_critic,
metascore) and then recomputes the ``box_office`` percentile on
``contenders.parquet`` via the shared ``pipeline.metrics`` helper.

Every API response is cached as JSON under ``data/processed/cache`` so the
script is resumable: re-running it never re-fetches a film that succeeded.
OMDb's free tier allows 1,000 requests/day; ``--limit`` lets you spread the
4.5k films over a few days.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv

from pipeline.metrics import add_percentile_metrics
from pipeline.paths import CACHE_DIR, REPO_ROOT, SEED_DIR, ensure_dirs

TMDB_BASE = "https://api.themoviedb.org/3"
OMDB_BASE = "https://www.omdbapi.com/"


class Cache:
    """Tiny JSON-per-key disk cache. Keyed by ``<source>/<imdb id>.json``."""

    def __init__(self, source: str):
        self.dir = CACHE_DIR / source
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def get(self, key: str) -> dict | None:
        p = self.path(key)
        return json.loads(p.read_text()) if p.exists() else None

    def put(self, key: str, value: dict) -> None:
        self.path(key).write_text(json.dumps(value))


# --------------------------------------------------------------------- TMDB
def fetch_tmdb(client: httpx.Client, api_key: str, imdb_id: str, cache: Cache) -> dict:
    """
    Resolve an IMDb id to a TMDB movie and return ``{revenue, budget, poster_path}``.

    Two calls: ``/find`` maps the external id, ``/movie/{id}`` has the money.
    """
    if (hit := cache.get(imdb_id)) is not None:
        return hit
    r = client.get(f"{TMDB_BASE}/find/{imdb_id}", params={"api_key": api_key, "external_source": "imdb_id"})
    r.raise_for_status()
    results = r.json().get("movie_results") or []
    if not results:
        out = {"revenue": None, "budget": None, "poster_path": None}
    else:
        m = client.get(f"{TMDB_BASE}/movie/{results[0]['id']}", params={"api_key": api_key})
        m.raise_for_status()
        j = m.json()
        # TMDB uses 0 for "unknown"; store None so percentiles ignore it.
        out = {
            "revenue": j.get("revenue") or None,
            "budget": j.get("budget") or None,
            "poster_path": j.get("poster_path"),
        }
    cache.put(imdb_id, out)
    return out


# --------------------------------------------------------------------- OMDb
def _parse_money(s: str | None) -> float | None:
    """'$28,341,469' -> 28341469.0"""
    if not s or s == "N/A":
        return None
    try:
        return float(s.replace("$", "").replace(",", ""))
    except ValueError:
        return None


def _parse_int(s: str | None) -> int | None:
    if not s or s == "N/A":
        return None
    try:
        return int(s.rstrip("%"))
    except ValueError:
        return None


def fetch_omdb(client: httpx.Client, api_key: str, imdb_id: str, cache: Cache) -> dict:
    """Return ``{rt_critic, metascore, box_office}`` for an IMDb id."""
    if (hit := cache.get(imdb_id)) is not None:
        return hit
    r = client.get(OMDB_BASE, params={"apikey": api_key, "i": imdb_id})
    r.raise_for_status()
    j = r.json()
    if j.get("Response") != "True":
        # "Request limit reached!" must not be cached as a permanent miss.
        if "limit" in (j.get("Error") or "").lower():
            raise RuntimeError(j["Error"])
        out = {"rt_critic": None, "metascore": None, "box_office": None}
    else:
        rt = next((x["Value"] for x in j.get("Ratings", []) if x["Source"] == "Rotten Tomatoes"), None)
        out = {
            "rt_critic": _parse_int(rt),
            "metascore": _parse_int(j.get("Metascore")),
            "box_office": _parse_money(j.get("BoxOffice")),
        }
    cache.put(imdb_id, out)
    return out


# --------------------------------------------------------------------- driver
def run(use_tmdb: bool, use_omdb: bool, limit: int | None, sleep: float) -> None:
    load_dotenv(REPO_ROOT / ".env")
    ensure_dirs()
    films = pd.read_parquet(SEED_DIR / "films.parquet")

    with httpx.Client(timeout=30) as client:
        if use_tmdb:
            key = os.environ.get("TMDB_API_KEY")
            if not key:
                sys.exit("TMDB_API_KEY missing (see .env.example)")
            cache = Cache("tmdb")
            todo = films[films["box_office_usd"].isna()]["film_id"].tolist()
            if limit:
                todo = todo[:limit]
            print(f"TMDB: {len(todo)} films to fetch")
            rows = {}
            for i, fid in enumerate(todo, 1):
                try:
                    rows[fid] = fetch_tmdb(client, key, fid, cache)
                except httpx.HTTPError as exc:
                    print(f"  ! {fid}: {exc}")
                if i % 100 == 0:
                    print(f"  {i}/{len(todo)}")
                time.sleep(sleep)
            _apply(films, rows, {"revenue": "box_office_usd", "budget": "budget_usd", "poster_path": "poster_path"})

        if use_omdb:
            key = os.environ.get("OMDB_API_KEY")
            if not key:
                sys.exit("OMDB_API_KEY missing (see .env.example)")
            cache = Cache("omdb")
            todo = films[films["metascore"].isna() & films["rt_critic"].isna()]["film_id"].tolist()
            if limit:
                todo = todo[:limit]
            print(f"OMDb: {len(todo)} films to fetch")
            rows = {}
            for i, fid in enumerate(todo, 1):
                try:
                    rows[fid] = fetch_omdb(client, key, fid, cache)
                except RuntimeError as exc:  # daily quota
                    print(f"  stopping: {exc}")
                    break
                except httpx.HTTPError as exc:
                    print(f"  ! {fid}: {exc}")
                if i % 100 == 0:
                    print(f"  {i}/{len(todo)}")
                time.sleep(sleep)
            _apply(films, rows, {"rt_critic": "rt_critic", "metascore": "metascore"})
            # OMDb box office only fills gaps TMDB left.
            bo = {fid: {"box_office": v["box_office"]} for fid, v in rows.items() if v.get("box_office")}
            missing = films["box_office_usd"].isna()
            films.loc[missing, "box_office_usd"] = films.loc[missing, "film_id"].map(
                lambda f: bo.get(f, {}).get("box_office")
            )

    films.to_parquet(SEED_DIR / "films.parquet", index=False)
    _recompute_contender_metrics(films)
    print("enrichment written")


def _apply(films: pd.DataFrame, rows: dict[str, dict], mapping: dict[str, str]) -> None:
    """Copy fetched values into the films frame, only where currently null."""
    for src, dst in mapping.items():
        series = films["film_id"].map(lambda f: rows.get(f, {}).get(src))
        films[dst] = films[dst].where(films[dst].notna(), series)


def _recompute_contender_metrics(films: pd.DataFrame) -> None:
    """Re-derive the within-year percentiles now that box office has changed."""
    contenders = pd.read_parquet(SEED_DIR / "contenders.parquet")
    join_cols = ["film_id", "imdb_rating", "imdb_votes", "box_office_usd"]
    merged = contenders.drop(columns=["acclaim", "popularity", "box_office"]).merge(
        films[join_cols], on="film_id", how="left"
    )
    merged = add_percentile_metrics(merged).drop(columns=join_cols[1:])
    merged.to_parquet(SEED_DIR / "contenders.parquet", index=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tmdb", action="store_true")
    parser.add_argument("--omdb", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="max films per source this run")
    parser.add_argument("--sleep", type=float, default=0.05, help="seconds between requests")
    args = parser.parse_args(argv)
    if not (args.tmdb or args.omdb):
        parser.error("pass --tmdb and/or --omdb")
    run(args.tmdb, args.omdb, args.limit, args.sleep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
