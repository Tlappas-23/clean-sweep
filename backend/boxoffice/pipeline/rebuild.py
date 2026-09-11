"""
One command that rebuilds everything, in the only order that is correct.

The pipeline is a dependency graph, and most of its edges are invisible in the
module names. `pedigree` and `extras` read `features.parquet`, so they have to
run *after* `build_features`, and rebuilding the matrix without re-running them
leaves a v2 file whose Oscar columns describe a different set of films.
`merge_domestic` has to run after both domestic fetchers or it merges one
source into an empty frame. `export_artifact` refuses to run unless
`predict` has already measured the accuracy it quotes.

Every one of those has been got wrong at least once by running a module on its
own, which is why the order lives in code rather than in a README:

    fetch*            network. TMDB discovery and detail, per release year.
      |
    build_features    the 35-column matrix. Everything below reads it.
      |
      +-- pedigree ---+
      +-- extras -----+-- assemble        the 48-column v2 matrix
      |
      +-- synopsis                        pre-release logline per film
      |
      +-- fetch_domestic --+
      +-- fetch_wikidata --+-- merge_domestic   the breakout target
      |
      +-- ablate / bakeoff / prestige / text    the studies
      +-- splits / significance                 the breakout, and the p-values
      |
      +-- predict ----------- export_artifact   what the API serves
      |
      +-- charts                                the figures

Network stages are opt-in. A rebuild after new films land wants them; a rebuild
after a code change does not, and running them by reflex spends quota to
re-derive files that are already on disk.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

# (module, needs the network, one-line description)
STAGES: list[tuple[str, bool, str]] = [
    ("pipeline.build_features", False, "assemble the 35-column feature matrix"),
    ("pipeline.pedigree",       False, "Oscar record of the people, as of release"),
    ("pipeline.extras",         False, "competition, franchise gap, director recency"),
    ("pipeline.assemble",       False, "join those into the v2 matrix"),
    ("pipeline.synopsis",       True,  "pre-release logline per film"),
    ("pipeline.fetch_domestic", True,  "domestic gross from OMDb"),
    ("pipeline.fetch_wikidata", True,  "domestic gross from Wikidata"),
    ("pipeline.merge_domestic", False, "reconcile the two domestic sources"),
    ("model.ablate",            False, "what each feature group buys"),
    ("model.bakeoff",           False, "which learner"),
    ("model.prestige",          False, "whether Oscar pedigree predicts revenue"),
    ("model.splits",            False, "the domestic / international / worldwide breakout"),
    ("model.significance",      False, "which differences survive a paired test"),
    ("model.text",              False, "whether the synopsis predicts revenue"),
    ("pipeline.career",         False, "career structure from the history dates"),
    ("model.career_test",       False, "whether career structure predicts revenue"),
    ("model.outcome_clusters",  False, "whether box office falls into natural kinds"),
    ("model.classify",          False, "the outcome classifier, calibrated in-fold"),
    ("model.classify_significance", False, "whether it beats the tier prior, per tier"),
    ("model.predict",           False, "out-of-fold projections and accuracy"),
    ("model.export_artifact",   False, "the JSON the API serves"),
    ("reports.charts",          False, "the figures"),
    ("reports.classify_charts", False, "the reliability diagram and decision curve"),
]


def run(module: str) -> tuple[bool, float, str]:
    started = time.time()
    proc = subprocess.run([sys.executable, "-m", f"backend.boxoffice.{module}"],
                          cwd=ROOT, capture_output=True, text=True)
    tail = (proc.stdout or proc.stderr).strip().splitlines()
    return proc.returncode == 0, time.time() - started, tail[-1] if tail else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--network", action="store_true",
                    help="include the stages that call TMDB, OMDb and Wikidata")
    ap.add_argument("--from", dest="start", default=None,
                    help="skip every stage before this one (module suffix)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    planned = [s for s in STAGES if args.network or not s[1]]
    if args.start:
        idx = next((i for i, s in enumerate(planned) if s[0].endswith(args.start)), None)
        if idx is None:
            print(f"no stage matching {args.start!r}; stages are:")
            for module, _, _ in planned:
                print(f"  {module}")
            return 2
        planned = planned[idx:]

    print(f"{len(planned)} stages"
          f"{' (network included)' if args.network else ' (offline only)'}\n")
    failed = 0
    for module, network, what in planned:
        tag = " [net]" if network else ""
        if args.dry_run:
            print(f"  would run {module}{tag} -- {what}")
            continue
        ok, secs, last = run(module)
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark} {module:28s} {secs:6.1f}s{tag}  {last[:60]}", flush=True)
        if not ok:
            # Stop rather than carry on. Every stage below a failure reads what
            # the failed one was supposed to write, so continuing would rebuild
            # the rest of the project on a stale file and report success.
            failed = 1
            print(f"\nstopped at {module}: everything downstream reads its output")
            break
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
