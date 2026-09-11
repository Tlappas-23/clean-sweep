"""
Three targets, and a test of whether splitting them was worth doing.

The README asserts that domestic and international should be modelled
separately because they have different drivers. That is a claim, and claims of
that shape are usually made and never checked, so this module checks it: fit
the two halves separately and sum them, fit worldwide directly, and score both
on identical folds.

If the split does not beat the direct fit, the honest move is to say so and
model worldwide, and the assertion in the README gets rewritten.

One data-quality note that has to be handled rather than ignored. TMDB's
worldwide figure and OMDb's domestic figure come from different sources with
different revision histories, so a small number of films report a domestic
gross larger than their worldwide total. Those rows are not silently clipped to
zero, which would invent an international gross of nothing; they are dropped
from the split evaluation and counted in the output.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES, feature_columns, model

DOMESTIC = Path(FEATURES).parent / "domestic_merged.parquet"


def assemble() -> tuple[pd.DataFrame, dict[str, int]]:
    films = pd.read_parquet(FEATURES)
    dom = pd.read_parquet(DOMESTIC)[["imdb_id", "y_domestic"]]
    merged = films.merge(dom, on="imdb_id", how="inner")

    before = len(merged)
    inconsistent = merged["y_domestic"] > merged["y_worldwide"]
    merged = merged[~inconsistent].copy()

    merged["y_international"] = merged["y_worldwide"] - merged["y_domestic"]
    merged["y_log_domestic"] = np.log1p(merged["y_domestic"])
    merged["y_log_international"] = np.log1p(merged["y_international"])

    return merged, {
        "with_domestic": before,
        "dropped_inconsistent": int(inconsistent.sum()),
        "usable": len(merged),
    }


def _fit_predict(train: pd.DataFrame, test: pd.DataFrame, cols: list[str], target: str) -> np.ndarray:
    gb = model()
    gb.fit(train[cols].to_numpy(dtype="float64"), train[target].to_numpy())
    return gb.predict(test[cols].to_numpy(dtype="float64"))


def _within_2x(truth: np.ndarray, pred: np.ndarray) -> float:
    ratio = np.maximum(pred, 0.0) / np.maximum(truth, 1.0)
    return float(np.mean((ratio >= 0.5) & (ratio <= 2.0)))


def run(first_year: int = 2012) -> pd.DataFrame:
    frame, counts = assemble()
    cols = feature_columns(frame)
    cols = [c for c in cols if not c.startswith("y_")]
    years = sorted(y for y in frame["release_date"].dt.year.unique() if y >= first_year)

    rows = []
    for year in years:
        train = frame[frame["release_date"].dt.year < year]
        test = frame[frame["release_date"].dt.year == year]
        if len(train) < 200 or len(test) < 20:
            continue

        dom = np.expm1(_fit_predict(train, test, cols, "y_log_domestic"))
        intl = np.expm1(_fit_predict(train, test, cols, "y_log_international"))
        direct = np.expm1(_fit_predict(train, test, cols, "y_log_worldwide"))

        rows.append(
            {
                "year": year,
                "n": len(test),
                "domestic": _within_2x(test["y_domestic"].to_numpy(), dom),
                "international": _within_2x(test["y_international"].to_numpy(), intl),
                "ww_from_split": _within_2x(test["y_worldwide"].to_numpy(), dom + intl),
                "ww_direct": _within_2x(test["y_worldwide"].to_numpy(), direct),
            }
        )

    out = pd.DataFrame(rows)
    out.attrs["counts"] = counts
    return out


if __name__ == "__main__":
    table = run()
    counts = table.attrs["counts"]
    print(
        f"{counts['usable']} films with both figures "
        f"({counts['dropped_inconsistent']} dropped: domestic exceeded worldwide)\n"
    )
    print(table.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("\nmeans across folds:")
    print(
        table[["domestic", "international", "ww_from_split", "ww_direct"]]
        .mean()
        .to_string(float_format=lambda v: f"{v:.3f}")
    )
