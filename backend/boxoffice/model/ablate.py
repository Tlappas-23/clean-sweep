"""
The ablation study: what does each pre-release signal actually buy?

This is the deliverable. Chasing an error metric on box office adds nothing to
a well-worn problem; the question a studio actually asks is which of the things
knowable before release carry information, and how much.

Each group is added to the budget-only baseline in isolation and scored on the
same rolling-origin folds, so the numbers are comparable to each other and to
the bar. Groups that do not earn their place are reported as such: a feature
that costs coverage and returns nothing is a finding, not an embarrassment.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES, run, summarise

BASE = ["log_budget"]

GROUPS: dict[str, list[str]] = {
    "form": ["runtime_minutes", "original_language_en", "is_sequel", "franchise_position"],
    "genre": [f"genre_{g}" for g in ("action", "comedy", "drama", "horror",
                                     "sciencefiction", "family", "thriller",
                                     "documentary", "animation", "adventure")],
    "calendar": ["release_month", "release_week", "is_summer", "is_holiday_corridor"],
    "studio": ["companies_prior_median_log", "companies_prior_max_log",
               "companies_prior_count", "is_major_studio"],
    "director": ["director_prior_median_log", "director_prior_max_log",
                 "director_prior_count"],
    "cast": ["cast_prior_median_log", "cast_prior_max_log", "cast_prior_count"],
    "cinematographer": ["cinematographer_prior_median_log",
                        "cinematographer_prior_max_log",
                        "cinematographer_prior_count"],
    "composer": ["composer_prior_median_log", "composer_prior_max_log",
                 "composer_prior_count"],
    "writer": ["writer_prior_median_log", "writer_prior_max_log",
               "writer_prior_count"],
}


def score(frame: pd.DataFrame, cols: list[str]) -> tuple[float, float]:
    folds = run(frame, cols)
    s = summarise(folds).set_index("estimator")
    return float(s.loc["model", "mae_log"]), float(s.loc["model", "within_2x"])


def main() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)

    base_mae, base_2x = score(frame, BASE)
    rows = [{"group": "budget only (baseline)", "n_features": len(BASE),
             "mae_log": base_mae, "within_2x": base_2x,
             "d_mae": 0.0, "d_2x": 0.0}]

    for name, cols in GROUPS.items():
        mae, two = score(frame, BASE + cols)
        rows.append({"group": f"+ {name}", "n_features": len(BASE) + len(cols),
                     "mae_log": mae, "within_2x": two,
                     "d_mae": mae - base_mae, "d_2x": two - base_2x})

    every = BASE + [c for cols in GROUPS.values() for c in cols]
    full_mae, full_2x = score(frame, every)
    rows.append({"group": "all groups", "n_features": len(every),
                 "mae_log": full_mae, "within_2x": full_2x,
                 "d_mae": full_mae - base_mae, "d_2x": full_2x - base_2x})

    out = pd.DataFrame(rows)
    out["design"] = "add one to budget"

    # Leave-one-out, which is the ablation that answers the question actually
    # being asked. Adding a group to a one-feature baseline tests whether it can
    # carry a model alone; almost nothing can, and a booster given five features
    # and four hundred iterations will overfit them. Removing a group from the
    # working model tests what it contributes *in the presence of the others*,
    # which is how it will be used.
    loo = []
    for name, cols in GROUPS.items():
        kept = [c for c in every if c not in cols]
        mae, two = score(frame, kept)
        loo.append({"group": f"- {name}", "n_features": len(kept),
                    "mae_log": mae, "within_2x": two,
                    "d_mae": mae - full_mae, "d_2x": two - full_2x,
                    "design": "remove one from full"})
    out = pd.concat([out, pd.DataFrame(loo)], ignore_index=True)
    out.to_csv(Path(FEATURES).parent / "ablation.csv", index=False)
    return out


if __name__ == "__main__":
    table = main()
    print(table.to_string(index=False, float_format=lambda v: f"{v:+.3f}"))
