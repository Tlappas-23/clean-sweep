"""
Does widening the career history help, and where should its floor sit?

Widening the history fixed a feature that was demonstrably wrong: half the
sample carried no director record, and three quarters of those blanks were
veterans the sampling frame could not see. Fixing a wrong feature and improving
a model are different claims, though, and the first does not imply the second.

Two things could make it worse rather than better.

**The feature changes meaning.** "Median gross of this director's earlier films
in our frame" becomes "median gross of their earlier films anywhere", which
includes festival runs, foreign releases and direct-to-video. That is a truer
description of the person and a worse-scaled predictor of a studio release.

**The missingness was informative.** A blank used to mean "nobody attached has
a studio track record", which correlates with the film being small. Filling it
in removes a signal the booster was reading, and replaces it with a number on a
different scale.

So each setting is rebuilt and scored on the same folds. The floor sweep is
part of the same question: TMDB carries grosses of a few dollars on real
features, and a median is only as good as what it is taken over.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "backend/boxoffice/data/history_ablation.csv"

SETTINGS = [
    ("in-sample, absolute (original)", {"BOXOFFICE_USE_HISTORY": "0", "BOXOFFICE_PRIOR_SCALE": "absolute"}),
    ("in-sample, era-relative", {"BOXOFFICE_USE_HISTORY": "0", "BOXOFFICE_PRIOR_SCALE": "relative"}),
    ("wide $10k, absolute", {"BOXOFFICE_HISTORY_FLOOR": "10000", "BOXOFFICE_PRIOR_SCALE": "absolute"}),
    ("wide $10k, era-relative", {"BOXOFFICE_HISTORY_FLOOR": "10000", "BOXOFFICE_PRIOR_SCALE": "relative"}),
    ("wide $10m, era-relative", {"BOXOFFICE_HISTORY_FLOOR": "10000000", "BOXOFFICE_PRIOR_SCALE": "relative"}),
    (
        "wide $10k, era-relative, 5y window",
        {
            "BOXOFFICE_HISTORY_FLOOR": "10000",
            "BOXOFFICE_PRIOR_SCALE": "relative",
            "BOXOFFICE_MARKET_WINDOW": "5",
        },
    ),
]


def score(env: dict[str, str]) -> dict:
    full = {**os.environ, **env}
    subprocess.run(
        [sys.executable, "-m", "backend.boxoffice.pipeline.build_features"],
        cwd=ROOT,
        env=full,
        capture_output=True,
        check=True,
    )

    # Imported in a subprocess too, so the rebuilt matrix is read fresh rather
    # than from a module-level frame captured at first import.
    code = (
        "import sys; sys.path.insert(0, 'backend');"
        "import pandas as pd;"
        "from boxoffice.model.train import run, summarise, feature_columns, FEATURES;"
        "f = pd.read_parquet(FEATURES);"
        "rel = f[~f.is_upcoming.fillna(False).astype(bool)];"
        "s = summarise(run(f, feature_columns(f))).set_index('estimator');"
        "cov = {w: rel[w + '_prior_median_log'].notna().mean() "
        "       for w in ('director', 'cinematographer', 'composer')};"
        "print(s.loc['model', 'mae_log'], s.loc['model', 'within_2x'], "
        "      cov['director'], cov['cinematographer'], cov['composer'])"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=full, capture_output=True, text=True, check=True
    )
    mae, two, d, c, m = (float(x) for x in proc.stdout.split())
    return {"mae_log": mae, "within_2x": two, "director_cov": d, "cinematographer_cov": c, "composer_cov": m}


def main() -> pd.DataFrame:
    rows = []
    for name, env in SETTINGS:
        rows.append({"setting": name, **score(env)})
        print(
            f"  {name:26s} mae {rows[-1]['mae_log']:.3f}  "
            f"2x {rows[-1]['within_2x']:.3f}  "
            f"director coverage {rows[-1]['director_cov']:.1%}",
            flush=True,
        )
    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


if __name__ == "__main__":
    print(main().to_string(index=False, float_format=lambda v: f"{v:.3f}"))
