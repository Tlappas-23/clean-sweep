"""
Two figures for the classification result, in the house style.

The first is the reliability diagram, which is the figure that decides whether
a probability may be quoted at all. The second is the decision view: at each
threshold for flagging a film as not profitable, what share of the unprofitable
films are caught and how often the flag is right, model against the budget-tier
prior. That second figure is the one a studio would actually look at, because
it is a curve of choices rather than a single number.
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
from house import ACCENT, SLATE, GREY, MUTED, LINE
import matplotlib.pyplot as plt

DATA = HERE.parent / "data"
OUT = HERE / "figures"
OUT.mkdir(parents=True, exist_ok=True)

folds = pd.read_parquet(DATA / "classify_folds.parquet")
y_profit = (folds["y"] == 2).to_numpy().astype(int)
p_model = folds["p_profit"].to_numpy()
p_prior = folds["prior_profit"].to_numpy()

# ------------------------------------------------------ 1. reliability
fig, ax = plt.subplots(figsize=(6.4, 5.6))
edges = np.linspace(0, 1, 11)
for arr, colour, label in [(p_prior, GREY, "budget-tier prior"),
                           (p_model, ACCENT, "model, calibrated in-fold")]:
    idx = np.clip(np.digitize(arr, edges) - 1, 0, 9)
    xs, ys, ns = [], [], []
    for b in range(10):
        m = idx == b
        if m.sum() >= 15:
            xs.append(arr[m].mean()); ys.append(y_profit[m].mean()); ns.append(m.sum())
    ax.plot(xs, ys, "-o", color=colour, lw=1.6, ms=4.5, label=label, zorder=3)
ax.plot([0, 1], [0, 1], color=LINE, lw=1, ls="--", zorder=2)
ax.set_xlim(0, 1); ax.set_ylim(0, 1)
ax.set_xlabel("predicted probability of profit")
ax.set_ylabel("share that were profitable")
ax.legend(frameon=False, loc="upper left", fontsize=9)
H.frame(ax, grid="both")
H.layout(fig, "evaluation",
         "When the model says 60%, about 60% turn a profit",
         f"{len(folds):,} films scored out of fold, 2010 to 2026; bins with fewer than 15 films omitted",
         why_text=("A probability is only worth quoting if it means what it says. The raw booster "
                   "assigned a third of films a class probability above 0.99 and was wrong on 8% of "
                   "them; regularising it and calibrating on held-out slices of the training years "
                   "put it on the diagonal."))
H.save(fig, OUT / "bo-5-reliability.png")

# ------------------------------------------------------ 2. decision curve
fig, ax = plt.subplots(figsize=(6.8, 5.4))
ts = np.linspace(0.15, 0.85, 36)
for arr, colour, label in [(p_prior, GREY, "budget-tier prior"),
                           (p_model, ACCENT, "model")]:
    recall, precision = [], []
    for t in ts:
        flag = arr < t
        nonprofit = y_profit == 0
        recall.append((flag & nonprofit).sum() / max(nonprofit.sum(), 1))
        precision.append((flag & nonprofit).sum() / max(flag.sum(), 1) if flag.any() else np.nan)
    ax.plot(recall, precision, "-", color=colour, lw=1.8, label=label, zorder=3)
base = (y_profit == 0).mean()
ax.axhline(base, color=LINE, lw=1, ls="--", zorder=2)
ax.text(0.02, base + 0.012, f"flag everything: {base:.0%} precision", fontsize=8.6, color=MUTED)
ax.set_xlim(0, 1); ax.set_ylim(0.3, 0.9)
ax.set_xlabel("share of unprofitable films caught")
ax.set_ylabel("share of flagged films that were unprofitable")
ax.legend(frameon=False, loc="upper right", fontsize=9)
H.frame(ax, grid="both")
H.layout(fig, "evaluation",
         "At any catch rate, the model's flags are right more often than budget tier alone",
         "flag a film as not profitable when P(profit) falls below a threshold, swept from 0.15 to 0.85",
         why_text=("This is the curve a greenlight decision actually lives on. Budget tier is a strong "
                   "prior and a fair opponent; the gap between the lines is what thirty-seven other "
                   "pre-release facts are worth once you already know the budget."))
H.save(fig, OUT / "bo-6-decision-curve.png")
print("wrote bo-5-reliability.png, bo-6-decision-curve.png")
