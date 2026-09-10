"""
Domestic gross, so the target can be split three ways.

TMDB reports a single worldwide figure with no breakdown. OMDb carries the US
domestic gross, which is the missing half: international is then worldwide
minus domestic, and the three targets become

    domestic          what it made in the US and Canada
    international     what it made everywhere else
    worldwide         the sum, not a third fit

Modelling worldwide alone hides that the two halves have different drivers. A
horror film can open to $40M domestic and $15M abroad; a spectacle sequel
inverts that ratio, and one fit on the total cannot express either.

Two notes on correctness. The domestic figure is a *target*, not a feature, so
the fact that it is a current number rather than an as-of-release one is fine:
targets are supposed to be the realised outcome. And Clean Sweep's own
enrichment cache already holds several hundred of these under the key
`box_office`, so those are read rather than re-fetched.

OMDb allows 1,000 requests a day. The script takes a budget, stops when it is
spent, and is safe to run again tomorrow: everything already cached is skipped.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "data" / "features.parquet"
OUT = ROOT / "data" / "domestic.parquet"
MINE = ROOT / "data" / "cache" / "omdb"
# Clean Sweep's enrichment cache, written by a different pipeline for a
# different film set, but the overlap is free money.
SHARED = Path(__file__).resolve().parents[3] / "data/processed/cache/cache_hidden/omdb"


def _read_cached(imdb_id: str) -> float | None:
    for base in (MINE, SHARED):
        for name in (f"{imdb_id}.json", imdb_id):
            p = base / name
            if p.exists():
                body = json.loads(p.read_text())
                body = body.get("data", body)
                value = body.get("box_office") or body.get("box_office_usd")
                return float(value) if value else None
    return None


def _parse_money(raw: str | None) -> float | None:
    if not raw or raw in ("N/A", ""):
        return None
    try:
        return float(raw.replace("$", "").replace(",", ""))
    except ValueError:
        return None


def main(budget: int) -> None:
    key = os.environ["OMDB_API_KEY"]
    films = pd.read_parquet(FEATURES)[["imdb_id", "title", "y_worldwide"]]
    films = films.dropna(subset=["imdb_id"])

    MINE.mkdir(parents=True, exist_ok=True)
    rows, spent, from_cache = [], 0, 0

    with httpx.Client(timeout=20) as client:
        for r in films.itertuples():
            cached = _read_cached(r.imdb_id)
            if cached is not None:
                rows.append((r.imdb_id, cached))
                from_cache += 1
                continue
            if (MINE / f"{r.imdb_id}.json").exists():
                continue                       # tried before, no figure
            if spent >= budget:
                continue

            resp = client.get("https://www.omdbapi.com/",
                              params={"apikey": key, "i": r.imdb_id})
            spent += 1
            body = resp.json() if resp.headers.get("content-type", "").startswith(
                "application/json") else {}

            # Distinguish a film with no box office figure from a request that
            # never got answered. The first is a fact worth remembering; the
            # second is a quota error, and caching a null for it would mark the
            # film as permanently checked and silently drop it from the sample
            # forever. This exact bug poisoned 897 rows on the first run.
            if resp.status_code != 200 or body.get("Response") == "False":
                print(f"stopping: {body.get('Error', resp.status_code)} "
                      f"after {spent} requests", flush=True)
                break

            value = _parse_money(body.get("BoxOffice"))
            (MINE / f"{r.imdb_id}.json").write_text(
                json.dumps({"box_office": value}))
            if value:
                rows.append((r.imdb_id, value))

    frame = pd.DataFrame(rows, columns=["imdb_id", "y_domestic"]).drop_duplicates("imdb_id")
    frame.to_parquet(OUT, index=False)
    print(f"requests spent {spent} of {budget}; {from_cache} read from cache")
    print(f"domestic gross for {len(frame)} of {len(films)} films -> {OUT}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 900)
