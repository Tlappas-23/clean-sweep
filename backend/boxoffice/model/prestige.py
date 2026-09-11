"""
Does Academy pedigree predict revenue? Leave-one-out over the thirteen extras.

Kept as a module rather than a one-off script because the answer is negative
and negative results are the ones that get quietly re-discovered. Anyone who
proposes adding Oscar features to this model can run this and see the number
that already settled it.

The features under test are built by `pipeline/pedigree.py` and
`pipeline/extras.py` and joined by `pipeline/assemble.py`. They are all
pre-release by construction: a nomination counts only if the ceremony that
announced it had already happened on the film's release date.

Design is leave-one-out from the full 48-feature model, for the reason set out
in `ablate.py`: adding a group to a thin baseline asks whether it can carry a
model alone, which is not the question.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.ablate import score
from boxoffice.model.train import FEATURES, feature_columns

V2 = Path(FEATURES).parent / "features_v2.parquet"
OUT = Path(FEATURES).parent / "prestige_ablation.csv"

GROUPS: dict[str, list[str]] = {
    "oscar pedigree": [
        "director_prior_oscar_noms",
        "director_prior_oscar_wins",
        "director_best_prior_noms",
        "cast_prior_oscar_noms",
        "cast_prior_oscar_wins",
        "cast_best_prior_noms",
        "writer_prior_oscar_noms",
        "writer_prior_oscar_wins",
        "writer_best_prior_noms",
        "has_oscar_winner_attached",
    ],
    "release competition": ["releases_within_a_week"],
    "franchise gap": ["years_since_franchise_entry"],
    "director recency": ["director_prior_latest_log"],
}


def main() -> pd.DataFrame:
    frame = pd.read_parquet(V2)
    every = feature_columns(frame)

    full_mae, full_2x = score(frame, every)
    rows = [
        {
            "group": "full v2 model",
            "n_features": len(every),
            "mae_log": full_mae,
            "within_2x": full_2x,
            "d_mae": 0.0,
            "d_2x": 0.0,
        }
    ]

    # The 35-feature model that actually ships, scored on the same rows, so the
    # comparison is thirteen features against nothing rather than against a
    # differently-sampled run.
    base = [c for c in every if not any(c in cols for cols in GROUPS.values())]
    base_mae, base_2x = score(frame, base)
    rows.append(
        {
            "group": "all thirteen removed",
            "n_features": len(base),
            "mae_log": base_mae,
            "within_2x": base_2x,
            "d_mae": base_mae - full_mae,
            "d_2x": base_2x - full_2x,
        }
    )

    for name, cols in GROUPS.items():
        kept = [c for c in every if c not in cols]
        mae, two = score(frame, kept)
        rows.append(
            {
                "group": f"- {name}",
                "n_features": len(kept),
                "mae_log": mae,
                "within_2x": two,
                "d_mae": mae - full_mae,
                "d_2x": two - full_2x,
            }
        )

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


if __name__ == "__main__":
    print(main().to_string(index=False, float_format=lambda v: f"{v:+.3f}"))
