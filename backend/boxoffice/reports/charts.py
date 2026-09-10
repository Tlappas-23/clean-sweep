"""
Figures for the box office study, in the same house style as the portfolio.

One chart per decision, each titled with what it found rather than what it
plots, and each carrying the reasoning for its step underneath.
"""
from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import house as H
from house import ACCENT, SLATE, GREY, INK, MUTED, LINE, BAD
import matplotlib.pyplot as plt

DATA = HERE.parent / "data"
OUT = HERE / "figures"
OUT.mkdir(parents=True, exist_ok=True)

feat = pd.read_parquet(DATA / "features.parquet")
abl = pd.read_csv(DATA / "ablation.csv")

# ------------------------------------------------------------ 1. the sample
fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.7),
                         gridspec_kw={"width_ratios": [1.1, 1], "wspace": 0.32})
ax = axes[0]
steps = [("TMDB titles tagged theatrical, 2019", 37486, GREY),
         ("From 42 major and mini-major distributors", 174, SLATE),
         ("Above the $1M budget floor, 2000-2025", 2647, SLATE),
         ("With a reported worldwide gross", len(feat), ACCENT)]
y = np.arange(len(steps))[::-1]
ax.barh(y, [s[1] for s in steps], color=[s[2] for s in steps], height=0.5)
for yi, (label, v, c) in zip(y, steps):
    # x=0 is undefined on a log axis and matplotlib silently drops the text,
    # which is how these labels disappeared the first time.
    ax.text(85, yi + 0.30, label, va="bottom", fontsize=9.3, color=MUTED)
    ax.text(v * 1.06 if v > 2000 else v + 700, yi, f"{v:,}", va="center",
            fontsize=11, fontweight="bold", color=INK)
ax.set_xscale("log"); ax.set_xlim(80, 90000)
ax.set_yticks([]); ax.set_ylim(-0.6, len(steps) - 0.3)
ax.set_xlabel("Films (log scale)")
H.frame(ax, grid="x")
ax.set_title("From everything TMDB calls theatrical to a slate", fontsize=10.5,
             color=INK, fontweight="bold", loc="left", pad=8)

ax = axes[1]
rejected = [("Sort by revenue", "selects on the target"),
            ("Filter by vote count", "selects on who eventually saw it"),
            ("Filter by popularity", "same, measured today"),
            ("Filter by distributor", "known months before release")]
for i, (name, why) in enumerate(rejected):
    ok = i == 3
    # Rows spaced wider than 1.0: each carries two lines of type and they
    # were colliding with the row beneath.
    yy = (len(rejected) - 1 - i) * 1.6
    ax.scatter([0], [yy], s=150, marker="o" if ok else "x",
               color=ACCENT if ok else BAD, linewidth=2.4, zorder=3)
    ax.text(0.10, yy + 0.14, name, fontsize=10, fontweight="bold",
            color=INK if ok else MUTED, va="bottom")
    ax.text(0.10, yy - 0.16, why, fontsize=9, color=MUTED, va="top")
ax.set_xlim(-0.06, 1.35); ax.set_ylim(-0.9, (len(rejected) - 1) * 1.6 + 0.8)
ax.set_xticks([]); ax.set_yticks([])
for s_ in ("top", "right", "left", "bottom"):
    ax.spines[s_].set_visible(False)
ax.set_title("Why the frame is the distributor", fontsize=10.5, color=INK,
             fontweight="bold", loc="left", pad=8)

H.layout(fig, "data",
  f"The sampling frame had to be a pre-release fact, which rules out every convenient filter",
  f"{len(feat):,} films, 2000 to 2025, defined by who agreed to distribute them "
  "and what they cost",
  why_text="Why this way: TMDB tags almost everything theatrical, returning 37,486 titles for "
           "2019 alone, most of it festival and direct-to-video tail with no budget and no gross. "
           "Every quick way to cut that down selects on the outcome. Sorting by revenue is "
           "obvious; filtering by vote count or popularity is the same mistake wearing a "
           "different name, because both measure how many people eventually saw the film. A "
           "distributor is attached months before opening weekend, so anchoring on one keeps the "
           "sample definition itself free of the answer.",
  extra_bottom=0.04)
