"""
Box office breakouts from Wikidata, which has no quota.

OMDb was the obvious source for domestic gross and it caps at 1,000 requests a
day, which put the full sample two days away. Wikidata carries the same figures
as structured claims: property P2142 is box office, and the place qualifier
P3005 separates the United States figure from the worldwide one. It is free,
unlimited within reason, and one SPARQL query answers for hundreds of films.

It agrees with OMDb where both have an answer. Cars reports $244,082,982
domestic in each; Coco reports $210,460,015 in each. That is not a coincidence,
since both ultimately trace to the same trade reporting, and it is the reason
the swap is safe rather than merely convenient.

Two wrinkles handled here. Films often carry several box office claims from
different sources and vintages, so figures are reduced by taking the median of
what is on offer rather than whichever came back first. And the place qualifier
is sometimes absent, sometimes "United States", sometimes "United States of
America"; anything without a place is treated as worldwide.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "data" / "features.parquet"
OUT = ROOT / "data" / "wikidata_box.parquet"
ENDPOINT = "https://query.wikidata.org/sparql"
AGENT = "clean-sweep-boxoffice-research/1.0 (portfolio project; contact via github.com/Tlappas-23)"
BATCH = 180

US_LABELS = {"United States", "United States of America"}

QUERY = """
SELECT ?imdb ?bo ?place WHERE {
  VALUES ?imdb { %s }
  ?film wdt:P345 ?imdb .
  ?film p:P2142 ?st . ?st ps:P2142 ?bo .
  OPTIONAL { ?st pq:P3005 ?pl . ?pl rdfs:label ?place FILTER(lang(?place)="en") }
}
"""


def fetch(client: httpx.Client, ids: list[str]) -> list[dict]:
    values = " ".join(f'"{i}"' for i in ids)
    r = client.get(ENDPOINT, params={"query": QUERY % values, "format": "json"},
                   headers={"User-Agent": AGENT}, timeout=120)
    r.raise_for_status()
    return r.json()["results"]["bindings"]


def main() -> None:
    films = pd.read_parquet(FEATURES)["imdb_id"].dropna().unique().tolist()
    rows: list[tuple[str, str, float]] = []

    with httpx.Client() as client:
        for start in range(0, len(films), BATCH):
            chunk = films[start:start + BATCH]
            for attempt in range(3):
                try:
                    for b in fetch(client, chunk):
                        place = b.get("place", {}).get("value")
                        scope = "domestic" if place in US_LABELS else (
                            "worldwide" if place is None else "other")
                        if scope != "other":
                            rows.append((b["imdb"]["value"], scope,
                                         float(b["bo"]["value"])))
                    break
                except Exception as exc:                     # noqa: BLE001
                    if attempt == 2:
                        print(f"  batch {start} failed: {exc}", flush=True)
                    time.sleep(5 * (attempt + 1))
            print(f"  {min(start + BATCH, len(films))}/{len(films)}", flush=True)
            time.sleep(1.0)                                   # be a good citizen

    raw = pd.DataFrame(rows, columns=["imdb_id", "scope", "value"])
    # Several claims per film is normal; take the median rather than the first.
    wide = (raw.groupby(["imdb_id", "scope"])["value"].median()
               .unstack("scope").reset_index())
    wide.to_parquet(OUT, index=False)

    dom = wide["domestic"].notna().sum() if "domestic" in wide else 0
    ww = wide["worldwide"].notna().sum() if "worldwide" in wide else 0
    print(f"\n{len(wide)} films matched; domestic {dom}, worldwide {ww} -> {OUT}")


if __name__ == "__main__":
    main()
