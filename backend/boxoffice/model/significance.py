"""
Which of this project's claims survive a significance test, and which do not.

Every figure reported so far is a point estimate. "The model beats budget-only
by eight points" and "removing the studio group costs three points" were
written as though they were facts of the same kind, and they are not: one is a
large effect on 1,400 films and the other is inside the noise of a 17-fold
average. Until that is measured, a reader cannot tell them apart, and neither
could I.

THE RIGHT TEST FOR THIS METRIC

The headline is binary per film: a forecast either lands inside a factor of two
or it does not. Two models are scored on the *same* films, so the comparison is
paired, and the textbook test for two classifiers on shared items is
**McNemar's**. It looks only at the disagreements -- films one model gets right
and the other gets wrong -- because the films both get right carry no
information about which is better. The exact binomial form is used rather than
the chi-square approximation, since the discordant counts here are small enough
for it to matter.

McNemar answers "is the difference real". It does not answer "how big". For
that there is a **paired bootstrap over films**: resample films with
replacement, recompute both hit rates, and read the interval off the
distribution of their difference. Pairing is what makes it tight; resampling
the two models independently would inflate the interval with variance that
cancels in the comparison.

A third view, reported because it is the one people expect: **Wilcoxon signed
rank across the 17 folds**. It is the weakest of the three here, since 17 is a
small n and a fold mean throws away the film-level pairing, but it is the
standard presentation and its disagreements with the other two are informative.

WHAT IS NOT CLAIMED

These are out-of-fold predictions, so they are honest, but they are not
independent: a film's prediction depends on a model trained on earlier films,
and neighbouring folds share most of their training data. The bootstrap treats
films as exchangeable, which understates uncertainty slightly. Reported rather
than corrected, because the correction is not obvious and the effect is small
next to the intervals below.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.ablate import BASE, GROUPS
from boxoffice.model.train import FEATURES, feature_columns, model

OUT = Path(FEATURES).parent / "significance.csv"
BOOTSTRAP = 5000
RNG = np.random.default_rng(0)


def _model() -> HistGradientBoostingRegressor:
    return model()


def out_of_fold(frame: pd.DataFrame, cols: list[str], first_year: int = 2010) -> pd.DataFrame:
    """Per-film hit/miss for one feature set, plus the fold it came from."""
    frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    frame = frame.sort_values("release_date")
    year = frame["release_date"].dt.year

    rows = []
    for y in sorted(v for v in year.unique() if v >= first_year):
        train, test = frame[year < y], frame[year == y]
        if len(train) < 200 or len(test) < 20:
            continue
        y_tr = train["y_log_worldwide"].to_numpy()
        y_te = test["y_log_worldwide"].to_numpy()

        if cols == BASE:
            pred = LinearRegression().fit(train[cols].to_numpy(), y_tr).predict(test[cols].to_numpy())
        else:
            pred = (
                _model()
                .fit(train[cols].to_numpy(dtype="float64"), y_tr)
                .predict(test[cols].to_numpy(dtype="float64"))
            )
        ratio = np.expm1(pred) / np.maximum(np.expm1(y_te), 1.0)
        rows.append(
            pd.DataFrame(
                {
                    "fold": y,
                    "imdb_id": test["imdb_id"].to_numpy(),
                    "hit": ((ratio >= 0.5) & (ratio <= 2.0)).astype(int),
                }
            )
        )
    return pd.concat(rows, ignore_index=True)


def compare(a: pd.DataFrame, b: pd.DataFrame, name_a: str, name_b: str) -> dict:
    """McNemar, paired bootstrap and Wilcoxon for two per-film hit vectors."""
    merged = a.merge(b, on=["fold", "imdb_id"], suffixes=("_a", "_b"))
    hit_a, hit_b = merged.hit_a.to_numpy(), merged.hit_b.to_numpy()

    # McNemar: only the films the two models disagree on carry information.
    only_a = int(((hit_a == 1) & (hit_b == 0)).sum())
    only_b = int(((hit_a == 0) & (hit_b == 1)).sum())
    p_mcnemar = float(stats.binomtest(only_a, only_a + only_b, 0.5).pvalue) if (only_a + only_b) else 1.0

    # Paired bootstrap over films for the size of the difference.
    idx = RNG.integers(0, len(merged), size=(BOOTSTRAP, len(merged)))
    diffs = hit_a[idx].mean(axis=1) - hit_b[idx].mean(axis=1)
    lo, hi = np.percentile(diffs, [2.5, 97.5])

    # Wilcoxon across folds, the conventional presentation.
    per_fold = merged.groupby("fold")[["hit_a", "hit_b"]].mean()
    try:
        p_wilcoxon = float(stats.wilcoxon(per_fold.hit_a, per_fold.hit_b).pvalue)
    except ValueError:
        p_wilcoxon = 1.0

    return {
        "comparison": f"{name_a} vs {name_b}",
        "n_films": len(merged),
        "rate_a": hit_a.mean(),
        "rate_b": hit_b.mean(),
        "difference": hit_a.mean() - hit_b.mean(),
        "ci_lo": lo,
        "ci_hi": hi,
        "discordant": only_a + only_b,
        "p_mcnemar": p_mcnemar,
        "p_wilcoxon": p_wilcoxon,
        "verdict": "significant" if p_mcnemar < 0.05 else "not distinguishable",
    }


def main() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    full_cols = feature_columns(frame)

    full = out_of_fold(frame, full_cols)
    budget = out_of_fold(frame, BASE)

    rows = [compare(full, budget, "full model", "budget only")]

    # Each feature group, removed from the working model. This is the ablation
    # table with the uncertainty it should always have carried.
    for group, cols in GROUPS.items():
        kept = [c for c in full_cols if c not in cols]
        rows.append(compare(full, out_of_fold(frame, kept), "full model", f"without {group}"))
        print(f"  {group} done", flush=True)

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


if __name__ == "__main__":
    table = main()
    show = table[["comparison", "difference", "ci_lo", "ci_hi", "discordant", "p_mcnemar", "verdict"]]
    print(show.to_string(index=False, float_format=lambda v: f"{v:+.4f}"))
    print(f"\n-> {OUT}")
