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
rather than backtests and are labelled as such, with one caveat attached: most
of the upcoming slate has no published budget, and budget is the strongest
single feature. So the same backtest is run a second time with budget withheld,
and both figures are written to `accuracy.json` for the serving artifact to
quote. They are measured on the identical population and the identical
convention, because a forecast accuracy and the number it is compared against
have to be the same kind of number.
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
from boxoffice.model.train import FEATURES, feature_columns, model

OUT_PARQUET = Path(FEATURES).parent / "projections.parquet"
OUT_JSON = Path(FEATURES).parent / "projections.json"
OUT_ACCURACY = Path(FEATURES).parent / "accuracy.json"
FIRST_FOLD = 2010


def _model() -> HistGradientBoostingRegressor:
    return model()


def _out_of_fold(released: pd.DataFrame, cols: list[str]):
    """Yield (year, test rows, predicted dollars) for every scorable fold.

    Factored out because the no-budget accuracy figure has to come from this
    exact loop. A second implementation would drift, and the two numbers are
    only comparable while they are produced the same way.
    """
    for year in sorted(y for y in released["year"].unique() if y >= FIRST_FOLD):
        train = released[released["year"] < year]
        test = released[released["year"] == year]
        if len(train) < 200 or test.empty:
            continue
        gb = _model().fit(train[cols].to_numpy(dtype="float64"),
                          train["y_log_worldwide"].to_numpy())
        yield year, test, np.expm1(gb.predict(test[cols].to_numpy(dtype="float64")))


def without_budget() -> float:
    """Re-run the backtest with budget withheld, pooled over the same films.

    This is what a forecast for a film with no announced budget is worth, and
    it is measured rather than asserted. Most of the upcoming slate is in that
    position, so the number carries real weight in how the UI is read.

    It reads the feature matrix from disk rather than taking `build`'s frame.
    That frame has the projections joined onto it, and `feature_columns` selects
    by exclusion, so passing it in hands the model its own predictions as
    features. The first version of this function did exactly that.
    """
    frame = pd.read_parquet(FEATURES).sort_values("release_date").reset_index(drop=True)
    frame["year"] = frame["release_date"].dt.year
    upcoming = frame.get("is_upcoming", pd.Series(False, index=frame.index))
    released = frame[~upcoming.fillna(False).astype(bool)]

    cols = [c for c in feature_columns(frame) if c != "log_budget"]
    assert_clean(frame[cols])

    hits, total = 0, 0
    for _, test, pred in _out_of_fold(released, cols):
        # Same population as the headline figure, down to the single film with
        # no IMDb id. Two accuracies compared against each other have to be
        # measured over the same rows or the comparison is not one.
        keep = test["imdb_id"].notna().to_numpy()
        ratio = (pred / test["y_worldwide"].clip(lower=1).to_numpy())[keep]
        hits += int(((ratio >= 0.5) & (ratio <= 2.0)).sum())
        total += len(ratio)
    return hits / total


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

    for year, test, pred in _out_of_fold(released, cols):
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
    # The accuracy figure has to describe the same films the artifact can
    # actually serve, so a film without an IMDb id is excluded here as well as
    # there. It is one film and it does not move the number; the point is that
    # a statistic and the rows it is quoted over should be the same population.
    scored = out.dropna(subset=["projected_worldwide", "actual_worldwide", "imdb_id"])
    # Restricted the same way, for the same reason: two of the unreleased films
    # carry no IMDb id, cannot be served, and so are not part of any count the
    # UI prints. A console line that disagrees with the artifact is a stale
    # number waiting to be quoted.
    slate = out[out["is_upcoming"] & out["imdb_id"].notna()]

    # Both accuracies, pooled over the same scored films, written for the
    # serving artifact to read. Nothing downstream hardcodes either one.
    no_budget = without_budget()
    OUT_ACCURACY.write_text(json.dumps({
        "within_2x": round(float(scored["within_2x"].mean()), 4),
        "within_2x_without_budget": round(no_budget, 4),
        "scored_films": int(len(scored)),
        "basis": "pooled over every film with an out-of-sample projection and "
                 "an actual gross; the second figure re-runs the identical "
                 "folds with log_budget removed from the feature set",
    }, indent=2))
    print(f"{len(out)} films: {len(scored)} scored against an actual gross, "
          f"{len(slate)} forecasts for unreleased films "
          f"({int(slate['budget_known'].sum())} with a published budget)")
    print(f"within a factor of two: {scored['within_2x'].mean():.1%}")
    print(f"median |ratio - 1|:     {(scored['ratio'] - 1).abs().median():.2f}")
    print(f"without a budget:       {no_budget:.1%}")
    print(f"-> {OUT_PARQUET.name}, {OUT_JSON.name} "
          f"({OUT_JSON.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
