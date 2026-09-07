"""
Train and evaluate the prestige ranker, then score every contender.

Usage (from ``backend/``)::

    python -m ml.train_ranker

Architecture note
-----------------
The ranker answers "how much does this contender look like an Academy Award
winner, judging only from things known without the Oscar result?". It is a
learning-to-rank problem framed as binary classification: the label is
``won`` and the model's probability is only ever used to *order* contenders
inside a (year, category) pool. The final ``prestige`` metric is that
within-pool ordering rescaled to 0-100 (see ``ml.scores``).

Why this model
--------------
``HistGradientBoostingClassifier`` because (a) it handles NaN natively -
half of the feature set is nullable until the optional enrichment step has
run, and Best Picture rows have no billing; (b) it is a strong tabular
baseline that captures interactions such as "top-billed *and* previously
nominated *and* in a drama"; (c) it trains in seconds on ~70k rows, which
keeps the whole ML step re-runnable in CI. Class imbalance (≈0.85% positives)
is handled with ``class_weight="balanced"`` so the boosting rounds are not
dominated by the negatives.

Why a temporal split
--------------------
Train on film years <= 2018, test on 2019+. A random split would put 2019
contenders in the training set while other 2019 contenders are in the test
set; the within-pool metrics (acclaim, popularity) and the era effects
would let the model "peek" at the test years. The temporal split mimics how
the model would actually be used - predicting a ceremony that has not
happened yet - and is the honest estimate of generalisation.

Why out-of-fold scores for prestige
-----------------------------------
After evaluation the model is refitted on *all* years to score the catalogue.
Scoring the training rows with the model that saw their labels would let it
partially memorise the winners (boosting can fit rare positives closely),
which would inflate ``prestige`` for actual winners and quietly turn the
game's "learned" metric into the ground-truth Academy metric. Instead each
year's prestige comes from a model that never saw that year: a 5-fold
``GroupKFold`` grouped by year. The full-data model is still saved as the
artifact for feature importances and for scoring future years.

Outputs
-------
``data/models/ranker.joblib``          fitted pipeline + feature metadata
``data/models/ranker_metrics.json``    RankerSummary (docs/API.md) + extras
``data/seed/ml_scores.parquet``        ``prestige`` column (via ``ml.scores``)
"""

from __future__ import annotations

import json
import time
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

from ml import RANDOM_STATE
from ml.features import (
    CONTENDER_CATEGORICAL,
    NullColumnGuard,
    assert_no_leakage,
    build_contender_features,
    load_seed,
    top_genres,
)
from ml.paths import RANKER_METRICS_PATH, RANKER_MODEL_PATH, ensure_dirs
from ml.scores import percentile_within_pool, update_scores

MODEL_NAME = "HistGradientBoostingClassifier"
TEST_FROM_YEAR = 2019  # first film year in the held-out test set
N_CALIBRATION_BINS = 10
N_IMPORTANCE_FEATURES = 15
N_OOF_FOLDS = 5

# Categories whose answer key is derived from the data rather than awarded by
# the Academy (see ``pipeline.crowns``). Their metrics are reported separately
# so they cannot quietly inflate the headline number.
GENRE_CATEGORIES = ("horror", "comedy")


