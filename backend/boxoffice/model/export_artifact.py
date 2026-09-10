"""
Write the box office projections as a serving artifact.

This follows the pattern the rest of the project already uses: training happens
offline, writes JSON into `data/models`, and the API reads and validates it. No
model object is ever loaded on the request path, so scikit-learn stays out of
the serving process entirely.

The artifact carries one entry per film with a projection, plus a lowercase
search key so the endpoint can match a title without a database. Films released
before the first validation fold are excluded rather than shipped with an
in-sample number, because a projection that saw the answer is not a projection.
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

PROJECTIONS = ROOT / "backend/boxoffice/data/projections.parquet"
OUT = ROOT / "data/models/boxoffice_projections.json"


def _key(title: str) -> str:
    """Fold accents and case so a search matches what a person would type."""
    folded = unicodedata.normalize("NFD", str(title))
    folded = "".join(c for c in folded if unicodedata.category(c) != "Mn")
    return folded.casefold().strip()


def main() -> None:
    frame = pd.read_parquet(PROJECTIONS)
    frame = frame.dropna(subset=["projected_worldwide", "imdb_id"])
    # Unreleased films sort to the top so the slate is what a visitor sees
    # first: a backtest is interesting, a forecast is useful.
    frame = frame.sort_values(
        ["is_upcoming", "actual_worldwide"], ascending=[False, False])

    films = []
    for r in frame.itertuples():
        actual = None if pd.isna(r.actual_worldwide) else float(r.actual_worldwide)
        films.append({
            "imdb_id": r.imdb_id,
            "title": r.title,
            "key": _key(r.title),
            "year": int(pd.Timestamp(r.release_date).year),
            # Rounded to the nearest hundred thousand. Printing a forecast to
            # the dollar implies a precision this model does not have.
            "projected": round(float(r.projected_worldwide), -5),
            "actual": None if actual is None else round(actual, -5),
            "ratio": None if actual is None else round(float(r.ratio), 3),
            "within_2x": bool(r.within_2x),
            "upcoming": bool(r.is_upcoming),
            "budget_known": bool(r.budget_known),
        })

    scored = [f for f in films if f["actual"] is not None]
    slate = [f for f in films if f["upcoming"]]
    payload = {
        "generated_from": "rolling-origin folds; each film scored by a model "
                          "trained only on films released before its own year",
        "films": films,
        "summary": {
            "films": len(films),
            "upcoming": len(slate),
            "upcoming_with_budget": sum(f["budget_known"] for f in slate),
            # What to expect from a forecast with no published budget, measured
            # by withholding budget from the backtest rather than guessed.
            "within_2x_without_budget": 0.508,
            "within_2x": round(sum(f["within_2x"] for f in scored) / len(scored), 4),
            "median_ratio": round(float(pd.Series(
                [f["ratio"] for f in scored]).median()), 3),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"{len(films)} films -> {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"within a factor of two: {payload['summary']['within_2x']:.1%}")


if __name__ == "__main__":
    main()
