"""
Projections for the search bar, and the honest version of actual-versus-forecast.

The temptation here is to fit one model on everything and print its prediction
next to the real gross. That produces a beautiful scatter and means nothing: the
model saw the answer during training, so it is grading its own memory.

So every released film is scored by the model from the fold where its own year
was the test year, which is a model trained only on films released before it.
The number shown next to a 2019 film's actual gross is what a forecaster
standing in December 2018 would have said. Films before the first fold have no
honest projection and are given none rather than an in-sample one.

Genuinely unreleased films are the one case that uses a model trained on
everything, because for them everything *is* the past. Those are forecasts
rather than backtests and are labelled as such, with one caveat attached: only
15% of the upcoming slate has a published budget, and budget is the strongest
single feature. Withholding it from the backtest costs about five points, from
55.7% within a factor of two down to 50.8%, so a forecast for a film with no
budget yet should be read at roughly that weaker accuracy.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.leakage import assert_clean
from boxoffice.model.train import FEATURES, feature_columns

OUT_PARQUET = Path(FEATURES).parent / "projections.parquet"
OUT_JSON = Path(FEATURES).parent / "projections.json"
FIRST_FOLD = 2010


def _model() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        max_iter=400, learning_rate=0.06, min_samples_leaf=20,
        l2_regularization=1.0, random_state=0)


def build() -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES).sort_values("release_date").reset_index(drop=True)
    cols = feature_columns(frame)
    assert_clean(frame[cols])

    frame["year"] = frame["release_date"].dt.year
    frame["projected_worldwide"] = np.nan
    frame["projection_basis"] = "none: released before the first validation fold"

    upcoming = frame.get("is_upcoming", pd.Series(False, index=frame.index))
    upcoming = upcoming.fillna(False).astype(bool)
    released = frame[~upcoming]

    for year in sorted(y for y in released["year"].unique() if y >= FIRST_FOLD):
        train = released[released["year"] < year]
        test = released[released["year"] == year]
        if len(train) < 200 or test.empty:
            continue
        gb = _model().fit(train[cols].to_numpy(dtype="float64"),
                          train["y_log_worldwide"].to_numpy())
        pred = np.expm1(gb.predict(test[cols].to_numpy(dtype="float64")))
        frame.loc[test.index, "projected_worldwide"] = pred
        frame.loc[test.index, "projection_basis"] = (
            f"out of sample: trained on films released before {year}")

    # Unreleased films are the one case that may use everything, because for
    # them everything is the past. This is a forecast, not a backtest, and the
    # basis string says so rather than leaving a reader to infer it.
    if upcoming.any():
        gb = _model().fit(released[cols].to_numpy(dtype="float64"),
                          released["y_log_worldwide"].to_numpy())
        slate = frame[upcoming]
        frame.loc[slate.index, "projected_worldwide"] = np.expm1(
            gb.predict(slate[cols].to_numpy(dtype="float64")))
        frame.loc[slate.index, "projection_basis"] = (
            "forecast: trained on every released film; no actual gross yet")

    frame["is_upcoming"] = upcoming
    frame["budget_known"] = frame["log_budget"].notna()
    frame["ratio"] = frame["projected_worldwide"] / frame["y_worldwide"].clip(lower=1)
    frame["within_2x"] = frame["ratio"].between(0.5, 2.0)
    return frame


def main() -> None:
    frame = build()
    keep = ["imdb_id", "title", "release_date", "y_worldwide",
            "projected_worldwide", "ratio", "within_2x", "projection_basis",
            "is_upcoming", "budget_known"]
    out = frame[keep].rename(columns={"y_worldwide": "actual_worldwide"})
    out.to_parquet(OUT_PARQUET, index=False)

    # A compact lookup for the client: one row per film, dollars rounded to the
    # nearest thousand because printing a forecast to the dollar implies a
    # precision the model does not have.
    payload = {
        r.imdb_id: {
            "title": r.title,
            "year": int(pd.Timestamp(r.release_date).year),
            "actual": None if pd.isna(r.actual_worldwide) else round(r.actual_worldwide, -3),
            "projected": None if pd.isna(r.projected_worldwide) else round(r.projected_worldwide, -3),
            "basis": r.projection_basis,
        }
        for r in out.itertuples() if isinstance(r.imdb_id, str)
    }
    OUT_JSON.write_text(json.dumps(payload, separators=(",", ":")))

    # Accuracy is measured only where there is an actual gross to measure
    # against. Including the forecasts here would dilute the backtest with
    # films that cannot be right or wrong yet, which is how 57.3% quietly
    # became 52.7% the first time.
    scored = out.dropna(subset=["projected_worldwide", "actual_worldwide"])
    slate = out[out["is_upcoming"]]
    print(f"{len(out)} films: {len(scored)} scored against an actual gross, "
          f"{len(slate)} forecasts for unreleased films "
          f"({int(slate['budget_known'].sum())} with a published budget)")
    print(f"within a factor of two: {scored['within_2x'].mean():.1%}")
    print(f"median |ratio - 1|:     {(scored['ratio'] - 1).abs().median():.2f}")
    print(f"-> {OUT_PARQUET.name}, {OUT_JSON.name} "
          f"({OUT_JSON.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
