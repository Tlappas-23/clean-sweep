"""
Build the film sample from TMDB.

Sampling is a modelling decision, not plumbing, so it is worth stating plainly.
The population this project cares about is *films that were financed and given
a theatrical release* — the slate a studio is actually deciding about. The
sample is therefore defined by two pre-release facts:

    * a theatrical or limited-theatrical release type, and
    * a reported budget above a floor.

Both are known before opening weekend. The obvious alternative filters are not:
sorting by revenue selects on the target, and filtering by vote count or
popularity selects on how many people eventually saw it, which is the same
mistake wearing a different name. Those would produce a sample whose very
membership leaks the answer.

One call per film returns detail and credits together, so director,
cinematographer, composer, cast and production companies all arrive with the
budget and the release date. Responses are cached to disk; re-running costs
nothing and the sample is reproducible.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

BASE = "https://api.themoviedb.org/3"
CACHE = Path(__file__).resolve().parents[1] / "data" / "cache"
BUDGET_FLOOR = 1_000_000  # films financed at any real scale
RELEASE_TYPES = "3"  # theatrical

# The sampling frame: US theatrical releases from the major and mini-major
# distributors. TMDB classifies almost everything as theatrical, which returns
# 37,000 titles for a single year and is mostly festival and direct-to-video
# tail. Anchoring on the distributor cuts that to about 175 a year and defines
# a coherent population: films that someone with a marketing budget chose to
# put in cinemas.
#
# This is a pre-release filter, which is the requirement. A distributor is
# attached months before opening weekend. Selecting on revenue, popularity or
# vote count would have been easier and would have leaked the answer into the
# sample definition.
DISTRIBUTORS = (
    2,
    3,
    420,
    1,
    25,
    43,
    127929,  # Disney, Pixar, Marvel, Lucasfilm, 20th, Searchlight
    174,
    12,
    97,
    9993,  # Warner, New Line, Castle Rock, DC
    33,
    10146,
    6704,
    10163,
    3172,  # Universal, Focus, Illumination, Working Title, Blumhouse
    5,
    559,
    3287,
    2251,
    34,  # Columbia, TriStar, Screen Gems, Sony Animation, Sony
    4,
    2348,  # Paramount, Nickelodeon
    1632,
    491,  # Lionsgate, Summit
    21,
    60,  # MGM, United Artists
    41077,
    90733,
    307,
    1030,  # A24, Neon, IFC, Magnolia
    116962,
    41624,
    56,
    923,
    82819,  # STX, Annapurna, Amblin, Legendary, Skydance
    178464,
    20580,
    151347,  # Netflix, Amazon, Apple
    7,
    11,
    694,
    431,  # DreamWorks, Fox Searchlight legacy, StudioCanal, Focus legacy
)
_COMPANIES = "|".join(str(i) for i in DISTRIBUTORS)


def _cache_path(kind: str, key: str) -> Path:
    return CACHE / kind / f"{key}.json"


def _cached(kind: str, key: str) -> dict | None:
    p = _cache_path(kind, key)
    if p.exists():
        return json.loads(p.read_text())
    return None


def _store(kind: str, key: str, payload: dict) -> None:
    p = _cache_path(kind, key)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload))


def discover_year(client: httpx.Client, key: str, year: int) -> list[int]:
    """Every theatrically released film for one year, as TMDB ids."""
    hit = _cached("discover", str(year))
    if hit:
        return hit["ids"]

    ids: list[int] = []
    page = 1
    while page <= 500:  # TMDB caps paging at 500
        r = client.get(
            f"{BASE}/discover/movie",
            params={
                "api_key": key,
                "primary_release_year": year,
                "with_companies": _COMPANIES,
                "with_release_type": RELEASE_TYPES,
                "page": page,
                "sort_by": "primary_release_date.asc",
            },
        )
        r.raise_for_status()
        body = r.json()
        ids += [m["id"] for m in body.get("results", [])]
        if page >= body.get("total_pages", 1):
            break
        page += 1
        time.sleep(0.02)

    _store("discover", str(year), {"ids": ids})
    return ids


def film(client: httpx.Client, key: str, tmdb_id: int) -> dict | None:
    """Detail plus credits in one request; None if it fails."""
    hit = _cached("film", str(tmdb_id))
    if hit is not None:
        return hit or None

    r = client.get(
        f"{BASE}/movie/{tmdb_id}", params={"api_key": key, "append_to_response": "credits,release_dates"}
    )
    if r.status_code != 200:
        _store("film", str(tmdb_id), {})
        return None
    body = r.json()
    _store("film", str(tmdb_id), _compact(body))
    return _cached("film", str(tmdb_id))


def _compact(body: dict) -> dict:
    """Keep only the pre-release fields plus the targets; drop the rest."""
    crew = body.get("credits", {}).get("crew", [])
    cast = body.get("credits", {}).get("cast", [])

    def by_job(job: str) -> list[dict]:
        return [{"id": p["id"], "name": p["name"]} for p in crew if p.get("job") == job]

    return {
        "tmdb_id": body.get("id"),
        "imdb_id": body.get("imdb_id"),
        "title": body.get("title"),
        "release_date": body.get("release_date"),
        "budget": body.get("budget"),
        "revenue": body.get("revenue"),  # worldwide; the target
        "runtime": body.get("runtime"),
        "original_language": body.get("original_language"),
        "genres": [g["name"] for g in body.get("genres", [])],
        "companies": [{"id": c["id"], "name": c["name"]} for c in body.get("production_companies", [])],
        "collection": (body.get("belongs_to_collection") or {}).get("id"),
        "director": by_job("Director"),
        "cinematographer": by_job("Director of Photography"),
        "composer": by_job("Original Music Composer"),
        "writer": by_job("Screenplay") or by_job("Writer"),
        "cast": [{"id": p["id"], "name": p["name"], "order": p.get("order")} for p in cast[:10]],
    }


def upcoming(client: httpx.Client, key: str, after: str) -> list[int]:
    """
    The unreleased slate: films with a release date still in the future.

    Same distributor frame as the training sample, because a forecast is only
    comparable to the backtest if it describes the same population. Discovery is
    by date rather than year so a film releasing next January is included
    without pulling in everything else from that year.
    """
    ids: list[int] = []
    page = 1
    while page <= 20:
        r = client.get(
            f"{BASE}/discover/movie",
            params={
                "api_key": key,
                "with_companies": _COMPANIES,
                "with_release_type": RELEASE_TYPES,
                "primary_release_date.gte": after,
                "page": page,
                "sort_by": "primary_release_date.asc",
            },
        )
        r.raise_for_status()
        body = r.json()
        ids += [m["id"] for m in body.get("results", [])]
        if page >= body.get("total_pages", 1):
            break
        page += 1
        time.sleep(0.02)
    return ids


def fetch_upcoming(after: str) -> int:
    """Cache detail for every unreleased film, whatever its budget."""
    key = os.environ["TMDB_API_KEY"]
    kept = 0
    with httpx.Client(timeout=30) as client:
        for tmdb_id in upcoming(client, key, after):
            body = film(client, key, tmdb_id)
            # No budget floor here. An unreleased film often has no budget
            # published yet, and excluding it would mean the slate a studio
            # actually cares about is the part the model refuses to look at.
            if body and body.get("release_date"):
                kept += 1
    return kept


def main(start: int, end: int) -> None:
    key = os.environ["TMDB_API_KEY"]
    kept = seen = 0
    with httpx.Client(timeout=30) as client:
        for year in range(start, end + 1):
            ids = discover_year(client, key, year)
            for tmdb_id in ids:
                body = film(client, key, tmdb_id)
                seen += 1
                if body and (body.get("budget") or 0) >= BUDGET_FLOOR:
                    kept += 1
            print(f"{year}: {len(ids):5d} released, running kept={kept}", flush=True)
    print(f"done: {seen} fetched, {kept} above the budget floor")


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
