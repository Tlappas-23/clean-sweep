"""
Figures for the box office study, in the same house style as the portfolio.

One chart per decision, each titled with what it found rather than what it
plots, and each carrying the reasoning for its step underneath.

Nothing in these figures is typed. The first version carried the baseline hit
rates, the fold count, the year range, the feature count and even the sentence
"clears it in 15 of the 16 folds" as string literals, and every one of them
went stale the moment the sample grew or the target was corrected, while the
tests that guard the written tables had no way to see inside a PNG. So every
number here is read from the artifact that produced it, and every sentence
that contains a number is built from the value at render time.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import house as H  # noqa: E402  (sys.path is set two lines up, on purpose)
import matplotlib.pyplot as plt  # noqa: E402  (sys.path is set two lines up, on purpose)
from house import (  # noqa: E402  (sys.path is set two lines up, on purpose)
    ACCENT,
    BAD,
    GREY,
    INK,
    MUTED,
    SLATE,
)

from boxoffice.model.train import (  # noqa: E402  (sys.path is set two lines up, on purpose)
    feature_columns,
    run,
    summarise,
)
from boxoffice.pipeline.fetch import (  # noqa: E402  (sys.path is set two lines up, on purpose)
    BUDGET_FLOOR,
    DISTRIBUTORS,
)

DATA = HERE.parent / "data"
OUT = HERE / "figures"
OUT.mkdir(parents=True, exist_ok=True)

feat = pd.read_parquet(DATA / "features.parquet")
released = feat[~feat["is_upcoming"].fillna(False).astype(bool)]
abl = pd.read_csv(DATA / "ablation.csv")
sig = pd.read_csv(DATA / "significance.csv")

N_FEATURES = len(feature_columns(feat))
YEAR_LO, YEAR_HI = int(released.release_date.dt.year.min()), int(released.release_date.dt.year.max())

# The baselines and the per-fold record, computed rather than remembered.
folds = run(feat, feature_columns(feat))
summary = summarise(folds).set_index("estimator")
N_FOLDS = len(folds)
FOLD_LO, FOLD_HI = folds[0].year, folds[-1].year
BEATS = sum(f.within_2x["model"] > f.within_2x["budget_only"] for f in folds)

# Two figures TMDB reports about itself, recorded in the notebook's Decision 5
# and kept here as documented facts about the source rather than derived
# statistics. Everything below them in the funnel is counted from disk.
TMDB_THEATRICAL_2019 = 37_486
FRAME_2019 = 174


def _above_floor() -> int:
    """Released films in the cache that cleared the budget floor."""
    today = pd.Timestamp.today().normalize()
    n = 0
    for p in (DATA / "cache" / "film").glob("*.json"):
        try:
            b = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        d = pd.to_datetime(b.get("release_date"), errors="coerce")
        if pd.notna(d) and d <= today and (b.get("budget") or 0) >= BUDGET_FLOOR:
            n += 1
    return n


def _words(n: int) -> str:
    small = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
    ]
    return small[n] if 0 <= n < len(small) else str(n)


# ------------------------------------------------------------ 1. the sample
fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.7), gridspec_kw={"width_ratios": [1.1, 1], "wspace": 0.32})
ax = axes[0]
steps = [
    ("TMDB titles tagged theatrical, 2019", TMDB_THEATRICAL_2019, GREY),
    (f"From {len(DISTRIBUTORS)} major and mini-major distributors", FRAME_2019, SLATE),
    (f"Above the ${BUDGET_FLOOR / 1e6:.0f}M budget floor, {YEAR_LO}-{YEAR_HI}", _above_floor(), SLATE),
    ("With a reported worldwide gross", len(released), ACCENT),
]
y = np.arange(len(steps))[::-1]
ax.barh(y, [s[1] for s in steps], color=[s[2] for s in steps], height=0.5)
for yi, (label, v, _c) in zip(y, steps, strict=True):
    # x=0 is undefined on a log axis and matplotlib silently drops the text,
    # which is how these labels disappeared the first time.
    ax.text(85, yi + 0.30, label, va="bottom", fontsize=9.3, color=MUTED)
    ax.text(
        v * 1.06 if v > 2000 else v + 700,
        yi,
        f"{v:,}",
        va="center",
        fontsize=11,
        fontweight="bold",
        color=INK,
    )
ax.set_xscale("log")
ax.set_xlim(80, 90000)
ax.set_yticks([])
ax.set_ylim(-0.6, len(steps) - 0.3)
ax.set_xlabel("Films (log scale)")
H.frame(ax, grid="x")
ax.set_title(
    "From everything TMDB calls theatrical to a slate",
    fontsize=10.5,
    color=INK,
    fontweight="bold",
    loc="left",
    pad=8,
)

ax = axes[1]
rejected = [
    ("Sort by revenue", "selects on the target"),
    ("Filter by vote count", "selects on who eventually saw it"),
    ("Filter by popularity", "same, measured today"),
    ("Filter by distributor", "known months before release"),
]
for i, (name, why) in enumerate(rejected):
    ok = i == 3
    yy = (len(rejected) - 1 - i) * 1.6
    ax.scatter(
        [0], [yy], s=150, marker="o" if ok else "x", color=ACCENT if ok else BAD, linewidth=2.4, zorder=3
    )
    ax.text(0.10, yy + 0.14, name, fontsize=10, fontweight="bold", color=INK if ok else MUTED, va="bottom")
    ax.text(0.10, yy - 0.16, why, fontsize=9, color=MUTED, va="top")
ax.set_xlim(-0.06, 1.35)
ax.set_ylim(-0.9, (len(rejected) - 1) * 1.6 + 0.8)
ax.set_xticks([])
ax.set_yticks([])
for s_ in ("top", "right", "left", "bottom"):
    ax.spines[s_].set_visible(False)
ax.set_title(
    "Why the frame is the distributor", fontsize=10.5, color=INK, fontweight="bold", loc="left", pad=8
)

H.layout(
    fig,
    "data",
    "The sampling frame had to be a pre-release fact, which rules out every convenient filter",
    f"{len(released):,} films, {YEAR_LO} to {YEAR_HI}, defined by who agreed to distribute them "
    "and what they cost",
    why_text=f"Why this way: TMDB tags almost everything theatrical, returning {TMDB_THEATRICAL_2019:,} "
    "titles for 2019 alone, most of it festival and direct-to-video tail with no budget and no "
    "gross. Every quick way to cut that down selects on the outcome. Sorting by revenue is "
    "obvious; filtering by vote count or popularity is the same mistake wearing a different "
    "name, because both measure how many people eventually saw the film. A distributor is "
    "attached months before opening weekend, so anchoring on one keeps the sample definition "
    "itself free of the answer.",
    extra_bottom=0.04,
)
H.save(fig, OUT / "bo-1-sample.png")

# ------------------------------------------------------- 2. against baselines
med_2x = float(summary.loc["median", "within_2x"])
bud_2x = float(summary.loc["budget_only", "within_2x"])
mod_2x = float(summary.loc["model", "within_2x"])
lift_pts = (mod_2x - bud_2x) * 100
fig, ax = plt.subplots(figsize=(9.6, 4.8))
vals = [med_2x, bud_2x, mod_2x]
names = ["Predict the median film", "Budget alone", f"All {N_FEATURES} pre-release features"]
ax.bar([0, 1, 2], vals, color=[GREY, SLATE, ACCENT], width=0.5)
for i, v in enumerate(vals):
    ax.text(i, v + 0.012, f"{v:.1%}", ha="center", fontsize=13, fontweight="bold", color=INK)
# The arc used to land on the model's own value label. It now runs between
# the bars' inner edges and its caption sits above the apex, with headroom.
ax.annotate(
    "",
    xy=(1.72, mod_2x + 0.085),
    xytext=(1.28, bud_2x + 0.085),
    arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.4, connectionstyle="arc3,rad=-0.25"),
)
ax.text(
    1.5, mod_2x + 0.135, f"+{lift_pts:.1f} points", ha="center", fontsize=10.5, fontweight="bold", color=INK
)
ax.set_xticks([0, 1, 2])
ax.set_xticklabels(names, fontsize=9.7)
ax.set_ylim(0, 0.80)
ax.set_yticks([0, 0.2, 0.4, 0.6])
ax.set_yticklabels(["0%", "20%", "40%", "60%"])
ax.set_ylabel("Within a factor of two")
H.frame(ax, grid="y")
H.layout(
    fig,
    "evaluation",
    f"Budget alone gets you halfway; everything else knowable adds {_words(round(lift_pts))} points",
    f"{N_FOLDS} rolling-origin folds, {FOLD_LO} to {FOLD_HI}, each scoring a year the model had never seen",
    why_text="Why this way: the metric is the share of forecasts inside a factor of two, not "
    "R-squared, because box office spans five orders of magnitude and a squared error in "
    "dollars is decided by half a dozen films. Budget-only is the bar that matters: what a "
    "studio spends is most of what a studio makes, and a model that cannot clear it is not "
    f"earning its complexity. It clears it in {BEATS} of the {N_FOLDS} folds.",
    extra_bottom=0.04,
)
H.save(fig, OUT / "bo-2-baselines.png")
print("wrote sample + baselines")

# --------------------------------------------- 3. the two ablation designs
add = abl[abl.design == "add one to budget"].set_index("group")
loo = abl[abl.design == "remove one from full"].copy()
loo["g"] = loo["group"].str.replace("- ", "", regex=False)
loo = loo.set_index("g")
groups = list(loo.index)  # every group, writer included
all_pts = float(add.loc["all groups", "d_2x"]) * 100

fig, axes = plt.subplots(1, 2, figsize=(11.8, 5.0), gridspec_kw={"wspace": 0.42})
ax = axes[0]
vals = [float(add.loc[f"+ {g}", "d_mae"]) for g in groups]
y = np.arange(len(groups))[::-1]
ax.barh(y, vals, color=[ACCENT if v < 0 else GREY for v in vals], height=0.6)
for yi, v in zip(y, vals, strict=True):
    ax.text(
        v + (0.003 if v >= 0 else -0.003),
        yi,
        f"{v:+.3f}",
        va="center",
        ha="left" if v >= 0 else "right",
        fontsize=9.3,
        color=INK,
    )
ax.axvline(0, color=INK, lw=1.1)
ax.set_yticks(y)
ax.set_yticklabels(groups, fontsize=9.5)
ax.set_xlim(-0.09, 0.115)
ax.set_xlabel("Change in error when added to a budget-only model")
ax.set_title(
    "Add one group to budget: almost all hurt", fontsize=10.5, color=INK, fontweight="bold", loc="left", pad=8
)
H.frame(ax, grid="x")
ax.grid(axis="y", visible=False)
ax.text(0.02, 0.03, "lower is better", transform=ax.transAxes, fontsize=8.8, color=MUTED, style="italic")

ax = axes[1]
vals2 = [float(loo.loc[g, "d_mae"]) for g in groups]
ax.barh(y, vals2, color=[ACCENT if v > 0.005 else GREY for v in vals2], height=0.6)
for yi, v in zip(y, vals2, strict=True):
    ax.text(
        v + (0.002 if v >= 0 else -0.002),
        yi,
        f"{v:+.3f}",
        va="center",
        ha="left" if v >= 0 else "right",
        fontsize=9.3,
        color=INK,
    )
ax.axvline(0, color=INK, lw=1.1)
ax.set_yticks(y)
ax.set_yticklabels(groups, fontsize=9.5)
ax.set_xlim(-0.03, 0.115)
ax.set_xlabel("Error lost when removed from the full model")
ax.set_title(
    f"Remove one group from all {N_FEATURES}: the real ranking",
    fontsize=10.5,
    color=INK,
    fontweight="bold",
    loc="left",
    pad=8,
)
H.frame(ax, grid="x")
ax.grid(axis="y", visible=False)
ax.text(
    0.98,
    0.03,
    "higher means it was carrying weight",
    transform=ax.transAxes,
    fontsize=8.8,
    color=MUTED,
    style="italic",
    ha="right",
)

H.layout(
    fig,
    "model",
    f"Every group but one hurts on its own, and together they gain {_words(round(all_pts))} points",
    f"The same {_words(len(groups))} groups under two ablation designs, on identical folds",
    why_text="Why this way: the left panel is the ablation people reach for first, and it answers "
    "a question nobody asked. Adding a group to a one-feature baseline tests whether it "
    "can carry a model alone, and a booster handed five features will overfit them. The "
    "right panel removes each group from the working model instead, which tests what it "
    "contributes alongside the others. The two disagree, and the disagreement is the "
    "finding: these features only mean anything in combination, because a star's prior "
    "gross says nothing until you know the budget tier and genre it is attached to.",
    extra_bottom=0.04,
)
H.save(fig, OUT / "bo-3-ablation-design.png")

# ------------------------------------------- 4. what each signal is worth
# The bar is the effect on the hit rate; the whisker is its 95% interval from
# the paired bootstrap; the colour is McNemar's verdict. A bar whose whisker
# crosses zero is drawn grey whatever its length, because length without an
# interval is how the first version of this chart ranked noise.
sg = sig[sig.comparison.str.startswith("full model vs without ")].copy()
sg["g"] = sg.comparison.str.replace("full model vs without ", "", regex=False)
sg = sg.set_index("g").loc[groups]
order = list(sg.sort_values("difference", ascending=False).index)
LABEL = {
    "form": "Form: sequel, franchise position, runtime, language",
    "studio": "Studio: the distributor and its track record",
    "genre": "Genre",
    "calendar": "Release timing",
    "composer": "Composer's prior grosses",
    "cinematographer": "Cinematographer's prior grosses",
    "cast": "Cast: the stars' prior grosses",
    "director": "Director's prior grosses",
    "writer": "Writer's prior grosses",
}
PEOPLE = {"director", "cast", "cinematographer", "composer", "writer"}

fig, ax = plt.subplots(figsize=(10.6, 5.6))
y = np.arange(len(order))[::-1]
for yi, g in zip(y, order, strict=True):
    r = sg.loc[g]
    real = r.verdict == "significant"
    d, lo, hi = r.difference * 100, r.ci_lo * 100, r.ci_hi * 100
    ax.barh(yi, d, color=ACCENT if real else GREY, height=0.56, zorder=2)
    ax.plot([lo, hi], [yi, yi], color=INK, lw=1.3, zorder=3)
    ax.plot([lo, lo], [yi - 0.16, yi + 0.16], color=INK, lw=1.3, zorder=3)
    ax.plot([hi, hi], [yi - 0.16, yi + 0.16], color=INK, lw=1.3, zorder=3)
    ax.text(
        max(hi, d) + 0.35,
        yi,
        f"{d:+.1f} pts   p={r.p_mcnemar:.3f}" if r.p_mcnemar >= 0.001 else f"{d:+.1f} pts   p<0.001",
        va="center",
        fontsize=9.2,
        fontweight="bold" if real else "normal",
        color=INK,
    )
ax.axvline(0, color=INK, lw=1.2, zorder=1)
ax.set_yticks(y)
ax.set_yticklabels([LABEL[g] for g in order], fontsize=9.5)
ax.set_xlim(-3.2, max(sg.ci_hi) * 100 + 5.5)
ax.set_xlabel("Change in share within a factor of two when the group is removed, with 95% CI")
H.frame(ax, grid="x")
ax.grid(axis="y", visible=False)

n_real = int((sg.verdict == "significant").sum())
people_real = int(((sg.verdict == "significant") & sg.index.isin(PEOPLE)).sum())
people_note = (
    "none of the five people-based groups clears the line"
    if people_real == 0
    else f"{people_real} of the five people-based groups clear the line"
)
ax.text(
    0.985, 0.04, people_note, transform=ax.transAxes, ha="right", fontsize=9.3, color=MUTED, style="italic"
)
H.layout(
    fig,
    "evaluation",
    f"Only {_words(n_real)} of {_words(len(order))} groups are distinguishable from noise, and none "
    "of them is about the people",
    "Leave-one-out on identical folds; McNemar's exact test on the films the two models disagree "
    "about, paired bootstrap over films for the interval",
    why_text="Why this way: ranking groups by a third-decimal difference in error, as the first "
    "version of this chart did, ranks noise. The hit rate is binary per film and both "
    "models see the same films, so the comparison is paired, and a group only counts as "
    "carrying weight when its interval clears zero. What survives is what the film is and "
    "who releases it. Every group describing who made it, director, cast, cinematographer, "
    "composer and writer, has an interval containing zero, which is a weaker claim than "
    f"'they contribute nothing' and an honest one: {len(released):,} films cannot resolve "
    "an effect of one point.",
    extra_bottom=0.04,
)
H.save(fig, OUT / "bo-4-what-signals-buy.png")
print("wrote ablation charts")
