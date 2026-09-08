"""
The scheduled refresh (``python -m pipeline.refresh``): one unattended pass.

Usage (from ``backend/``)::

    python -m pipeline.refresh                 # daily: enrich within budget
    python -m pipeline.refresh --rebuild       # weekly: re-download IMDb first
    python -m pipeline.refresh --report out.json

Architecture note
-----------------
This is the entry point ``.github/workflows/refresh-data.yml`` calls. It does
the whole job in the order that keeps the committed data coherent, and it is
safe to run twice in one day.

    (--rebuild only)  download  →  build_seed
                                       │  emits empty enrichment columns
                      replay the cache ─┘  restores every past fetch, 0 requests
                      spend today's budget, newest films first
                      retrain the models if the catalog changed
                      validate, then report

Two ordering decisions carry the design.

**Replay before fetch.** ``build_seed`` writes ``films.parquet`` from scratch
with blank enrichment columns, so a rebuild would otherwise throw away months
of API calls. Every response is on disk in the cache, so replaying it costs
nothing and restores the lot before a single new request is made.

**Retrain only when the catalog moved.** The ranker and the clustering are
functions of the seed. Enriching 1,000 films changes their inputs, so the
models are refit and the archetype labels rewritten; a no-op day skips it and
leaves the committed artifacts untouched, which keeps the daily diff empty
and honest.

The season constants are deliberately *not* re-derived here. They are a game
balance decision that must be reviewed by a person against
``python -m app.engine.calibrate`` (see docs/BALANCE.md), so this job reports
when the data has drifted far enough to warrant that rather than silently
retuning the game overnight.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from pipeline import enrich
from pipeline.budget import Budget
from pipeline.paths import REPO_ROOT, SEED_DIR, ensure_dirs

FILMS = SEED_DIR / "films.parquet"

# Enrichment moving a column's coverage *up* by more than this in one pass is
# worth a human looking at the balance constants, since the scorer's weights
# were calibrated against a particular coverage level (docs/BALANCE.md).
DRIFT_ALERT = 0.05

# A coverage *drop* this large means data was lost, not gained. Nothing
# legitimate removes a poster from thousands of films at once, so this fails
# the run rather than committing the damage. It exists because a scheduled
# rebuild on a runner with a cold response cache once published a catalog with
# 0.1% poster coverage; the enrichment table now prevents the cause, and this
# check prevents the symptom ever shipping again.
COVERAGE_LOSS_FATAL = 0.02


def _run_module(module: str, *args: str) -> None:
    """Run one pipeline/ml module in-process-adjacent, failing loudly."""
    command = [sys.executable, "-m", module, *args]
    print(f"\n$ {' '.join(command[2:])}", flush=True)
    subprocess.run(command, check=True, cwd=Path(__file__).resolve().parents[1])


def _snapshot() -> dict:
    """Coverage and row counts, used to decide whether anything actually moved."""
    if not FILMS.exists():
        return {}
    films = pd.read_parquet(FILMS)
    return {"films": len(films), "coverage": enrich.coverage(films)}


def refresh(rebuild: bool, limit: int | None, sleep: float, retrain: bool = True) -> dict:
    """Run one full pass and return a JSON-serialisable report."""
    ensure_dirs()
    started = time.time()
    before = _snapshot()

    report: dict = {
        "started_at": datetime.now(UTC).isoformat(),
        "rebuild": rebuild,
        "before": before,
    }

    # 1. Optionally rebuild the catalog from freshly downloaded IMDb data.
    #    This is what picks up new releases and the latest ceremony's results.
    if rebuild:
        _run_module("pipeline.download")
        _run_module("pipeline.build_seed")
        # The people layer is derived from the rebuilt contenders, so it has
        # to follow build_seed or the side modes would index a stale cast.
        _run_module("pipeline.people_graph")

    # 2. Replay the cache first so a rebuild does not lose past enrichment,
    #    then spend whatever today's budget allows on the newest gaps.
    print("\n$ enrich (replay cache, then spend today's budget)", flush=True)
    summary = enrich.run(use_tmdb=True, use_omdb=True, limit=limit, sleep=sleep)
    report["enrichment"] = summary
    report["restored"] = summary.get("restored_from_table", 0)

    after = _snapshot()
    report["after"] = after

    # 3. The models are functions of the seed, so refit them only when the
    #    seed actually changed. A quiet day should produce an empty diff.
    fetched = sum(p.get("fetched", 0) for p in summary.get("providers", {}).values())
    catalog_changed = rebuild or fetched > 0 or before.get("films") != after.get("films")
    report["catalog_changed"] = catalog_changed
    if catalog_changed and retrain:
        _run_module("ml.train_ranker")
        _run_module("ml.cluster")
        # Casting types feed the Recast shortlists and depend on the actor
        # table, so they are refit whenever that table could have moved.
        _run_module("ml.actors")
        # The box-office estimator's group medians move with every new
        # measurement, so its accuracy is re-measured on every pass. It is
        # cheap - no model retraining, just five holdout folds.
        _run_module("pipeline.boxoffice", "--validate")
        # The adversarial validation retrains the pipeline once per
        # permutation, so it runs on rebuild days rather than daily. Skipping
        # it on a quiet day is safe: its claim is about the model, and the
        # model only changes when the catalog does.
        if rebuild:
            _run_module("ml.validate")
    report["retrained"] = bool(catalog_changed and retrain)

    # 4. Compare coverage. A rise worth reviewing is an alert; a fall is a
    #    failure, because enrichment only ever adds.
    alerts, losses = _drift(before.get("coverage", {}), after.get("coverage", {}))
    report["drift_alerts"] = alerts
    report["coverage_losses"] = losses

    report["problems"] = summary.get("problems", []) + losses
    report["budgets"] = {p: str(Budget.load(p)) for p in ("tmdb", "omdb")}
    report["duration_seconds"] = round(time.time() - started, 1)
    report["ok"] = not report["problems"]
    return report


def _drift(before: dict[str, float], after: dict[str, float]) -> tuple[list[str], list[str]]:
    """
    Compare coverage before and after, returning ``(alerts, losses)``.

    Alerts are informational: coverage climbed enough that the balance
    constants deserve a re-check. Losses are fatal: enrichment only ever adds
    data, so a column that shrank means something upstream destroyed it.
    """
    alerts: list[str] = []
    losses: list[str] = []
    for column, new in after.items():
        old = before.get(column)
        if old is None:
            continue
        change = new - old
        if change <= -COVERAGE_LOSS_FATAL:
            losses.append(
                f"{column} coverage FELL {old:.1%} -> {new:.1%}: enrichment never "
                "removes data, so this run lost some. Refusing to publish it."
            )
        elif change >= DRIFT_ALERT:
            alerts.append(
                f"{column} coverage rose {old:.1%} -> {new:.1%}; "
                "re-check the season constants with `python -m app.engine.calibrate`"
            )
    return alerts, losses


def render(report: dict) -> str:
    """A short human summary. This is what lands in the workflow's job log."""
    lines = ["", "=" * 62, "Refresh report", "=" * 62]
    lines.append(f"rebuild: {report['rebuild']}   retrained: {report['retrained']}")
    for provider, stats in report.get("enrichment", {}).get("providers", {}).items():
        lines.append(
            f"{provider}: fetched {stats['fetched']} "
            f"(ok {stats['ok']}, absent {stats['absent']}, error {stats['error']}), "
            f"{stats['remaining']} requests left today"
        )
    lines.append("")
    before = report.get("before", {}).get("coverage", {})
    lines.append(f"{'column':16s} {'before':>8} {'after':>8}")
    for column, value in report.get("after", {}).get("coverage", {}).items():
        was = before.get(column)
        lines.append(f"{column:16s} {was if was is None else f'{was:7.1%}'!s:>8} {value:7.1%}")
    if report.get("restored"):
        lines.append(f"restored {report['restored']} value(s) from the committed table")
    for alert in report.get("drift_alerts", []):
        lines.append(f"\n!! {alert}")
    for problem in report.get("problems", []):
        lines.append(f"\n!! {problem}")
    lines.append("")
    lines.append(f"{'OK' if report['ok'] else 'PROBLEMS FOUND'} in {report['duration_seconds']}s")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="re-download IMDb and rebuild the seed first (weekly; ~1.4 GB)",
    )
    parser.add_argument("--limit", type=int, default=None, help="cap films per provider this run")
    parser.add_argument("--sleep", type=float, default=0.05)
    parser.add_argument("--no-retrain", action="store_true", help="skip the ML refit")
    parser.add_argument("--report", type=Path, default=None, help="write the JSON report here")
    args = parser.parse_args(argv)

    report = refresh(args.rebuild, args.limit, args.sleep, retrain=not args.no_retrain)
    print(render(report))

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
        # The report may legitimately be written outside the repo (a CI
        # scratch dir), so relative_to would raise; show it when we can.
        try:
            shown = args.report.relative_to(REPO_ROOT)
        except ValueError:
            shown = args.report
        print(f"\nreport written to {shown}")

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