# ------------------------------------------------------------------ model
def make_pipeline() -> Pipeline:
    """
    Preprocessing + model.

    The only non-numeric feature is ``category``; it is ordinal-encoded and
    then flagged as categorical for the boosting model, which learns proper
    per-category splits instead of treating the codes as ordered. Everything
    else passes through untouched: trees are invariant to monotone scaling,
    and NaN is a first-class value for HistGradientBoosting.
    """
    preprocess = ColumnTransformer(
        [
            (
                "category",
                OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1),
                list(CONTENDER_CATEGORICAL),
            )
        ],
        remainder="passthrough",
        verbose_feature_names_out=False,
    ).set_output(transform="pandas")
    model = HistGradientBoostingClassifier(
        categorical_features=list(CONTENDER_CATEGORICAL),
        class_weight="balanced",
        # Deliberately small trees: there are only ~540 winners in the training
        # years, so wide leaves and a short boosting budget stop the ensemble
        # carving out individual winners (checked on the temporal split: the
        # shallow setting beats 31-leaf / 300-round trees on AUC and hit@5).
        learning_rate=0.05,
        max_iter=150,
        max_leaf_nodes=15,
        min_samples_leaf=100,
        l2_regularization=1.0,
        early_stopping=False,  # fixed budget -> fully deterministic, no random validation split
        random_state=RANDOM_STATE,
    )
    return Pipeline([("preprocess", preprocess), ("null_guard", NullColumnGuard()), ("model", model)])


# ---------------------------------------------------------------- metrics
def calibration_table(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int) -> list[dict[str, float]]:
    """Equal-width probability bins with mean prediction, empirical positive rate and count."""
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(y_prob, edges[1:-1]), 0, n_bins - 1)
    rows = []
    for b in range(n_bins):
        mask = idx == b
        if not mask.any():
            continue
        rows.append(
            {
                "bin_mean_pred": float(y_prob[mask].mean()),
                "bin_frac_pos": float(y_true[mask].mean()),
                "count": int(mask.sum()),
            }
        )
    return rows


def pool_ranking_metrics(pools: pd.DataFrame, score_col: str, label_col: str) -> dict[str, float | int]:
    """
    Within-pool ranking quality.

    For every (year, category) pool in ``pools`` that contains at least one
    positive, sort the pool by the model score and record the rank of the
    best-ranked positive. Reported as MRR (mean of 1/rank), hit@1, hit@5 and
    precision@5 (share of the top five that are positives - mostly useful for
    the nominee task where each pool has ~5 positives).
    """
    ranks: list[float] = []
    prec5: list[float] = []
    for _, pool in pools.groupby(["year", "category"], sort=False):
        labels = pool[label_col].to_numpy(dtype=bool)
        if not labels.any():
            continue
        # "min" ranking: tied scores share the best rank, so a tie never
        # silently helps the model.
        r = pool[score_col].rank(ascending=False, method="min").to_numpy()
        ranks.append(float(r[labels].min()))
        top5 = np.argsort(-pool[score_col].to_numpy(), kind="stable")[:5]
        prec5.append(float(labels[top5].mean()))
    arr = np.asarray(ranks)
    return {
        "mrr": float(np.mean(1.0 / arr)),
        "hit_at_1": float(np.mean(arr <= 1)),
        "hit_at_5": float(np.mean(arr <= 5)),
        "precision_at_5": float(np.mean(prec5)),
        "n_pools": int(len(arr)),
    }


def evaluate_task(
    label: str,
    frame: pd.DataFrame,
    X: pd.DataFrame,
    train_mask: np.ndarray,
    test_mask: np.ndarray,
) -> tuple[Pipeline, dict[str, Any], np.ndarray]:
    """Fit on the train years, score the test years, return (model, metrics, test probabilities)."""
    y = frame[label].to_numpy(dtype=bool)
    pipe = make_pipeline()
    pipe.fit(X[train_mask], y[train_mask])
    prob = pipe.predict_proba(X[test_mask])[:, 1]
    y_test = y[test_mask]

    pools = frame.loc[test_mask, ["year", "category", label]].copy()
    pools["score"] = prob
    metrics = {
        "roc_auc": float(roc_auc_score(y_test, prob)),
        "average_precision": float(average_precision_score(y_test, prob)),
        # Brier is reported for transparency; with balanced class weights the
        # probabilities are deliberately inflated (see calibration), which the
        # game does not care about because prestige is a within-pool rank.
        "brier": float(brier_score_loss(y_test, prob)),
        "n_train": int(train_mask.sum()),
        "n_test": int(test_mask.sum()),
        "positives_train": int(y[train_mask].sum()),
        "positives_test": int(y_test.sum()),
        "ranking": pool_ranking_metrics(pools, "score", label),
    }
    return pipe, metrics, prob


