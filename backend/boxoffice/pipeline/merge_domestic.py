"""
One domestic figure per film from two sources that mostly agree.

OMDb and Wikidata overlap on 239 films and match exactly on 198 of them, within
one percent on 224, and within ten percent on 234. Five disagree by more, and
in every one of those Wikidata reports the smaller number, which is what an
early-run figure looks like against a final one.

So OMDb wins where both exist and Wikidata fills the gaps. That ordering is a
judgement about which source is later rather than which is better, and it is
recorded here so it can be revisited rather than rediscovered.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1] / "data"


def main() -> None:
    omdb = pd.read_parquet(ROOT / "domestic.parquet").rename(columns={"y_domestic": "omdb"})
    wiki = pd.read_parquet(ROOT / "wikidata_box.parquet")[["imdb_id", "domestic"]]
    wiki = wiki.dropna().rename(columns={"domestic": "wikidata"})

    merged = omdb.merge(wiki, on="imdb_id", how="outer")
    merged["y_domestic"] = merged["omdb"].fillna(merged["wikidata"])
    merged["source"] = merged["omdb"].notna().map({True: "omdb", False: "wikidata"})

    out = merged[["imdb_id", "y_domestic", "source"]].dropna(subset=["y_domestic"])
    out.to_parquet(ROOT / "domestic_merged.parquet", index=False)

    films = pd.read_parquet(ROOT / "features.parquet")["imdb_id"].nunique()
    print(f"{len(out)} of {films} films have a domestic figure ({len(out) / films:.0%})")
    print(out["source"].value_counts().to_string())


if __name__ == "__main__":
    main()
