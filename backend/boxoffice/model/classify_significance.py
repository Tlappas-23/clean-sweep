"""
Is the classifier better than knowing the budget tier, and where?

The summary table shows the model ahead of the tier prior on log loss overall
and in two of three tiers, and level in the third. Whether any of that is real
is a question the table cannot answer, so it is asked properly here.

The comparison is paired: every film has a probability from the model and a
probability from the prior, scored on the same outcome. The per-film log loss
difference is bootstrapped over films for an interval, and a sign test on
which of the two was closer answers the yes/no. Both are reported per tier,
because the overall figure is dominated by the tier where the prior is already
excellent and the interesting tier is the one where it is not.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.classify import OUT_FOLDS, TIER_LABELS

OUT = OUT_FOLDS.parent / "classify_significance.csv"
BOOTSTRAP = 5000
RNG = np.random.default_rng(0)


def _per_film_logloss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1.0))


def compare(d: pd.DataFrame, name: str) -> dict:
    y = d["y"].to_numpy()
    model = _per_film_logloss(d[["p_writeoff", "p_loss", "p_profit"]].to_numpy(), y)
    prior = _per_film_logloss(d[["prior_writeoff", "prior_loss", "prior_profit"]].to_numpy(), y)
    diff = prior - model  # positive = model better

    idx = RNG.integers(0, len(diff), size=(BOOTSTRAP, len(diff)))
    boots = diff[idx].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5])

    wins, losses = int((diff > 0).sum()), int((diff < 0).sum())
    p_sign = float(stats.binomtest(wins, wins + losses, 0.5).pvalue)

    return {
        "slice": name,
        "films": len(d),
        "logloss_model": float(model.mean()),
        "logloss_prior": float(prior.mean()),
        "improvement": float(diff.mean()),
        "ci_lo": float(lo),
        "ci_hi": float(hi),
        "films_model_closer": wins,
        "films_prior_closer": losses,
        "p_sign": p_sign,
        "verdict": "model better"
        if (lo > 0 and p_sign < 0.05)
        else "prior better"
        if (hi < 0 and p_sign < 0.05)
        else "not distinguishable",
    }


def main() -> pd.DataFrame:
    folds = pd.read_parquet(OUT_FOLDS)
    rows = [compare(folds, "all")]
    for tier in TIER_LABELS:
        rows.append(compare(folds[folds["tier"] == tier], tier))
    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


if __name__ == "__main__":
    t = main()
    print(
        t[
            [
                "slice",
                "films",
                "improvement",
                "ci_lo",
                "ci_hi",
                "films_model_closer",
                "films_prior_closer",
                "p_sign",
                "verdict",
            ]
        ].to_string(index=False, float_format=lambda v: f"{v:+.4f}")
    )