H.save(fig, OUT / "bo-1-sample.png")

# ------------------------------------------------------- 2. against baselines
base = abl[abl.design == "add one to budget"]
med_2x, bud_2x = 0.310, 0.473
mod_2x = float(base[base.group == "all groups"]["within_2x"].iloc[0])
fig, ax = plt.subplots(figsize=(9.6, 4.8))
vals = [med_2x, bud_2x, mod_2x]
names = ["Predict the median film", "Budget alone", "All 35 pre-release features"]
ax.bar([0, 1, 2], vals, color=[GREY, SLATE, ACCENT], width=0.5)
for i, v in enumerate(vals):
    ax.text(i, v + 0.012, f"{v:.1%}", ha="center", fontsize=13,
            fontweight="bold", color=INK)
ax.annotate("", xy=(2, mod_2x + 0.055), xytext=(1, bud_2x + 0.055),
            arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.4,
                            connectionstyle="arc3,rad=-0.2"))
ax.text(1.5, mod_2x + 0.095, f"+{(mod_2x - bud_2x) * 100:.1f} points", ha="center",
        fontsize=10.5, fontweight="bold", color=INK)
ax.set_xticks([0, 1, 2]); ax.set_xticklabels(names, fontsize=9.7)
ax.set_ylim(0, 0.72)
ax.set_yticks([0, 0.2, 0.4, 0.6]); ax.set_yticklabels(["0%", "20%", "40%", "60%"])
ax.set_ylabel("Within a factor of two")
H.frame(ax, grid="y")
H.layout(fig, "evaluation",
  "Budget alone gets you halfway; everything else knowable adds eight points",
  "16 rolling-origin folds, 2010 to 2025, each scoring a year the model had "
  "never seen",
  why_text="Why this way: the metric is the share of forecasts inside a factor of two, not "
           "R-squared, because box office spans five orders of magnitude and a squared error in "
           "dollars is decided by half a dozen films. Budget-only is the bar that matters: what a "
           "studio spends is most of what a studio makes, and a model that cannot clear it is not "
           "earning its complexity. It clears it in 15 of the 16 folds.",
  extra_bottom=0.04)
H.save(fig, OUT / "bo-2-baselines.png")
print("wrote sample + baselines")

# --------------------------------------------- 3. the two ablation designs
add = abl[abl.design == "add one to budget"].set_index("group")
loo = abl[abl.design == "remove one from full"].copy()
loo["g"] = loo["group"].str.replace("- ", "", regex=False)
loo = loo.set_index("g")
groups = ["form", "studio", "genre", "calendar", "composer",
          "cinematographer", "cast", "director"]

fig, axes = plt.subplots(1, 2, figsize=(11.8, 5.0), gridspec_kw={"wspace": 0.42})
ax = axes[0]
vals = [float(add.loc[f"+ {g}", "d_mae"]) for g in groups]
y = np.arange(len(groups))[::-1]
ax.barh(y, vals, color=[ACCENT if v < 0 else GREY for v in vals], height=0.6)
for yi, v in zip(y, vals):
    ax.text(v + (0.003 if v >= 0 else -0.003), yi, f"{v:+.3f}", va="center",
            ha="left" if v >= 0 else "right", fontsize=9.3, color=INK)
ax.axvline(0, color=INK, lw=1.1)
ax.set_yticks(y); ax.set_yticklabels(groups, fontsize=9.5)
ax.set_xlim(-0.09, 0.115)
ax.set_xlabel("Change in error when added to a budget-only model")
ax.set_title("Add one group to budget: almost all hurt", fontsize=10.5,
             color=INK, fontweight="bold", loc="left", pad=8)
H.frame(ax, grid="x"); ax.grid(axis="y", visible=False)
ax.text(0.02, 0.03, "lower is better", transform=ax.transAxes, fontsize=8.8,
        color=MUTED, style="italic")

