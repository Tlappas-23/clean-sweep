"""
Career histories computed over a wider film set than the one being modelled.

The sampling frame is right for deciding which films get *predicted*: 42
distributors, a budget floor, 2000 onward, all of it knowable before release
and none of it selecting on the outcome. It was wrong for deciding what the
model knows about the *people*, and the same frame was used for both.

The consequence was measurable and embarrassing. Half the sample carried no
director history, and that was written up as half the sample being first-time
directors. Checked against IMDb's own crew data, only 26% of those blanks are
genuine first features. The rest are directors with earlier work the frame
cannot see: 22% worked only before the 2000 cutoff, and 52% have films since
2000 that simply had a different distributor or a smaller budget. `Mission:
Impossible II` was recorded as a debut. Its director had made twenty-five
features.

So the history universe is built separately here. For every director,
cinematographer and composer attached to a film in the sample, TMDB is asked
for their complete filmography, and the revenue of each of those films is
fetched. The as-of rule is unchanged and still does the real work: a film may
see a person's earlier credits and never a later one. Widening what counts as
"earlier" does not weaken that; it is what makes the feature mean what its name
says.

Cast is deliberately excluded. Its coverage is already 95% and the credit list
per film is long enough that the fetch would be an order of magnitude larger
for a group the ablation has repeatedly found carries nothing.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "backend"))

BASE = "https://api.themoviedb.org/3"
FEATURES = ROOT / "data" / "features.parquet"
FILM_CACHE = ROOT / "data" / "cache" / "film"
PERSON_CACHE = ROOT / "data" / "cache" / "person"
EXTRA_CACHE = ROOT / "data" / "cache" / "extra_film"
OUT = ROOT / "data" / "history.parquet"

# The job strings TMDB uses, matched to the roles fetch.py assigns.
JOBS = {
    "Director": "director",
    "Director of Photography": "cinematographer",
    "Original Music Composer": "composer",
}


def _people_in_sample() -> dict[int, set[str]]:
    """person id -> the roles they hold on films in our sample."""
    ids = set(pd.read_parquet(FEATURES)["imdb_id"].dropna())
    people: dict[int, set[str]] = {}
    for path in FILM_CACHE.glob("*.json"):
        try:
            body = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if body.get("imdb_id") not in ids:
            continue
        for role in ("director", "cinematographer", "composer"):
            for person in body.get(role) or []:
                people.setdefault(int(person["id"]), set()).add(role)
    return people


def fetch_credits(client: httpx.Client, key: str, people: dict[int, set[str]]) -> None:
    """One call per person: their whole filmography, cached to disk."""
    PERSON_CACHE.mkdir(parents=True, exist_ok=True)
    for n, person_id in enumerate(people, 1):
        path = PERSON_CACHE / f"{person_id}.json"
        if path.exists():
            continue
        r = client.get(f"{BASE}/person/{person_id}/movie_credits", params={"api_key": key})
        if r.status_code != 200:
            continue
        crew = [
            {"id": c["id"], "job": c.get("job"), "release_date": c.get("release_date")}
            for c in r.json().get("crew", [])
            if c.get("job") in JOBS
        ]
        path.write_text(json.dumps({"crew": crew}))
        time.sleep(0.02)
        if n % 400 == 0:
            print(f"  credits {n}/{len(people)}", flush=True)


def _known_revenue() -> dict[int, dict]:
    """Revenue already on disk, from the main film cache and this one."""
    known: dict[int, dict] = {}
    for cache in (FILM_CACHE, EXTRA_CACHE):
        for path in cache.glob("*.json"):
            try:
                body = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            if body.get("tmdb_id") is not None:
                known[int(body["tmdb_id"])] = body
    return known


def fetch_missing_films(client: httpx.Client, key: str, wanted: set[int], known: set[int]) -> None:
    """Revenue for every credited film not already cached anywhere."""
    EXTRA_CACHE.mkdir(parents=True, exist_ok=True)
    todo = sorted(wanted - known)
    print(f"  {len(todo)} credited films need a revenue lookup")
    for n, tmdb_id in enumerate(todo, 1):
        path = EXTRA_CACHE / f"{tmdb_id}.json"
        if path.exists():
            continue
        r = client.get(f"{BASE}/movie/{tmdb_id}", params={"api_key": key})
        if r.status_code != 200:
            continue
        body = r.json()
        path.write_text(
            json.dumps(
                {
                    "tmdb_id": body.get("id"),
                    "release_date": body.get("release_date"),
                    "revenue": body.get("revenue"),
                    "title": body.get("title"),
                }
            )
        )
        time.sleep(0.02)
        if n % 1000 == 0:
            print(f"  films {n}/{len(todo)}", flush=True)


def build() -> pd.DataFrame:
    key = os.environ["TMDB_API_KEY"]
    people = _people_in_sample()
    print(f"{len(people)} people attached to the sample")

    with httpx.Client(timeout=30) as client:
        fetch_credits(client, key, people)

        credits: list[dict] = []
        wanted: set[int] = set()
        for person_id in people:
            path = PERSON_CACHE / f"{person_id}.json"
            if not path.exists():
                continue
            for c in json.loads(path.read_text())["crew"]:
                credits.append({"person_id": person_id, "film_id": int(c["id"]), "role": JOBS[c["job"]]})
                wanted.add(int(c["id"]))

        known = _known_revenue()
        fetch_missing_films(client, key, wanted, set(known))

    known = _known_revenue()
    frame = pd.DataFrame(credits).drop_duplicates()
    meta = pd.DataFrame(
        [
            {"film_id": fid, "release_date": b.get("release_date"), "revenue": b.get("revenue")}
            for fid, b in known.items()
            if fid in wanted
        ]
    )

    out = frame.merge(meta, on="film_id", how="inner")
    out["release_date"] = pd.to_datetime(out["release_date"], errors="coerce")
    out = out.dropna(subset=["release_date"])
    out["revenue"] = pd.to_numeric(out["revenue"], errors="coerce")
    out.to_parquet(OUT, index=False)
    return out


if __name__ == "__main__":
    hist = build()
    earning = hist.revenue.gt(0)
    print(
        f"\n{len(hist):,} credits, {hist.film_id.nunique():,} distinct films, "
        f"{hist.person_id.nunique():,} people"
    )
    print(f"{int(earning.sum()):,} credits carry a reported gross ({earning.mean():.1%})")
    print(f"-> {OUT}")
