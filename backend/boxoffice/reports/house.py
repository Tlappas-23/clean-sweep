"""
House chart style for the portfolio's CRISP-DM figure sets.

Every basketball project on the site gets one chart per CRISP-DM phase, and
they all have to look like they came from the same studio, because eleven
projects drawn eleven ways reads as eleven one-off scripts rather than one
method applied repeatedly. So the palette, the type scale, the eyebrow, and
the caption block all live here and nothing downstream overrides them.

Two conventions worth stating, because they are the ones that make these
charts readable at a glance across a whole page:

  1. Colour carries meaning, not decoration. ACCENT marks the thing the
     chart is actually about; SLATE is the honest comparison it is measured
     against; GREY is context, a null result, or something that failed its
     test. A reader who learns that once can skim any chart on the site.

  2. Every figure names its CRISP-DM phase in the eyebrow. The phase is not
     a label stuck on afterwards; it is the reason the chart exists, and
     saying so is what turns a pile of plots into a documented method.
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

# Palette lifted from the site's own design tokens (assets/style.css) so the
# figures sit on the page rather than on top of it.
ACCENT = "#BE5420"   # the subject of the chart
SLATE  = "#45607A"   # the baseline or comparison series
GREY   = "#C7CBD2"   # context, nulls, things that failed their test
INK    = "#16181D"   # titles and value labels
MUTED  = "#5D6470"   # axis labels, ticks, captions
LINE   = "#E6E8EC"   # gridlines and spines
GOOD   = "#3F7A57"   # used sparingly, only where pass/fail is the point
BAD    = "#A33A3A"

# The site sets body copy in a system stack. Matplotlib cannot see that, so
# pick the closest face actually installed rather than letting it fall back
# to DejaVu, which looks nothing like the page around it.
_INSTALLED = {f.name for f in font_manager.fontManager.ttflist}
for _face in ("Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"):
    if _face in _INSTALLED:
        FONT = _face
        break

plt.rcParams.update({
    "figure.dpi": 200,
    "savefig.dpi": 200,
    "figure.facecolor": "white",
    "savefig.facecolor": "white",
    "font.family": FONT,
    "text.color": INK,
    "axes.facecolor": "white",
    "axes.edgecolor": LINE,
    "axes.labelcolor": MUTED,
    "axes.titlecolor": INK,
    "axes.labelsize": 10,
    "axes.titlesize": 12,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelsize": 9.5,
    "ytick.labelsize": 9.5,
    "legend.frameon": False,
    "legend.fontsize": 9.5,
    "grid.color": LINE,
    "grid.linewidth": 0.8,
})

# The six CRISP-DM phases, in order. Chart scripts pass one of these keys and
# get the canonical wording back, so a phase cannot be spelled two ways across
# eleven projects.
PHASES = {
    "business":    "1 · Business understanding",
    "data":        "2 · Data understanding",
    "prep":        "3 · Data preparation",
    "model":       "4 · Modeling",
    "evaluation":  "5 · Evaluation",
    "deployment":  "6 · Deployment",
}


def frame(ax, grid="y"):
    """Strip a matplotlib axes down to the site's flat, two-spine look."""
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(LINE)
    if grid:
        ax.set_axisbelow(True)
        ax.grid(axis=grid, color=LINE, linewidth=0.8)
        ax.grid(axis="x" if grid == "y" else "y", visible=False)


def titles(fig, phase, headline, sub=None, x=0.012):
    """
    Eyebrow, headline, optional standfirst, all left-aligned to the figure.

    Positioned in inches from the top edge rather than in figure fractions.
    Fractions were the original approach and they quietly broke every time a
    figure changed height: the same 0.125 that left a comfortable gap on a
    4.6-inch figure became a 0.8-inch drop on a 6.4-inch one, and the panel
    titles underneath collided with the standfirst. Inches are what the reader
    actually perceives, so the block sits identically on every figure.

    The headline states the finding rather than naming the variables, which is
    the convention the rest of the site already follows: a reader who only
    looks at titles should still come away with the results.
    """
    h = fig.get_size_inches()[1]
    fig.text(x, 1 - 0.30 / h, " ".join(PHASES[phase].upper()), fontsize=8.5,
             color=ACCENT, fontweight="bold", ha="left", va="center")
    fig.text(x, 1 - 0.60 / h, headline, fontsize=13.5, color=INK,
             fontweight="bold", ha="left", va="center")
    if sub:
        fig.text(x, 1 - 0.88 / h, sub, fontsize=10, color=MUTED, ha="left",
                 va="center")


def why(fig, text, x=0.012, y=0.018, width=None):
    """
    The 'why we did it this way' line that sits under every figure.

    The brief for these charts was explicitly that each one carries the
    reasoning for its step, so this is not a caption in the decorative sense;
    it is half the deliverable.

    Returns the number of lines drawn, because the caller has to reserve room
    for them. See `layout` below for why that is not optional.
    """
    import textwrap
    # Wrap to the figure's actual width rather than a fixed character count.
    # At 9.5pt the average glyph runs about 5.4 points wide, so a figure knows
    # how many characters it can hold; a hard-coded 150 overflows a narrow
    # figure and wastes half of a wide one.
    if width is None:
        width = max(60, int(fig.get_size_inches()[0] * 72 / 5.4))
    lines = textwrap.wrap(text, width)
    fig.text(x, y, "\n".join(lines), fontsize=9.5, color=MUTED, ha="left",
             va="bottom", style="italic", linespacing=1.5)
    return len(lines)


def layout(fig, phase, headline, sub=None, why_text=None, top=None,
           bottom=0.13, extra_bottom=0.0):
    """
    Titles, caption, and the margins that keep them off the chart.

    Both margins are computed rather than passed as constants, for the same
    reason: they depend on how much text there is and how tall the figure is,
    and a hand-tuned number is right once and wrong on the next figure. The
    top margin leaves a fixed 1.30 inches for the title block plus room for a
    panel title; the bottom reserves exactly the lines the caption wrapped to.
    """
    h = fig.get_size_inches()[1]
    titles(fig, phase, headline, sub)
    if top is None:
        top = 1 - (1.30 if sub else 1.00) / h
    reserved = bottom + extra_bottom
    if why_text:
        n = why(fig, why_text)
        line_frac = (9.5 * 1.55 / 72) / h
        reserved += n * line_frac + 0.035
    fig.subplots_adjust(top=top, bottom=reserved)
    return reserved


def spread(values, min_gap):
    """
    Nudge label positions apart while keeping their order.

    Slope charts and dot plots put a text label at each value, and wherever two
    values sit closer together than a line of type is tall, the labels overlap
    and both become unreadable. This walks the sorted positions and pushes each
    one down to at least `min_gap` below its predecessor, then recentres the
    whole run so the labels stay visually anchored to the data they annotate.

    Returns positions in the same order as `values`.
    """
    order = sorted(range(len(values)), key=lambda i: values[i], reverse=True)
    placed = list(values)
    for prev, idx in zip(order, order[1:]):
        if placed[prev] - placed[idx] < min_gap:
            placed[idx] = placed[prev] - min_gap
    shift = (sum(values) - sum(placed)) / len(values)
    return [p + shift for p in placed]


def save(fig, path):
    fig.savefig(path, bbox_inches="tight", pad_inches=0.28,
                facecolor="white")
    plt.close(fig)
    print("wrote", path)