def metrics_by_category_group(
    contenders: pd.DataFrame, test_mask: np.ndarray, prob: np.ndarray
) -> dict[str, dict]:
    """
    Split the held-out metrics into the six real awards and the two derived ones.

    This matters for honesty. Best Horror and Best Comedy are scored against a
    "genre crown" that ``pipeline.crowns`` computes from rating and vote count
    - both of which are model features - so the model predicts those two
    categories almost perfectly and drags the headline number up with them.
    The Academy figure is the one that says whether the model has learnt
    anything about the Academy, and it is the one quoted in the docs.
    """
    frame = contenders.loc[test_mask, ["year", "category", "won"]].copy()
    frame["score"] = prob
    is_genre = frame["category"].isin(GENRE_CATEGORIES)

    out: dict[str, dict] = {}
    for name, mask in (("academy", ~is_genre), ("genre_crown", is_genre)):
        subset = frame[mask]
        if subset["won"].nunique() < 2:  # pragma: no cover - needs a degenerate split
            continue
        out[name] = {
            "n_test": int(len(subset)),
            "positives_test": int(subset["won"].sum()),
            "roc_auc": float(roc_auc_score(subset["won"], subset["score"])),
            "average_precision": float(average_precision_score(subset["won"], subset["score"])),
            "ranking": pool_ranking_metrics(subset, "score", "won"),
        }
    return out


def permutation_importances(pipe: Pipeline, X_test: pd.DataFrame, y_test: np.ndarray) -> list[dict]:
    """
    Model-agnostic importances on the *test* set.

    Permutation importance (drop in ROC-AUC when one column is shuffled) is
    preferred over the model's internal split gains because it is measured on
    held-out data, so a feature that only helps memorise the training years
    scores zero rather than high.
    """
    result = permutation_importance(
        pipe, X_test, y_test, scoring="roc_auc", n_repeats=5, random_state=RANDOM_STATE, n_jobs=1
    )
    ranked = sorted(zip(X_test.columns, result.importances_mean, strict=True), key=lambda t: -t[1])
    return [{"feature": f, "importance": float(v)} for f, v in ranked[:N_IMPORTANCE_FEATURES]]


# ---------------------------------------------------------------- scoring
def out_of_fold_probabilities(X: pd.DataFrame, y: np.ndarray, years: np.ndarray) -> np.ndarray:
    """P(win) for every row from a model that never saw that row's film year."""
    oof = np.full(len(X), np.nan)
    template = make_pipeline()
    for fold, (tr, te) in enumerate(GroupKFold(n_splits=N_OOF_FOLDS).split(X, y, groups=years), start=1):
        model = clone(template).fit(X.iloc[tr], y[tr])
        oof[te] = model.predict_proba(X.iloc[te])[:, 1]
        print(f"  fold {fold}/{N_OOF_FOLDS}: held out {len(np.unique(years[te]))} years, {len(te):,} rows")
    assert not np.isnan(oof).any()
    return oof


