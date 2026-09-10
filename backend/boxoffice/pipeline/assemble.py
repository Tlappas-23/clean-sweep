"""Join the base features with the Oscar pedigree and the extra signals."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
OUT = DATA / "features_v2.parquet"


def main() -> None:
    base = pd.read_parquet(DATA / "features.parquet")
    for name in ("pedigree", "extras"):
        extra = pd.read_parquet(DATA / f"{name}.parquet")
        base = base.merge(extra, on="imdb_id", how="left")
    base.to_parquet(OUT, index=False)

    added = [c for c in base.columns
             if c.startswith(("director_prior_oscar", "cast_prior_oscar",
                              "writer_prior_oscar", "has_oscar", "releases_within",
                              "years_since", "director_prior_latest"))]
    print(f"{len(base)} films, {len(added)} new features -> {OUT.name}")
    for c in added:
        print(f"  {c:34s} coverage {base[c].notna().mean():.0%}")


if __name__ == "__main__":
    main()
