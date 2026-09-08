"""
Does the ranker actually know anything? (``python -m ml.validate``)

A held-out ROC-AUC is a number, not a finding. This module is the argument
that the number means something, and it is deliberately adversarial: three
separate ways for the model to be exposed as an artefact of its own setup.

1. Leakage audit
----------------
Every feature is scored on its own against the label. A single column that
separates winners from the field almost perfectly is not a discovery, it is
the answer having leaked in under another name. ``ml.features`` already bars
the obvious offenders (``nominated``, ``won``, and the film-level
``nominations``/``wins`` totals); this checks the remainder empirically
rather than trusting the list.

2. A null that has to be beaten
-------------------------------
The labels are shuffled and the whole pipeline retrained, repeatedly. That
gives the distribution of scores obtainable from *no* signal at all, given
this many features, this class imbalance and this much data. The real score
is a finding only if it sits outside that distribution, and the permutation
p-value says by how much.

3. Baselines that are not straw men
-----------------------------------
Beating chance is easy when 1 in 100 rows is positive. The comparisons that
matter are against the cheap heuristics a person would actually use: pick the
top-billed name, or the best-reviewed film, or the most popular one. A model
that cannot beat "rank by billing" is not worth shipping, whatever its AUC.

Scope
-----
The two derived genre categories are **excluded** from every number here.
Their label is the genre crown, which ``pipeline.crowns`` computes from IMDb
rating and vote count - both model features - so predicting them is circular
by construction and inflates every metric it touches. What is reported is the
model's performance on the six real Academy Awards, which is the only claim
worth making.

Output lands in ``data/models/validation.json`` and on the analytics page.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.features import build_contender_features, load_seed
from ml.paths import MODELS_DIR, ensure_dirs
from ml.train_ranker import GENRE_CATEGORIES, RANDOM_STATE, TEST_FROM_YEAR, make_pipeline

# Permutation rounds. Each one retrains the full pipeline, so this is the
# expensive part; 50 is enough to resolve a p-value of ~0.02, which is far
# below anything the real model should be scoring.
N_PERMUTATIONS = 50

# Bootstrap resamples for the confidence interval around the held-out AUC.
N_BOOTSTRAP = 2_000

# A single feature scoring above this against the label is treated as a leak.
LEAK_THRESHOLD = 0.90


def _academy_only(contenders: pd.DataFrame) -> pd.Series:
    """Mask selecting the six real Academy categories."""
    return ~contenders["category"].isin(GENRE_CATEGORIES)


def leakage_audit(X: pd.DataFrame, y: np.ndarray) -> dict:
    """
    Score every feature on its own. Anything near-perfect is the label in disguise.

    Reported as ``max(auc, 1 - auc)`` because a feature that predicts the
    label perfectly *backwards* has leaked just as badly as one that predicts
    it forwards.
    """
    scores: list[dict] = []
    for column in X.columns:
        values = pd.to_numeric(X[column], errors="coerce")
        present = values.notna()
        if present.sum() < 100 or values[present].nunique() < 2:
            continue
        try:
            auc = roc_auc_score(y[present.to_numpy()], values[present])
        except ValueError:  # pragma: no cover - degenerate column
            continue
        scores.append({"feature": column, "auc": round(float(max(auc, 1 - auc)), 4)})

    scores.sort(key=lambda s: -s["auc"])
    leaks = [s for s in scores if s["auc"] >= LEAK_THRESHOLD]
    return {
        "threshold": LEAK_THRESHOLD,
        "n_features": len(scores),
        "strongest": scores[:10],
        "suspected_leaks": leaks,
        "clean": not leaks,
    }


def bootstrap_auc(y: np.ndarray, prob: np.ndarray, n: int = N_BOOTSTRAP) -> dict:
    """
    Percentile bootstrap interval for the held-out AUC.

    Resampling is stratified - positives and negatives are drawn separately -
    because with ~40 winners in ~5,000 rows an unstratified resample would
    sometimes contain no positives at all and the AUC would be undefined.
    """
    rng = np.random.default_rng(RANDOM_STATE)
    pos = np.flatnonzero(y)
    neg = np.flatnonzero(~y)
    if len(pos) < 2 or len(neg) < 2:  # pragma: no cover - degenerate split
        return {"point": None}

    draws = np.empty(n)
    for i in range(n):
        take = np.concatenate(
            [rng.choice(pos, len(pos), replace=True), rng.choice(neg, len(neg), replace=True)]
        )
        draws[i] = roc_auc_score(y[take], prob[take])

    lo, hi = np.percentile(draws, [2.5, 97.5])
    return {
        "point": round(float(roc_auc_score(y, prob)), 4),
        "ci95": [round(float(lo), 4), round(float(hi), 4)],
        "resamples": n,
        "n_positives": int(len(pos)),
    }


def permutation_test(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_test: pd.DataFrame,
    y_test: np.ndarray,
    observed: float,
    rounds: int = N_PERMUTATIONS,
) -> dict:
    """
    Retrain on shuffled labels ``rounds`` times to build the no-signal null.

    The p-value uses the standard ``(1 + #{null >= observed}) / (1 + rounds)``
    form, which cannot report zero - claiming p = 0 from 50 samples would be
    a stronger statement than the experiment supports.
    """
    rng = np.random.default_rng(RANDOM_STATE)
    null = np.empty(rounds)
    for i in range(rounds):
        shuffled = rng.permutation(y_train)
        model = make_pipeline()
        model.fit(X_train, shuffled)
        null[i] = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

    at_least = int((null >= observed).sum())
    return {
        "observed_auc": round(float(observed), 4),
        "null_mean_auc": round(float(null.mean()), 4),
        "null_max_auc": round(float(null.max()), 4),
        "null_sd": round(float(null.std(ddof=1)), 4),
        "rounds": rounds,
        "p_value": round((1 + at_least) / (1 + rounds), 4),
        "beats_null": bool(at_least == 0),
    }


def calibration_quality(y: np.ndarray, prob: np.ndarray, n_bins: int = 10) -> dict:
    """
    Is the probability a probability, or only a ranking?

    Two numbers, and the second is the one that makes the first readable.

    ``brier`` is the mean squared error of the predicted probability. On its
    own it says nothing, because at a 1% base rate a model that ignores its
    inputs and always answers 0.01 scores about 0.0096. Any Brier above that
    is *worse calibrated than a constant*, which is easy to report as a
    success if the reference is left out. So the reference is computed and
    reported beside it.

    ``ece`` is the expected calibration error: bin the predictions, compare
    the mean prediction in each bin against the observed rate, and average the
    gaps weighted by bin size. It separates the two failures Brier confuses,
    since a model can rank perfectly and still be systematically over-confident.

    That is exactly what happens here, and it is a deliberate trade rather
    than a defect. The ranker is fitted with ``class_weight="balanced"`` so
    that 1% of rows are not simply ignored by the boosting, which inflates
    every probability. The game only ever compares contenders *within one
    pool*, where inflation cancels, so ranking is what matters and calibration
    is not. Reporting it anyway is the point: the claim being made is about
    ordering, and the numbers should say which claim is supported.
    """
    base_rate = float(y.mean())
    constant = base_rate * (1 - base_rate) ** 2 + (1 - base_rate) * base_rate**2

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        mask = (prob >= lo) & (prob < hi if hi < 1.0 else prob <= hi)
        if not mask.any():
            continue
        ece += mask.mean() * abs(prob[mask].mean() - y[mask].mean())

    brier = float(np.mean((prob - y) ** 2))
    return {
        "brier": round(brier, 4),
        "brier_constant_baseline": round(float(constant), 4),
        "beats_constant": bool(brier < constant),
        "ece": round(float(ece), 4),
        "base_rate": round(base_rate, 5),
        "mean_predicted": round(float(prob.mean()), 4),
        "note": (
            "Fitted with class_weight='balanced', which inflates probabilities. "
            "Prestige is a within-pool rank, where inflation cancels, so ranking "
            "quality (ROC-AUC) is the supported claim and calibration is not."
        ),
    }


def baseline_margin(
    y: np.ndarray, model_prob: np.ndarray, baseline_prob: np.ndarray, n: int = N_BOOTSTRAP
) -> dict:
    """
    Is the model's lead over the best simple rule real, or within noise?

    "Beats the best baseline by 0.135 AUC" is a point estimate of a
    *difference*, and a difference needs its own interval: two AUCs each with
    a wide interval can overlap enough that the gap is not established. So the
    same bootstrap resamples both scores together, on the same rows, and takes
    the interval of the difference. Paired on purpose: the two models are
    being compared on identical data, and resampling them independently would
    throw away that pairing and widen the interval for no reason.

    The claim is supported when the interval excludes zero.
    """
    rng = np.random.default_rng(RANDOM_STATE)
    diffs = []
    idx = np.arange(len(y))
    for _ in range(n):
        take = rng.choice(idx, size=len(idx), replace=True)
        if len(np.unique(y[take])) < 2:
            continue
        diffs.append(roc_auc_score(y[take], model_prob[take]) - roc_auc_score(y[take], baseline_prob[take]))
    arr = np.sort(np.asarray(diffs))
    return {
        "point": round(float(roc_auc_score(y, model_prob) - roc_auc_score(y, baseline_prob)), 4),
        "ci95": [round(float(arr[int(0.025 * len(arr))]), 4), round(float(arr[int(0.975 * len(arr))]), 4)],
        "resamples": int(len(arr)),
        "excludes_zero": bool(arr[int(0.025 * len(arr))] > 0),
    }


def baseline_comparison(frame: pd.DataFrame, prob: np.ndarray) -> dict:
    """
    The model against the heuristics a person would actually use.

    Each baseline is scored the same way as the model - AUC and average
    precision over the same held-out rows - so the comparison is like for
    like. ``billing`` is negated because 1 means top-billed: a lower number
    should score higher.
    """
    y = frame["won"].to_numpy(dtype=bool)
    candidates = {
        "model": prob,
        "acclaim (IMDb rating percentile)": frame["audience"],
        "popularity (vote count percentile)": frame["popularity"],
        "top billing": -pd.to_numeric(frame["billing"], errors="coerce").fillna(99),
        "prior Oscar nominations": frame["prior_nominations"],
    }
    out = {}
    for name, score in candidates.items():
        values = pd.to_numeric(pd.Series(score, index=frame.index), errors="coerce")
        present = values.notna()
        if present.sum() < 100 or y[present.to_numpy()].sum() == 0:
            continue
        out[name] = {
            "roc_auc": round(float(roc_auc_score(y[present.to_numpy()], values[present])), 4),
            "average_precision": round(
                float(average_precision_score(y[present.to_numpy()], values[present])), 4
            ),
            "n": int(present.sum()),
        }
    return out


def run(rounds: int = N_PERMUTATIONS) -> dict:
    ensure_dirs()
    started = time.time()
    contenders, films = load_seed()

    # Six real awards only; the genre crowns are circular (module docstring).
    academy = _academy_only(contenders)
    contenders = contenders[academy].reset_index(drop=True)
    X = build_contender_features(contenders, films)
    y = contenders["won"].to_numpy(dtype=bool)

    train = (contenders["year"] < TEST_FROM_YEAR).to_numpy()
    test = ~train

    model = make_pipeline()
    model.fit(X[train], y[train])
    prob = model.predict_proba(X[test])[:, 1]

    print(f"academy-only rows: {len(contenders):,}  winners: {int(y.sum())}")
    print(f"train {int(train.sum()):,} / test {int(test.sum()):,}")

    print("\nleakage audit ...")
    audit = leakage_audit(X, y)
    print(f"  strongest single feature: {audit['strongest'][0]}")
    print(f"  clean: {audit['clean']}")

    print("\nbootstrapping the held-out AUC ...")
    interval = bootstrap_auc(y[test], prob)
    print(f"  AUC {interval['point']} 95% CI {interval['ci95']}")

    print(f"\npermutation test ({rounds} retrains on shuffled labels) ...")
    permutation = permutation_test(X[train], y[train], X[test], y[test], interval["point"], rounds)
    print(
        f"  null AUC {permutation['null_mean_auc']} +/- {permutation['null_sd']}, "
        f"max {permutation['null_max_auc']}, p = {permutation['p_value']}"
    )

    print("\nbaselines ...")
    baselines = baseline_comparison(contenders[test].assign(**X[test]), prob)
    for name, stats in sorted(baselines.items(), key=lambda kv: -kv[1]["roc_auc"]):
        print(f"  {name:36s} AUC {stats['roc_auc']:.3f}  AP {stats['average_precision']:.3f}")

    report = {
        "scope": "six Academy categories only; genre crowns excluded as circular",
        "n_rows": int(len(contenders)),
        "n_winners": int(y.sum()),
        "split": {"train_below": TEST_FROM_YEAR, "n_train": int(train.sum()), "n_test": int(test.sum())},
        "leakage_audit": audit,
        "held_out_auc": interval,
        "permutation_test": permutation,
        "baselines": baselines,
        "duration_seconds": round(time.time() - started, 1),
    }
    # Is the probability a probability, or only a ranking? Reported with the
    # constant-predictor reference, without which a Brier is unreadable.
    report["calibration"] = calibration_quality(y[test], prob)
    print(
        f"\ncalibration: Brier {report['calibration']['brier']} against "
        f"{report['calibration']['brier_constant_baseline']} for a constant, "
        f"ECE {report['calibration']['ece']}"
    )

    named = {k: v for k, v in baselines.items() if k != "model"}
    best_name = max(named, key=lambda k: named[k]["roc_auc"]) if named else None
    best_baseline = named[best_name]["roc_auc"] if best_name else 0.0
    report["beats_best_baseline_by"] = round(interval["point"] - best_baseline, 4)

    # And is that lead real, or inside the noise? A difference needs its own
    # interval; two AUCs with overlapping intervals can still differ reliably,
    # and two that look far apart can fail to. Paired on the same resamples.
    if best_name:
        frame_test = contenders[test].assign(**X[test])
        best_scores = pd.to_numeric(
            {
                "acclaim (IMDb rating percentile)": frame_test["audience"],
                "popularity (vote count percentile)": frame_test["popularity"],
                "top billing": -pd.to_numeric(frame_test["billing"], errors="coerce").fillna(99),
                "prior Oscar nominations": frame_test["prior_nominations"],
            }[best_name],
            errors="coerce",
        )
        ok = best_scores.notna().to_numpy()
        report["margin_over_best_baseline"] = {
            "baseline": best_name,
            **baseline_margin(y[test][ok], prob[ok], best_scores[ok].to_numpy()),
        }
        m = report["margin_over_best_baseline"]
        print(
            f"margin over {best_name}: {m['point']:+.4f} AUC, "
            f"95% CI {m['ci95']}, excludes zero: {m['excludes_zero']}"
        )

    # The verdict now requires the *interval* on the margin to exclude zero,
    # not merely a positive point estimate. A lead that could be noise is not
    # a lead, and the earlier version would have called one confirmed.
    margin_real = report.get("margin_over_best_baseline", {}).get("excludes_zero", False)
    report["verdict"] = (
        "signal confirmed"
        if audit["clean"] and permutation["p_value"] < 0.05 and margin_real
        else "NOT PROVEN"
    )

    path = MODELS_DIR / "validation.json"
    path.write_text(json.dumps(report, indent=2))
    print(f"\nverdict: {report['verdict']}   (wrote {path.name})")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--permutations", type=int, default=N_PERMUTATIONS)
    args = parser.parse_args(argv)
    report = run(args.permutations)
    return 0 if report["verdict"] == "signal confirmed" else 1


if __name__ == "__main__":
    sys.exit(main())