# ------------------------------------------------------------------- main
def main() -> None:
    ensure_dirs()
    t0 = time.time()
    contenders, films = load_seed()
    genres = top_genres(films)
    X = build_contender_features(contenders, films, genres)
    assert_no_leakage(X.columns)
    years = contenders["year"].to_numpy()
    train_mask = years < TEST_FROM_YEAR
    test_mask = ~train_mask
    print(
        f"features: {X.shape[1]} columns, {len(X):,} rows | train years <= {TEST_FROM_YEAR - 1} "
        f"({train_mask.sum():,} rows), test years >= {TEST_FROM_YEAR} ({test_mask.sum():,} rows)"
    )

    # ---- primary task: winner vs field
    print("training winner model on temporal split ...")
    win_model, win_metrics, win_prob = evaluate_task("won", contenders, X, train_mask, test_mask)
    y_test = contenders.loc[test_mask, "won"].to_numpy(dtype=bool)
    print(
        f"  ROC-AUC {win_metrics['roc_auc']:.3f}  AP {win_metrics['average_precision']:.3f}  "
        f"Brier {win_metrics['brier']:.4f}  MRR {win_metrics['ranking']['mrr']:.3f}  "
        f"hit@5 {win_metrics['ranking']['hit_at_5']:.3f}"
    )
    print("permutation importances on the test set ...")
    by_group = metrics_by_category_group(contenders, test_mask, win_prob)
    for name, group in by_group.items():
        print(
            f"    {name:<12} ROC-AUC {group['roc_auc']:.3f}  "
            f"AP {group['average_precision']:.3f}  "
            f"hit@1 {group['ranking']['hit_at_1']:.3f}  "
            f"({group['positives_test']} winners in {group['n_test']:,} rows)"
        )

    importances = permutation_importances(win_model, X[test_mask], y_test)

    # ---- secondary task: nominee vs field (same split, same architecture)
    print("training nominee model on temporal split ...")
    _, nom_metrics, _ = evaluate_task("nominated", contenders, X, train_mask, test_mask)
    print(
        f"  ROC-AUC {nom_metrics['roc_auc']:.3f}  AP {nom_metrics['average_precision']:.3f}  "
        f"P@5 {nom_metrics['ranking']['precision_at_5']:.3f}"
    )

    # ---- out-of-fold prestige for the whole catalogue
    print(f"scoring catalogue with {N_OOF_FOLDS}-fold out-of-year predictions ...")
    y_all = contenders["won"].to_numpy(dtype=bool)
    oof = out_of_fold_probabilities(X, y_all, years)
    scored = contenders[["contender_id", "year", "category"]].copy()
    scored["p_win"] = oof
    scored["prestige"] = percentile_within_pool(scored, "p_win")
    update_scores(scored["contender_id"], scored.set_index("contender_id")[["prestige"]])

    # ---- final artifact: refit on every year
    print("refitting on all years for the saved artifact ...")
    final_model = make_pipeline().fit(X, y_all)
    joblib.dump(
        {
            "model_name": MODEL_NAME,
            "pipeline": final_model,
            "feature_columns": list(X.columns),
            "genres": genres,
            "label": "won",
            "trained_years": [int(years.min()), int(years.max())],
            "random_state": RANDOM_STATE,
        },
        RANKER_MODEL_PATH,
    )

    # ---- metrics json (RankerSummary shape first, extras after)
    ranking = win_metrics.pop("ranking")
    summary = {
        "model": MODEL_NAME,
        "metrics": {
            k: win_metrics[k] for k in ("roc_auc", "average_precision", "brier", "n_train", "n_test")
        },
        "feature_importances": importances,
        "calibration": calibration_table(y_test, win_prob, N_CALIBRATION_BINS),
        "by_category_group": by_group,
        "ranking": ranking,
        "nominee_task": nom_metrics,
        "split": {
            "strategy": "temporal",
            "train_years": [int(years[train_mask].min()), int(years[train_mask].max())],
            "test_years": [int(years[test_mask].min()), int(years[test_mask].max())],
            "positives_train": win_metrics["positives_train"],
            "positives_test": win_metrics["positives_test"],
        },
        "prestige": {
            "method": f"{N_OOF_FOLDS}-fold GroupKFold by year, percentile of P(win) within (year, category)",
            "n_scored": int(len(scored)),
        },
        "features": list(X.columns),
    }
    RANKER_METRICS_PATH.write_text(json.dumps(summary, indent=2) + "\n")
    print(
        f"wrote {RANKER_MODEL_PATH.name}, {RANKER_METRICS_PATH.name}, "
        f"ml_scores.parquet in {time.time() - t0:.1f}s"
    )


if __name__ == "__main__":
    main()
