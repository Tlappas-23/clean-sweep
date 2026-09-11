"""
Every number printed in the documentation, checked against the artifact it came from.

A figure written into prose is a figure that stops being true the next time the
model is retrained, and nothing fails when it does. This module is the failure.
It reads the tables in `RESULTS.md`, the accuracy figures the serving artifact
quotes, and the sample counts, and compares each to the file that produced it.

The tests read artifacts and never fit a model, so the suite stays fast. If an
artifact is missing the test skips rather than fails: a fresh clone without the
data should not look broken.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RESULTS = ROOT / "RESULTS.md"
ARTIFACT = ROOT.parents[1] / "data/models/boxoffice_projections.json"


def _need(path: Path):
    if not path.exists():
        pytest.skip(f"{path.name} has not been generated")
    return path


def _row(table_line_prefix: str) -> list[float]:
    """Pull the numbers out of the one RESULTS.md table row starting with a label."""
    for line in RESULTS.read_text().splitlines():
        stripped = line.strip().lstrip("|").strip().replace("**", "")
        if stripped.startswith(table_line_prefix):
            return [float(n) for n in re.findall(r"-?\d+\.\d+", line)]
    raise AssertionError(f"no RESULTS.md row starting with {table_line_prefix!r}")


def _row_any(prefixes: tuple[str, ...]) -> list[float]:
    for p in prefixes:
        try:
            return _row(p)
        except AssertionError:
            continue
    raise AssertionError(f"no RESULTS.md row starting with any of {prefixes}")


def _row_in_section(heading: str, prefix: str) -> list[float]:
    """Like _row, but only looks at lines after the named heading.

    Needed because the same tier labels head rows in two tables: the budget
    cross-tab and the per-tier classification result. The first match is the
    wrong one.
    """
    lines = RESULTS.read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("## ") and heading in l)
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        stripped = line.strip().lstrip("|").strip().replace("**", "")
        if stripped.startswith(prefix):
            return [float(n) for n in re.findall(r"-?\d+\.\d+", line)]
    raise AssertionError(f"no row starting with {prefix!r} under {heading!r}")


# -- the serving artifact quotes what was actually measured --------------------

def test_accuracy_file_matches_the_projections_it_describes():
    """accuracy.json must describe the projections file sitting next to it."""
    proj = pd.read_parquet(_need(DATA / "projections.parquet"))
    measured = json.loads(_need(DATA / "accuracy.json").read_text())

    scored = proj.dropna(subset=["projected_worldwide", "actual_worldwide", "imdb_id"])
    assert measured["scored_films"] == len(scored)
    assert measured["within_2x"] == pytest.approx(scored["within_2x"].mean(), abs=1.1e-3)


def test_served_artifact_quotes_the_measured_accuracy():
    """The JSON the API serves may not carry a number nobody computed."""
    measured = json.loads(_need(DATA / "accuracy.json").read_text())
    served = json.loads(_need(ARTIFACT).read_text())["summary"]

    assert served["within_2x"] == measured["within_2x"]
    assert served["within_2x_without_budget"] == measured["within_2x_without_budget"]


def test_no_budget_accuracy_is_worse_than_with_budget():
    """The caveat the UI prints only makes sense in one direction."""
    measured = json.loads(_need(DATA / "accuracy.json").read_text())
    assert measured["within_2x_without_budget"] < measured["within_2x"]


def test_slate_counts_match_the_projections():
    """'N films, M with a budget' in the UI comes from the projections, not prose."""
    proj = pd.read_parquet(_need(DATA / "projections.parquet"))
    served = json.loads(_need(ARTIFACT).read_text())["summary"]

    # Servable rows only. A film with no IMDb id has no key the endpoint can
    # match, so it is not in the artifact and must not be in the count.
    slate = proj[proj["is_upcoming"] & proj["projected_worldwide"].notna()
                 & proj["imdb_id"].notna()]
    assert served["upcoming"] == len(slate)
    assert served["upcoming_with_budget"] == int(slate["budget_known"].sum())


# -- RESULTS.md agrees with the CSVs behind it ---------------------------------

def test_results_baseline_table_matches_the_ablation():
    """The headline model row is the ablation's own 'all groups' row."""
    abl = pd.read_csv(_need(DATA / "ablation.csv"))
    full = abl[(abl.group == "all groups") & (abl.design == "add one to budget")].iloc[0]

    # The feature count in the label moves as groups are added; the row is
    # found by its stem so the test does not have to be edited each time.
    mae, within = _row("All ")[2:4] if False else _row_any(
        ("All 38 pre-release", "All 35 pre-release", "All pre-release"))[:2]
    assert mae == pytest.approx(full.mae_log, abs=1.1e-3)
    assert within / 100 == pytest.approx(full.within_2x, abs=1.1e-3)


def test_results_learner_table_matches_the_bakeoff():
    """Every row of the published bakeoff table, against the run that produced it."""
    from boxoffice.model.bakeoff import summarise

    bake = summarise(pd.read_csv(_need(DATA / "bakeoff.csv"))).set_index("learner")
    published = {
        "Budget alone, linear": "budget only",
        "Ridge, imputed": "ridge",
        "Neural net, two hidden layers of 64": "neural net (2x64)",
        "Random forest, imputed": "random forest",
        "Boosting, hand-tuned, retired": "boosting (hand-tuned, retired)",
        "Boosting, as shipped": "boosting (shipped)",
    }
    for label, learner in published.items():
        mae, within = _row(label)[:2]
        assert mae == pytest.approx(bake.loc[learner, "mae_log"], abs=1.1e-3), label
        assert within / 100 == pytest.approx(
            bake.loc[learner, "within_2x"], abs=1.1e-3), label


