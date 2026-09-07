"""
Estimating the box office we do not have (``pipeline.boxoffice``).

The problem
-----------
TMDB and OMDb between them know the revenue of 74% of the catalog, but that
average hides the shape: 98% of the 2000s and only **33% of the 1950s**. The
Box Office metric was therefore missing on exactly the rounds where the
player has least else to go on, and a metric that is present for modern films
and absent for old ones quietly biases the game toward the modern ones.

The estimator
-------------
A film's revenue is estimated from the films it competed with, adjusted for
how widely it is known::

    log(revenue) = median log(revenue) of its group
                 + BETA * (log(votes) - median log(votes) of its group)

The first term is the "year average" idea: what a film of this kind, in this
year, typically earned. The second is what stops every film in a year getting
the same answer - within a group, the better-known film earned more, and
``BETA`` is the elasticity of log revenue with respect to log votes fitted on
the films whose revenue we *do* know. This is a ratio estimator, the standard
way to carry an auxiliary variable (votes, known for everything) into a gap
in a target variable (revenue, known for 74%).

The group is the most specific one with enough known films to be worth
trusting, tried in order::

    (year, primary genre) -> (decade, primary genre) -> decade -> whole catalog

Each level needs ``MIN_GROUP`` known revenues before it is used, so a thin
1954 horror pool falls back to 1950s horror rather than inventing a median
from two films.

What it is *not* used for
-------------------------
Estimates never enter the ranker. The model sees real revenue or NaN, which
``HistGradientBoosting`` handles natively. Feeding it a value computed from
vote counts - already a feature - would teach it a relationship the estimator
put there, not one the world did.

They also never enter the **Box Office metric the game scores**, and that is
a finding rather than a preference. Validated over 76 held-out years, the
estimator reproduces the within-year revenue ranking at Spearman +0.456
against +0.287 for the group median alone (p = 0.0008, comfortably
significant) but only +0.431 for ranking on vote count alone - a median gain
of +0.027, better in 43 of 76 years, **p = 0.17**. Against the baseline that
matters it is not significant. Since the metric is a within-year percentile,
an estimated Box Office score would be a near-duplicate of the Popularity
score the ballot already counts, and double-counting one signal under two
names is worse than leaving a gap. So the estimate is shown to the player,
clearly marked, and the score is computed from measured revenue only.

Every estimated row is flagged in ``films.box_office_is_estimated`` and
travels to the client as such, so the interface can show it as an estimate.
An estimate presented as a measurement is worse than no estimate.

Honest accuracy
---------------
Absolute revenue in nominal dollars is not what the game consumes - the Box
Office metric is a *percentile within the film's year*. So the estimator is
validated on the thing it is actually used for: how well it reproduces the
within-year revenue ranking, measured by Spearman correlation on held-out
films, against two baselines. ``python -m pipeline.boxoffice --validate``
prints the table, and the numbers land in ``data/models/boxoffice.json``.
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import pandas as pd

from pipeline.paths import MODELS_DIR, SEED_DIR, ensure_dirs

# Known revenues a group needs before its median is trusted. Below this the
# estimator falls back to a broader group.
MIN_GROUP = 8

# Revenue below this is treated as unknown rather than real. TMDB stores 0 for
# "not recorded", and a handful of rows carry token values that are clearly
# placeholders rather than a film's actual gross.
MIN_CREDIBLE_REVENUE = 1_000.0

# Estimates live in their own column and never overwrite a measured figure.
# Two columns rather than one flag-plus-value is what makes "is this number
# real?" unanswerable-by-accident anywhere downstream.
MEASURED_COLUMN = "box_office_usd"
ESTIMATE_COLUMN = "box_office_est_usd"


def _primary_genre(genres) -> str:
    """First IMDb genre tag, or ``"Unknown"``. IMDb orders them by relevance."""
    if genres is None:
        return "Unknown"
    listed = list(genres)
    return str(listed[0]) if listed else "Unknown"


def prepare(films: pd.DataFrame) -> pd.DataFrame:
    """Add the working columns the estimator needs (log votes, genre, decade)."""
    out = films.copy()
    out["log_votes"] = np.log1p(pd.to_numeric(out["imdb_votes"], errors="coerce").astype("float64"))
    revenue = pd.to_numeric(out["box_office_usd"], errors="coerce").astype("float64")
    out["_revenue"] = revenue.where(revenue >= MIN_CREDIBLE_REVENUE)
    out["_log_revenue"] = np.log(out["_revenue"])
    out["_genre"] = out["genres"].apply(_primary_genre)
    out["_decade"] = (out["year"] // 10 * 10).astype("int64")
    return out


def fit_elasticity(known: pd.DataFrame) -> float:
    """
    Elasticity of log revenue with respect to log votes, fitted *within* groups.

    Fitting on the pooled cloud would mostly measure that modern films have
    both more votes and more nominal dollars, which is inflation and audience
    growth rather than a within-year relationship. Centring each film on its
    own (decade, genre) group first removes that shared drift and leaves the
    part the estimator actually uses: among contemporaries, how much more did
    the better-known film earn?
    """
    usable = known.dropna(subset=["_log_revenue", "log_votes"])
    if len(usable) < MIN_GROUP * 2:
        return 1.0
    grouped = usable.groupby(["_decade", "_genre"])
    x = usable["log_votes"] - grouped["log_votes"].transform("median")
    y = usable["_log_revenue"] - grouped["_log_revenue"].transform("median")
    keep = x.notna() & y.notna()
    if keep.sum() < MIN_GROUP * 2 or float(x[keep].var()) == 0.0:
        return 1.0
    return float(np.polyfit(x[keep], y[keep], 1)[0])


def _group_medians(known: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """Median log revenue and log votes per group, for groups big enough to trust."""
    stats = known.groupby(keys).agg(
        med_revenue=("_log_revenue", "median"),
        med_votes=("log_votes", "median"),
        n=("_log_revenue", "size"),
    )
    return stats[stats["n"] >= MIN_GROUP]


def estimate(films: pd.DataFrame, known_mask: pd.Series | None = None) -> pd.DataFrame:
    """
    Return ``films`` with missing revenue estimated and every estimate flagged.

    ``known_mask`` restricts which rows are treated as ground truth; the
    validation harness uses it to hide a holdout set from the estimator.
    """
    work = prepare(films)
    truth = (
        work["_log_revenue"].notna()
        if known_mask is None
        else known_mask.reindex(work.index, fill_value=False)
    )
    known = work[truth]

    beta = fit_elasticity(known)
    ladders: list[tuple[list[str], pd.DataFrame]] = [
        (["year", "_genre"], _group_medians(known, ["year", "_genre"])),
        (["_decade", "_genre"], _group_medians(known, ["_decade", "_genre"])),
        (["_decade"], _group_medians(known, ["_decade"])),
    ]
    global_revenue = float(known["_log_revenue"].median()) if len(known) else np.nan
    global_votes = float(known["log_votes"].median()) if len(known) else np.nan

    # Walk the ladder from most to least specific, filling only what is still
    # missing, so every film gets the tightest group that had enough evidence.
    med_revenue = pd.Series(np.nan, index=work.index, dtype="float64")
    med_votes = pd.Series(np.nan, index=work.index, dtype="float64")
    level = pd.Series("global", index=work.index, dtype="object")

    for name, table in ladders:
        if table.empty:
            continue
        index = pd.MultiIndex.from_frame(work[name]) if len(name) > 1 else pd.Index(work[name[0]])
        candidate_revenue = pd.Series(table["med_revenue"].reindex(index).to_numpy(), index=work.index)
        candidate_votes = pd.Series(table["med_votes"].reindex(index).to_numpy(), index=work.index)
        fill = med_revenue.isna() & candidate_revenue.notna()
        med_revenue = med_revenue.where(~fill, candidate_revenue)
        med_votes = med_votes.where(~fill, candidate_votes)
        level = level.where(~fill, "+".join(name).replace("_", ""))

    med_revenue = med_revenue.fillna(global_revenue)
    med_votes = med_votes.fillna(global_votes)

    predicted_log = med_revenue + beta * (work["log_votes"] - med_votes)
    predicted = np.exp(predicted_log)

    out = films.copy()
    needs = ~truth & predicted.notna() & work["log_votes"].notna()
    # Measured revenue is left exactly as it was found.
    out[MEASURED_COLUMN] = work["_revenue"]
    out[ESTIMATE_COLUMN] = predicted.where(needs)
    out.attrs["beta"] = beta
    out.attrs["levels"] = level[needs].value_counts().to_dict()
    out.attrs["n_estimated"] = int(needs.sum())
    return out


def combined(films: pd.DataFrame) -> pd.Series:
    """
    Measured revenue where we have it, the estimate elsewhere.

    Used for *display* only. The Box Office metric the game scores is computed
    from measured revenue alone - see the note in ``validate``'s findings on
    why an estimate must not feed the score.
    """
    measured = pd.to_numeric(films[MEASURED_COLUMN], errors="coerce")
    estimated = pd.to_numeric(films.get(ESTIMATE_COLUMN), errors="coerce")
    return measured.where(measured.notna(), estimated)


# ------------------------------------------------------------------ validation
def _per_year_spearman(frame: pd.DataFrame, predicted: pd.Series) -> dict[int, float]:
    """
    Spearman correlation between predicted and actual revenue, one year at a time.

    Within-year rank is exactly what the game consumes - the Box Office metric
    is a percentile inside the film's year - so this is the number that says
    whether the estimator is fit for its purpose. Absolute dollar error is
    reported too, but it is the less relevant figure.

    Returned per year rather than averaged so the comparison against the
    baselines can be *paired*: the same year scored by two methods is one
    matched observation, and pairing removes the between-year variance that
    would otherwise swamp the difference.
    """
    scores: dict[int, float] = {}
    joined = frame.assign(_pred=predicted)
    for year, group in joined.groupby("year"):
        pair = group.dropna(subset=["_log_revenue", "_pred"])
        if len(pair) < 5 or pair["_pred"].nunique() < 2:
            continue
        value = pair["_log_revenue"].corr(pair["_pred"], method="spearman")
        if np.isfinite(value):
            scores[int(year)] = float(value)
    return scores


def _paired_test(a: dict[int, float], b: dict[int, float]) -> dict:
    """
    Paired comparison of two methods over the years both scored.

    Uses the Wilcoxon signed-rank test rather than a t-test: correlations are
    bounded and skewed, so a test that assumes normal differences would be
    making a promise the data does not keep. Falls back to the sign test's
    normal approximation if SciPy is unavailable, which keeps the pipeline
    dependency-light without dropping the claim.
    """
    shared = sorted(set(a) & set(b))
    if len(shared) < 6:
        return {"n_years": len(shared), "p_value": None, "note": "too few paired years"}
    diff = np.array([a[y] - b[y] for y in shared])
    median_gain = float(np.median(diff))
    try:
        from scipy.stats import wilcoxon

        stat, p = wilcoxon(diff, alternative="greater")
        test = "wilcoxon signed-rank (one-sided)"
    except Exception:  # pragma: no cover - SciPy not installed
        wins = int((diff > 0).sum())
        n = int((diff != 0).sum())
        z = (wins - n / 2) / np.sqrt(n / 4) if n else 0.0
        p = float(0.5 * np.erfc(z / np.sqrt(2)))
        test = "sign test (normal approximation)"
    return {
        "n_years": len(shared),
        "median_gain": round(median_gain, 4),
        "years_improved": int((diff > 0).sum()),
        "p_value": float(p),
        "test": test,
        "significant_at_05": bool(p < 0.05),
    }


def validate(films: pd.DataFrame, folds: int = 5, seed: int = 42) -> dict:
    """
    Hide each fifth of the known revenues in turn, estimate it, and score the guess.

    Reports the estimator against two baselines so the number means something:
    the group median alone (no votes adjustment) and votes alone (no group).
    Every year appears once as holdout, and the three methods are compared on
    matched years so the improvement can be tested rather than eyeballed.
    """
    work = prepare(films)
    known_index = work.index[work["_log_revenue"].notna()]
    rng = np.random.default_rng(seed)
    order = rng.permutation(known_index.to_numpy())
    chunks = np.array_split(order, folds)

    per_year: dict[str, dict[int, float]] = {"estimator": {}, "group_median": {}, "votes_only": {}}
    absolute: list[float] = []
    within_factor_3: list[float] = []

    for held in chunks:
        mask = pd.Series(True, index=work.index)
        mask.loc[held] = False  # hide this fold from the estimator
        mask &= work["_log_revenue"].notna()

        filled = estimate(films, known_mask=mask)
        predicted_log = np.log(pd.to_numeric(filled[ESTIMATE_COLUMN], errors="coerce"))

        holdout = work.loc[held]
        per_year["estimator"] |= _per_year_spearman(holdout, predicted_log.loc[held])

        # Baseline 1: the group median with no votes adjustment at all.
        medians = _group_medians(work[mask], ["_decade", "_genre"])["med_revenue"]
        idx = pd.MultiIndex.from_frame(holdout[["_decade", "_genre"]])
        per_year["group_median"] |= _per_year_spearman(
            holdout, pd.Series(medians.reindex(idx).to_numpy(), index=held)
        )
        # Baseline 2: rank by popularity alone.
        per_year["votes_only"] |= _per_year_spearman(holdout, holdout["log_votes"])

        error = (predicted_log.loc[held] - holdout["_log_revenue"]).abs().dropna()
        absolute.append(float(error.mean()))
        within_factor_3.append(float((error < np.log(3)).mean()))

    def summarise(scores: dict[int, float]) -> dict:
        arr = np.array(list(scores.values()))
        half = 1.96 * arr.std(ddof=1) / np.sqrt(len(arr)) if len(arr) > 1 else 0.0
        return {
            "mean": round(float(arr.mean()), 4),
            "ci95": round(float(half), 4),
            "n_years": len(arr),
        }

    return {
        "n_known": int(len(known_index)),
        "n_missing": int(work["_log_revenue"].isna().sum()),
        "beta": round(fit_elasticity(work[work["_log_revenue"].notna()]), 4),
        "within_year_spearman": {k: summarise(v) for k, v in per_year.items()},
        "vs_group_median": _paired_test(per_year["estimator"], per_year["group_median"]),
        "vs_votes_only": _paired_test(per_year["estimator"], per_year["votes_only"]),
        "mean_absolute_log_error": round(float(np.mean(absolute)), 4),
        "share_within_factor_of_3": round(float(np.mean(within_factor_3)), 4),
        "min_group": MIN_GROUP,
        "folds": folds,
    }


def averages_report(films: pd.DataFrame, contenders: pd.DataFrame) -> dict:
    """
    The aggregates behind the estimate, for the docs and the analytics page.

    Reported from *measured* revenue only, so these are descriptions of what
    is known rather than of what was filled in.
    """
    work = prepare(films)
    known = work[work["_log_revenue"].notna()]

    by_decade = (
        known.groupby("_decade")
        .agg(films=("film_id", "size"), median_usd=("_revenue", "median"))
        .assign(median_usd=lambda d: d["median_usd"].round(0))
    )
    coverage = work.groupby("_decade")["_log_revenue"].apply(lambda s: round(float(s.notna().mean()), 3))

    merged = contenders.merge(work[["film_id", "_decade", "_revenue"]], on="film_id", how="left")
    by_category = (
        merged.dropna(subset=["_revenue"])
        .groupby(["_decade", "category"])["_revenue"]
        .median()
        .round(0)
        .unstack()
    )
    return {
        "by_decade": {
            str(int(d)): {
                "films_with_revenue": int(by_decade.loc[d, "films"]),
                "median_usd": float(by_decade.loc[d, "median_usd"]),
                "coverage": float(coverage.get(d, 0.0)),
            }
            for d in by_decade.index
        },
        "median_usd_by_decade_and_category": {
            str(int(d)): {c: (None if pd.isna(v) else float(v)) for c, v in row.items()}
            for d, row in by_category.iterrows()
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="run the holdout validation")
    parser.add_argument("--folds", type=int, default=5)
    args = parser.parse_args(argv)

    ensure_dirs()
    films = pd.read_parquet(SEED_DIR / "films.parquet")
    contenders = pd.read_parquet(SEED_DIR / "contenders.parquet")

    report = {"averages": averages_report(films, contenders)}
    if args.validate:
        report["validation"] = validate(films, folds=args.folds)
        v = report["validation"]
        print(f"known {v['n_known']:,} / missing {v['n_missing']:,}   beta = {v['beta']}")
        print("\nwithin-year Spearman on held-out films (higher is better):")
        for name, stats in v["within_year_spearman"].items():
            print(f"  {name:14s} {stats['mean']:+.3f} +/- {stats['ci95']:.3f}  ({stats['n_years']} yrs)")
        for label, key in (("vs group median", "vs_group_median"), ("vs votes only", "vs_votes_only")):
            t = v[key]
            if t.get("p_value") is None:
                print(f"  {label}: {t.get('note')}")
            else:
                print(
                    f"  {label}: median gain {t['median_gain']:+.3f}, better in "
                    f"{t['years_improved']}/{t['n_years']} years, p = {t['p_value']:.2ive}"
                    if False
                    else f"  {label}: median gain {t['median_gain']:+.3f}, better in "
                    f"{t['years_improved']}/{t['n_years']} years, p = {t['p_value']:.3g}"
                )
        print(f"\nmean absolute log error {v['mean_absolute_log_error']:.3f}")
        print(f"share within a factor of 3: {v['share_within_factor_of_3']:.1%}")

    path = MODELS_DIR / "boxoffice.json"
    path.write_text(json.dumps(report, indent=2))
    print(f"\nwrote {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
