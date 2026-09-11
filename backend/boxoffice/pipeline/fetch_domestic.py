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

OMDb allows 1,000 requests a day, and Clean Sweep's own enrichment draws on the
same key. So this does not invent a private allowance: it takes its budget from
`pipeline.budget`, the shared per-provider, per-UTC-day ledger, and records
every request against it. Whichever job runs first gets the quota, and neither
can tip the account over its ceiling.

The ledger is also told when OMDb itself reports the limit is gone, because the
provider is the authority and the local count can legitimately disagree: another
machine shares the key.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
from pipeline.budget import Budget

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


def main(budget: int | None = None) -> None:
    key = os.environ["OMDB_API_KEY"]
    ledger = Budget.load("omdb")
    allowance = min(budget, ledger.remaining) if budget else ledger.remaining
    # No early return here. Rebuilding the output from cache is phase two and
    # must happen whether or not there is quota to spend, otherwise a run on an
    # exhausted day leaves the previous run's partial file in place.
    if allowance <= 0:
        print(f"no OMDb quota left today ({ledger.used} already spent); "
              "rebuilding from cache only")
    else:
        print(f"budget: {allowance} requests ({ledger.remaining} left in the ledger)")
    films = pd.read_parquet(FEATURES)[["imdb_id", "title", "y_worldwide",
                                       "release_date", "is_upcoming"]]
    films = films.dropna(subset=["imdb_id"])

    # Spend newest first. The feature matrix is ordered oldest to newest, so a
    # thousand-request day used to start in 2000 and never reach the years that
    # matter. Domestic coverage gates the three-target split, and the split can
    # only form a fold where a year has twenty films with both figures: 2019 and
    # 2023 onward are the years short of that, and they are the ones a forecast
    # is actually about. Unreleased films are skipped entirely, because there is
    # no gross to ask for yet.
    films = films[~films["is_upcoming"].fillna(False).astype(bool)]
    films = films.sort_values("release_date", ascending=False)

    MINE.mkdir(parents=True, exist_ok=True)
    spent = misses = 0

    # Phase one: spend the allowance on films that have no answer yet. This
    # loop may stop early, on quota or on budget, and that is expected.
    with httpx.Client(timeout=20) as client:
        for r in films.itertuples():
            if spent >= allowance:
                break
            if _read_cached(r.imdb_id) is not None:
                continue
            if (MINE / f"{r.imdb_id}.json").exists():
                continue                       # asked before, genuinely no figure

            resp = client.get("https://www.omdbapi.com/",
                              params={"apikey": key, "i": r.imdb_id})
            spent += 1
            ledger.spend(1)
            body = resp.json() if resp.headers.get("content-type", "").startswith(
                "application/json") else {}

            # Distinguish a film with no box office figure from a request that
            # never got answered. The first is a fact worth remembering; the
            # second is a quota error, and caching a null for it would mark the
            # film as permanently checked and silently drop it from the sample
            # forever. This exact bug poisoned 897 rows on the first run.
            error = str(body.get("Error", "") or "")
            if resp.status_code != 200 or body.get("Response") == "False":
                # Quota exhaustion is fatal for the run; a film OMDb has never
                # heard of is not. Treating the two the same meant one unknown
                # id aborted the day and left the rest of the allowance unspent,
                # which is most of why a thousand-request day returned single
                # digits. A miss is cached as a miss so it is never asked again.
                if "limit" in error.lower():
                    ledger.exhaust()
                    print(f"stopping: {error} after {spent} requests", flush=True)
                    break
                if "not found" in error.lower() or "incorrect imdb" in error.lower():
                    (MINE / f"{r.imdb_id}.json").write_text(
                        json.dumps({"box_office": None, "miss": error}))
                    misses += 1
                    continue
                print(f"stopping: {error or resp.status_code} "
                      f"after {spent} requests", flush=True)
                break

            (MINE / f"{r.imdb_id}.json").write_text(
                json.dumps({"box_office": _parse_money(body.get("BoxOffice"))}))

    # Phase two: rebuild the output from every cached answer, not from whatever
    # the fetch loop happened to reach. Writing from the loop meant an early
    # stop discarded every film after the break point, which replaced 523 rows
    # with 2 the first time it happened.
    rows = [(r.imdb_id, v) for r in films.itertuples()
            if (v := _read_cached(r.imdb_id)) is not None]

    frame = pd.DataFrame(rows, columns=["imdb_id", "y_domestic"]).drop_duplicates("imdb_id")
    frame.to_parquet(OUT, index=False)
    print(f"requests spent {spent} of {allowance} ({misses} films OMDb does not carry)")
    print(f"domestic gross for {len(frame)} of {len(films)} films -> {OUT}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