def test_results_prestige_table_matches_the_prestige_run():
    """Thirteen features buying nothing is a claim with a CSV behind it."""
    pres = pd.read_csv(_need(DATA / "prestige_ablation.csv")).set_index("group")
    for label, group in [("All thirteen at once", "all thirteen removed"),
                         ("Oscar pedigree", "- oscar pedigree"),
                         ("Release competition", "- release competition"),
                         ("Franchise gap", "- franchise gap"),
                         ("Director recency", "- director recency")]:
        d_mae, d_2x = _row(label)[:2]
        assert d_mae == pytest.approx(pres.loc[group, "d_mae"], abs=1.1e-3), label
        assert d_2x / 100 == pytest.approx(pres.loc[group, "d_2x"], abs=1.1e-3), label


def test_results_header_matches_the_matrix_and_the_folds():
    """The opening sentence states the sample and the folds. Both are checked.

    Anchored to that one sentence rather than to every four-digit number in the
    document, because several legitimately different counts appear now: films
    with a synopsis, films with a domestic figure, films with a projection.
    Matching them all against the sample size was a test that could only ever
    pass by accident.
    """
    feat = pd.read_parquet(_need(DATA / "features.parquet"))
    released = feat[~feat["is_upcoming"].fillna(False).astype(bool)]
    years = sorted(released["release_date"].dt.year.unique())

    header = re.search(
        r"comes from (\d+) rolling-origin folds, (\d{4}) to (\d{4}), on ([\d,]+)\s+films",
        RESULTS.read_text())
    assert header, "RESULTS.md no longer opens with the sample and fold statement"
    folds, first, last, sample = header.groups()

    assert int(sample.replace(",", "")) == len(released)
    assert int(last) == max(years)
    # One fold per year from the first validation year to the last.
    assert int(folds) == max(years) - int(first) + 1


def test_domestic_coverage_claim_matches_the_merge():
    """The 686/687 distinction is real and both numbers have to stay honest."""
    merged = pd.read_parquet(_need(DATA / "domestic_merged.parquet"))
    text = RESULTS.read_text()
    assert f"{len(merged):,} of the 2,505" in text or f"{len(merged)} films" in text


# -- the notebook is the deliverable, so it has to have run --------------------

def test_decision_log_has_no_error_output():
    nb = json.loads(_need(ROOT / "decision_log.ipynb").read_text())
    failed = [i for i, c in enumerate(nb["cells"])
              if any(o.get("output_type") == "error" for o in c.get("outputs", []))]
    assert not failed, f"cells with error output: {failed}"


def test_decision_log_was_executed():
    """An unexecuted notebook renders as a promise rather than as evidence."""
    nb = json.loads(_need(ROOT / "decision_log.ipynb").read_text())
    code = [c for c in nb["cells"] if c["cell_type"] == "code"]
    unrun = [i for i, c in enumerate(code) if c.get("execution_count") is None]
    assert not unrun, f"code cells never run: {unrun}"



# -- the classification result, which is the portfolio claim -----------------

def test_results_classify_tiers_match_the_significance_run():
    """Every row of the per-tier table, against the run that produced it."""
    sig = pd.read_csv(_need(DATA / "classify_significance.csv")).set_index("slice")
    for label, key in [("Under $15m", "<$15m"), ("$15m to $50m", "$15-50m"),
                       ("Over $50m", "$50m+"), ("All |", "all")]:
        nums = _row_in_section("Can you tell which films", label)
        # _row keeps decimals only, so the film count and the base-rate
        # percentage are not in this list. What remains, in table order:
        # ll_prior, ll_model, improvement, ci_lo, ci_hi, p.
        ll_prior, ll_model, imp, lo, hi = nums[:5]
        r = sig.loc[key]
        assert ll_prior == pytest.approx(r.logloss_prior, abs=1.1e-3), label
        assert ll_model == pytest.approx(r.logloss_model, abs=1.1e-3), label
        assert imp == pytest.approx(r.improvement, abs=1.1e-3), label
        assert lo == pytest.approx(r.ci_lo, abs=1.1e-3), label
        assert hi == pytest.approx(r.ci_hi, abs=1.1e-3), label
        assert r.verdict == "model better", f"{label}: RESULTS claims a win the run does not show"


def test_classifier_is_calibrated():
    """A quoted probability has to mean what it says, within a few points."""
    folds = pd.read_parquet(_need(DATA / "classify_folds.parquet"))
    p = folds["p_profit"].to_numpy()
    y = (folds["y"] == 2).to_numpy().astype(int)
    bins = np.clip(np.digitize(p, np.linspace(0, 1, 11)) - 1, 0, 9)
    worst = 0.0
    for b in range(10):
        m = bins == b
        if m.sum() >= 50:
            worst = max(worst, abs(p[m].mean() - y[m].mean()))
    assert worst < 0.10, f"a well-populated bin is off the diagonal by {worst:.2f}"


def test_no_probability_is_ever_exactly_zero():
    """The floor exists because two exact zeros once dominated an interval."""
    folds = pd.read_parquet(_need(DATA / "classify_folds.parquet"))
    cols = ["p_writeoff", "p_loss", "p_profit",
            "prior_writeoff", "prior_loss", "prior_profit"]
    assert (folds[cols].to_numpy() > 0).all()
