"""
Does career structure predict revenue where career earnings did not?

The earnings version of this idea failed twice: widening a person's history
beyond the sampling frame made the model worse, and normalising each credit
against the market it opened into made it worse again. Both were built on the
revenue in `history.parquet`, which is reported for 42% of credits.

Career structure uses the dates instead, which are reported for all of them.
That is a different feature at three times the coverage, and it makes a
different claim: not "how much has this director earned" but "how long have
they been doing this, how often, and what are they coming off".

Scored the same way as everything else, with the paired test attached, because
an improvement of a point on 1,400 films is not an improvement.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.significance import compare, out_of_fold
from boxoffice.model.train import FEATURES, feature_columns, run, summarise

DATA = Path(FEATURES).parent
OUT = DATA / "career_ablation.csv"

GROUPS = {
    "tenure": ["career_length_years", "films_to_date", "films_per_year"],
    "recency": ["years_since_last", "gap_bucket", "is_returning"],
}
ROLES = ("director", "cinematographer", "composer")


def matrix() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    career = pd.read_parquet(DATA / "career.parquet")
    return frame.merge(career, on="imdb_id", how="left")


def main() -> pd.DataFrame:
    frame = matrix()
    base_cols = feature_columns(pd.read_parquet(FEATURES))
    career_cols = [f"{r}_{c}" for r in ROLES for g in GROUPS.values() for c in g]
    full_cols = base_cols + career_cols

    print(f"base {len(base_cols)} features, plus {len(career_cols)} career columns")
    print(summarise(run(frame, full_cols)).to_string(index=False, float_format=lambda v: f"{v:.4f}"))

    full = out_of_fold(frame, full_cols)
    rows = [compare(full, out_of_fold(frame, base_cols), "with career", "without any career structure")]
    for name, cols in GROUPS.items():
        drop = {f"{r}_{c}" for r in ROLES for c in cols}
        rows.append(
            compare(
                full,
                out_of_fold(frame, [c for c in full_cols if c not in drop]),
                "with career",
                f"without {name}",
            )
        )
        print(f"  {name} done", flush=True)

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


if __name__ == "__main__":
    table = main()
    print(
        "\n"
        + table[["comparison", "difference", "ci_lo", "ci_hi", "p_mcnemar", "verdict"]].to_string(
            index=False, float_format=lambda v: f"{v:+.4f}"
        )
    )