ax = axes[1]
vals2 = [float(loo.loc[g, "d_mae"]) for g in groups]
ax.barh(y, vals2, color=[ACCENT if v > 0.005 else GREY for v in vals2], height=0.6)
for yi, v in zip(y, vals2):
    ax.text(v + (0.002 if v >= 0 else -0.002), yi, f"{v:+.3f}", va="center",
            ha="left" if v >= 0 else "right", fontsize=9.3, color=INK)
ax.axvline(0, color=INK, lw=1.1)
ax.set_yticks(y); ax.set_yticklabels(groups, fontsize=9.5)
ax.set_xlim(-0.03, 0.115)
ax.set_xlabel("Error lost when removed from the full model")
ax.set_title("Remove one group from all 35: the real ranking", fontsize=10.5,
             color=INK, fontweight="bold", loc="left", pad=8)
H.frame(ax, grid="x"); ax.grid(axis="y", visible=False)
ax.text(0.98, 0.03, "higher means it was carrying weight", transform=ax.transAxes,
        fontsize=8.8, color=MUTED, style="italic", ha="right")

H.layout(fig, "model",
  "Every group but one hurts on its own, and together they gain eleven points",
  "The same eight groups under two ablation designs, on identical folds",
  why_text="Why this way: the left panel is the ablation people reach for first, and it answers "
           "a question nobody asked. Adding a group to a one-feature baseline tests whether it "
           "can carry a model alone, and a booster handed five features and four hundred "
           "iterations will overfit them. The right panel removes each group from the working "
           "model instead, which tests what it contributes alongside the others. The two "
           "disagree, and the disagreement is the finding: these features only mean anything in "
           "combination, because a star's prior gross says nothing until you know the budget tier "
           "and genre it is attached to.",
  extra_bottom=0.04)
H.save(fig, OUT / "bo-3-ablation-design.png")

# ------------------------------------------- 4. what each signal is worth
order = sorted(groups, key=lambda g: -float(loo.loc[g, "d_mae"]))
fig, ax = plt.subplots(figsize=(10.2, 5.2))
vals = [float(loo.loc[g, "d_mae"]) for g in order]
y = np.arange(len(order))[::-1]
cols = [ACCENT if v > 0.03 else (SLATE if v > 0.005 else GREY) for v in vals]
ax.barh(y, vals, color=cols, height=0.6)
LABEL = {"form": "Form: sequel, franchise position, runtime, language",
         "studio": "Studio: the distributor and its track record",
         "genre": "Genre", "calendar": "Release timing",
         "composer": "Composer's prior grosses",
         "cinematographer": "Cinematographer's prior grosses",
         "cast": "Cast: the stars' prior grosses",
         "director": "Director's prior grosses"}
for yi, (g, v) in zip(y, zip(order, vals)):
    ax.text(v + 0.0025, yi, f"{v:+.3f}", va="center", fontsize=9.5,
            fontweight="bold" if v > 0.03 else "normal", color=INK)
ax.set_yticks(y); ax.set_yticklabels([LABEL[g] for g in order], fontsize=9.5)
ax.axvline(0, color=INK, lw=1.2)
ax.set_xlim(-0.02, 0.115)
ax.set_xlabel("Error the full model loses when this group is removed")
H.frame(ax, grid="x"); ax.grid(axis="y", visible=False)
ax.text(0.985, 0.04, "the three people-based groups sit at zero",
        transform=ax.transAxes, ha="right", fontsize=9.3, color=MUTED, style="italic")

H.layout(fig, "evaluation",
  "The distributor predicts better than the cast, the director or the cinematographer",
  "What the film is worth more than who made it: sequel status and franchise "
  "position carry twice what the studio does, and the people carry nothing",
  why_text="Why this way: the three groups built from who is attached to the film contribute "
           "nothing measurable. Cinematographer lands at exactly zero, which was the prediction "
           "before the run and is now the data's answer rather than an assertion. Cast is "
           "indistinguishable from zero, so a star's prior box office does not predict the next "
           "one at this sample size. Removing the director slightly improves the model. The "
           "signal that survives is what the film is, not who is in it, and half of that is "
           "simply whether it is a sequel and where in its franchise it sits.",
  extra_bottom=0.04)
H.save(fig, OUT / "bo-4-what-signals-buy.png")
print("wrote ablation charts")
