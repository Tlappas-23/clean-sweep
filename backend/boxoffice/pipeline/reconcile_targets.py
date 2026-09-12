"""
Correct the worldwide gross, because the label was wrong before the features were.

Two rounds of feature work made the model worse, which is usually a sign that
the thing being predicted is not what it claims to be. It was not.

`enhanced_box_office_data(2000-2024)` carries domestic, foreign and worldwide
for the top 200 films of each year, and its own arithmetic checks out: domestic
plus foreign equals worldwide in 99.9% of its rows. Against it, TMDB's
worldwide figure is short by more than 5% on 105 of the 1,911 films the two
share, by a median factor of 1.29. Thirty of those are the tell: TMDB's
"worldwide" is exactly the domestic figure, so the international half is simply
missing. `Journey to the Center of the Earth` is recorded at $102m against a
real $244m.

The consequence is worse than 5% of rows being noisy. The target is also the
input to every career prior in the matrix, so a director with one mislabelled
credit carries a wrong average into every later film. Feature work sitting on
top of that is measuring the wrong thing.

TWO RULES, AND A LINE NOT CROSSED

The file ranks by revenue, so it is a sample selected on the outcome. Using it
to *add* films would bias the frame toward hits, and that is exactly the
mistake `fetch.py` refuses to make. It is used only to correct films already
admitted by the distributor frame, never to admit new ones.

A value is replaced when the external figure is larger and the two disagree by
more than 5%. Larger, because the failure mode is a missing international half
and there is no mechanism that would invent one. Where our figure is the larger,
it is left alone: that is a disagreement rather than a diagnosis.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

SOURCE = ROOT / "data/raw/enhanced_box_office_data(2000-2024)u.csv"
OUT = ROOT / "backend/boxoffice/data/target_corrections.parquet"

TOLERANCE = 0.05


def _key(series: pd.Series) -> pd.Series:
    return series.astype(str).str.lower().str.replace(r"[^a-z0-9]", "", regex=True)


def build() -> pd.DataFrame:
    external = pd.read_csv(SOURCE)
    # The raw TMDB figure, never the feature matrix. The matrix already carries
    # the corrected gross, so reading it back here would see a ratio of one on
    # every film corrected last time, drop it from the file, and let the next
    # build revert it to TMDB's bad value. Read from the cache and this step is
    # idempotent and can run before or after anything else.
    from boxoffice.pipeline.build_features import load

    films = load()
    films = films[~films["is_upcoming"].fillna(False).astype(bool)].copy()
    films["y_worldwide"] = pd.to_numeric(films["revenue"], errors="coerce")
    films["yr"] = films["release_date"].dt.year

    external["k"] = _key(external["Release Group"])
    films["k"] = _key(films["title"])

    # Titles that repeat within a year cannot be matched safely, so they are not.
    dupes = external.duplicated(["k", "Year"], keep=False)
    external = external[~dupes]

    merged = films.merge(
        external[["k", "Year", "$Worldwide", "$Domestic"]].rename(columns={"Year": "yr"}),
        on=["k", "yr"],
        how="inner",
    )

    ratio = merged["$Worldwide"] / merged["y_worldwide"]
    replace = ratio > (1 + TOLERANCE)

    out = merged.loc[replace, ["imdb_id", "title", "yr", "y_worldwide", "$Worldwide", "$Domestic"]]
    out = out.rename(
        columns={
            "y_worldwide": "tmdb_worldwide",
            "$Worldwide": "corrected_worldwide",
            "$Domestic": "external_domestic",
        }
    )
    out["shortfall"] = out["corrected_worldwide"] - out["tmdb_worldwide"]
    out.to_parquet(OUT, index=False)

    out.attrs["matched"] = len(merged)
    out.attrs["ours_larger"] = int((ratio < 1 - TOLERANCE).sum())
    return out


if __name__ == "__main__":
    corrections = build()
    print(f"{corrections.attrs['matched']} films matched to the external file")
    print(f"{len(corrections)} corrected upward ({len(corrections) / corrections.attrs['matched']:.1%})")
    print(f"{corrections.attrs['ours_larger']} where ours is larger, left alone")
    print(
        f"median shortfall ${corrections.shortfall.median() / 1e6:.1f}m, "
        f"largest ${corrections.shortfall.max() / 1e6:.0f}m"
    )
    print(f"-> {OUT}")
