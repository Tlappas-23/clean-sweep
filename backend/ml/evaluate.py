"""
Print the ML artifacts as human-readable tables plus a few sanity checks.

Usage (from ``backend/``)::

    python -m ml.evaluate

Architecture note
-----------------
This script trains nothing. It reads what ``train_ranker`` and ``cluster``
wrote (``data/models/*.json`` and ``data/seed/ml_scores.parquet``) and
renders them the way the analytics page will, so a reviewer can check the
numbers without starting the API. The three "sanity examples" at the end
join the model's prestige score back to the real Oscar outcome for famous
pools - the fastest way to see whether the ranker behaves like a pundit or
like a random number generator.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import pandas as pd

from ml.features import load_seed
from ml.paths import CLUSTER_SUMMARY_PATH, ML_SCORES_PATH, RANKER_METRICS_PATH

# (year, category) pools shown at the end. Chosen because most film fans know
# the answer: Forrest Gump (1994), Daniel Day-Lewis (2007), Renée Zellweger (2019).
SANITY_POOLS: tuple[tuple[int, str], ...] = ((1994, "picture"), (2007, "actor"), (2019, "actress"))
TOP_N = 5


# ---------------------------------------------------------------- printing
def table(rows: Sequence[Sequence[object]], headers: Sequence[str]) -> str:
    """Minimal fixed-width table renderer (no third-party dependency)."""
    cells = [[str(h) for h in headers]] + [[_fmt(v) for v in r] for r in rows]
    widths = [max(len(row[i]) for row in cells) for i in range(len(headers))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(row, widths, strict=True)) for row in cells]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)


def _fmt(v: object) -> str:
    if isinstance(v, bool):
        return "yes" if v else "-"
    if isinstance(v, float):
        return f"{v:.4f}" if abs(v) < 1 else f"{v:,.2f}"
    return str(v)


def section(title: str) -> None:
    print(f"\n{title}\n{'=' * len(title)}")


# ------------------------------------------------------------------ ranker
def print_ranker() -> None:
    m = json.loads(RANKER_METRICS_PATH.read_text())
    section(f"Prestige ranker - {m['model']}")
    split = m.get("split", {})
    if split:
        print(
            f"temporal split: train {split['train_years'][0]}-{split['train_years'][1]} "
            f"({m['metrics']['n_train']:,} rows, {split.get('positives_train', '?')} winners) | "
            f"test {split['test_years'][0]}-{split['test_years'][1]} "
            f"({m['metrics']['n_test']:,} rows, {split.get('positives_test', '?')} winners)"
        )

    rows = [
        ["winner (primary)", *_metric_row(m["metrics"], m.get("ranking", {}))],
    ]
    nom = m.get("nominee_task")
    if nom:
        rows.append(["nominee (secondary)", *_metric_row(nom, nom.get("ranking", {}))])
    print()
    print(table(rows, ["task", "ROC-AUC", "avg precision", "Brier", "MRR", "hit@1", "hit@5", "P@5", "pools"]))

    section("Permutation importances (test set, drop in ROC-AUC)")
    rows = [[f["feature"], f["importance"]] for f in m["feature_importances"]]
    print(table(rows, ["feature", "importance"]))

    section("Calibration (10 equal-width bins on P(win))")
    print(
        table(
            [[c["bin_mean_pred"], c["bin_frac_pos"], c["count"]] for c in m["calibration"]],
            ["mean predicted", "observed win rate", "count"],
        )
    )
    print(
        "\nNote: class_weight='balanced' inflates probabilities on purpose; the game only uses\n"
        "the ordering inside each (year, category) pool, so calibration is informational."
    )


def _metric_row(metrics: dict, ranking: dict) -> list[object]:
    return [
        metrics["roc_auc"],
        metrics["average_precision"],
        metrics["brier"],
        ranking.get("mrr", float("nan")),
        ranking.get("hit_at_1", float("nan")),
        ranking.get("hit_at_5", float("nan")),
        ranking.get("precision_at_5", float("nan")),
        ranking.get("n_pools", 0),
    ]


# ---------------------------------------------------------------- clusters
def print_clusters() -> None:
    c = json.loads(CLUSTER_SUMMARY_PATH.read_text())
    section(f"Film archetypes - KMeans, k={c.get('k', len(c['archetypes']))}")
    if "silhouette" in c:
        print("silhouette by k: " + ", ".join(f"{k}: {v:.4f}" for k, v in c["silhouette"].items()))
    key_feats = [f for f in ("imdb_rating", "log_votes", "runtime_minutes", "year") if f in c["features"]]
    rows = []
    for a in c["archetypes"]:
        rows.append([a["label"], a["size"], *[a["centroid"].get(f, float("nan")) for f in key_feats]])
    print()
    print(table(rows, ["archetype", "films", *key_feats]))
    print()
    for a in c["archetypes"]:
        print(f"  {a['label']:<18} e.g. {', '.join(a['examples'])}")
    print(f"\n{len(c['points'])} scatter points, {len(c['features'])} features")


# ------------------------------------------------------------ sanity check
def print_sanity_examples() -> None:
    contenders, films = load_seed()
    scores = pd.read_parquet(ML_SCORES_PATH)
    df = contenders.merge(scores, on="contender_id", how="left").merge(
        films[["film_id", "title"]], on="film_id", how="left"
    )
    for year, category in SANITY_POOLS:
        pool = df[(df["year"] == year) & (df["category"] == category)]
        section(f"Top {TOP_N} prestige - {category.replace('_', ' ')} {year} ({len(pool)} in pool)")
        top = pool.sort_values("prestige", ascending=False).head(TOP_N)
        rows = [
            [
                r.person_name if isinstance(r.person_name, str) else "",
                r.title,
                r.archetype,
                float(r.prestige),
                bool(r.nominated),
                bool(r.won),
            ]
            for r in top.itertuples(index=False)
        ]
        print(table(rows, ["person", "film", "archetype", "prestige", "nominated", "won"]))
        winner = pool[pool["won"]]
        if not winner.empty and not winner["contender_id"].isin(top["contender_id"]).any():
            w = winner.iloc[0]
            rank = int((pool["prestige"] > w["prestige"]).sum()) + 1
            name = w["person_name"] or w["title"]
            print(f"  actual winner: {name} - prestige {w['prestige']:.1f}, rank {rank}")


def main() -> None:
    print_ranker()
    print_clusters()
    print_sanity_examples()


if __name__ == "__main__":
    main()
