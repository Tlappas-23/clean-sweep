"""
The marketing logline, which is the only plot text that exists before release.

A plot summary is an appealing feature and a dangerous one, and which it is
depends entirely on who wrote it and when.

**Wikipedia plot summaries are written after the film has played.** Their
existence, length and detail are a function of how much attention a film
received, which is the same class of signal as a vote count: it is measured by
the audience, after the fact. A model fed them would be told, in a roundabout
way, how much people cared. That is why they are not used here.

**TMDB's `overview` is the studio's own synopsis**, published to sell tickets
and present on the record months before opening. Every film on the unreleased
slate has one. That makes it answerable as of the release date, which is the
bar every other feature in this project has to clear.

One honest caveat, recorded rather than hidden: TMDB is community-editable, so
an overview *can* be revised after release. The text is descriptive rather than
evaluative, so a revision is unlikely to encode performance, but it is not the
same guarantee as a timestamped pre-release document. If the ablation ever
finds this group carrying real weight, that is the assumption to attack first.
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
CACHE = ROOT / "data" / "cache" / "synopsis"
OUT = ROOT / "data" / "synopsis.parquet"


def _tmdb_ids() -> dict[str, int]:
    """imdb_id -> tmdb_id, read off the film cache the main fetch already wrote."""
    pairs: dict[str, int] = {}
    for path in FILM_CACHE.glob("*.json"):
        try:
            body = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if body.get("imdb_id") and body.get("tmdb_id"):
            pairs[body["imdb_id"]] = int(body["tmdb_id"])
    return pairs


def build() -> pd.DataFrame:
    key = os.environ["TMDB_API_KEY"]
    CACHE.mkdir(parents=True, exist_ok=True)

    films = pd.read_parquet(FEATURES)[["imdb_id"]].dropna().drop_duplicates()
    ids = _tmdb_ids()

    rows: list[dict] = []
    with httpx.Client(timeout=30) as client:
        for n, imdb_id in enumerate(films["imdb_id"], 1):
            cached = CACHE / f"{imdb_id}.json"
            if cached.exists():
                body = json.loads(cached.read_text())
            else:
                tmdb_id = ids.get(imdb_id)
                if tmdb_id is None:
                    continue
                r = client.get(f"{BASE}/movie/{tmdb_id}", params={"api_key": key})
                if r.status_code != 200:
                    continue
                payload = r.json()
                body = {
                    "overview": (payload.get("overview") or "").strip(),
                    "tagline": (payload.get("tagline") or "").strip(),
                }
                cached.write_text(json.dumps(body))
                time.sleep(0.02)
            rows.append({"imdb_id": imdb_id, **body})
            if n % 500 == 0:
                print(f"  {n}/{len(films)}", flush=True)

    frame = pd.DataFrame(rows)
    frame.to_parquet(OUT, index=False)
    return frame


if __name__ == "__main__":
    out = build()
    has = out["overview"].str.len().gt(0)
    print(
        f"{len(out)} films; {int(has.sum())} with a synopsis "
        f"({has.mean():.1%}), median {int(out.loc[has, 'overview'].str.len().median())} chars"
    )
    print(f"-> {OUT}")
