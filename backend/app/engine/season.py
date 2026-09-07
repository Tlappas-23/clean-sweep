"""
The awards circuit (``app.engine.season``): 30 ceremonies and the season simulation.

Design (docs/GAME_DESIGN.md §4)
-------------------------------
A season is a fixed table of 30 ceremonies in ascending difficulty, from
regional critics' circles through the guilds to the Academy Awards. Each has

* a **threshold** on a convex curve, so the last few stops need a near
  perfect ballot, and
* an **emphasis vector** over the six categories (summing to 1), so a body
  that cares about directing weights Best Director heavily.

The ballot wins a ceremony when its emphasis-weighted strength clears the
threshold. Thresholds alone cannot separate "six winners" from "five
winners plus one un-nominated pick" -- the calibration below shows those
two distributions overlap on a plain average -- so the *deficiency rule*
does the work: six "specialist" ceremonies late in the season each put
``FOCUS_WEIGHT`` on one category. An un-nominated pick can score at most
~38 (its Academy metric is 0), which sinks the ballot at that category's
specialist no matter how strong the other five slots are.

Calibration (``python -m app.engine.calibrate``, 20 000 random six-year
draws against the committed seed with ML prestige joined)
----------------------------------------------------------------------
See the constants block below; the numbers quoted there come from the
script and should be refreshed whenever the seed or the metric weights
change.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import Category
from app.models.results import CeremonyResult

# --- calibrated constants ----------------------------------------------------
#
# Threshold curve:  t_i = T_MIN + (T_MAX - T_MIN) * ((i - 1) / 29) ** CURVE_POWER
#
# Numbers from ``python -m app.engine.calibrate`` (20k six-year draws against
# the committed seed with ML prestige joined, box office still absent):
#   * best achievable pick score per (year, category) pool: median 90.5;
#     best *winner* median 90.8, floor 63.4 (supporting actress winners are
#     the weakest slot: 10th percentile 70.9 vs 82.3 for Best Picture).
#   * best *un-nominated* pick in any pool: at most 52.9 (its Academy metric
#     is 0; a strong snub can still max out prestige/acclaim/popularity).
#   * perfect ballot (actual winner in all six slots): mean 88.5, 10th
#     percentile 84.0. Five winners + the best snub: median 84.5, max 90.5,
#     so on a uniform average the two overlap -- no T_MAX separates them.
# Chosen: T_MAX = 80 lets a perfect ballot clear the Academy Awards in 99 %
# of draws. FOCUS_WEIGHT = 0.85 on the six specialists at stops 22-27
# (thresholds 61.9-73.2) guarantees a one-snub ballot fails its category's
# specialist even in the worst case (0.85*52.9 + 0.15*100 = 60.0 < 61.9),
# while the perfect ballot sweeps all 30 in 97 % of draws that have a
# winner in every pool (ordering the specialists weakest-category-first
# is what lifts that from 90 % to 97 %).
T_MIN = 35.0
T_MAX = 80.0
CURVE_POWER = 1.6
N_CEREMONIES = 30
FOCUS_WEIGHT = 0.85  # share of emphasis on a specialist ceremony's own category


def threshold_for(index: int) -> float:
    """Threshold of ceremony ``index`` (1-based) on the convex curve, rounded for display."""
    progress = (index - 1) / (N_CEREMONIES - 1)
    return round(T_MIN + (T_MAX - T_MIN) * progress**CURVE_POWER, 2)


# --- emphasis presets --------------------------------------------------------

_CATS = list(Category)


def _emphasis(
    picture: float, director: float, actor: float, actress: float, sup_actor: float, sup_actress: float
) -> dict[Category, float]:
    """Build an emphasis vector and assert it is a proper distribution."""
    vector = dict(zip(_CATS, (picture, director, actor, actress, sup_actor, sup_actress), strict=True))
    assert abs(sum(vector.values()) - 1.0) < 1e-9, vector
    return vector


def _focus(category: Category) -> dict[Category, float]:
    """A specialist vector: ``FOCUS_WEIGHT`` on one category, the rest shared equally."""
    rest = (1.0 - FOCUS_WEIGHT) / (len(_CATS) - 1)
    return {c: (FOCUS_WEIGHT if c == category else rest) for c in _CATS}


UNIFORM = _emphasis(1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6)
# Critics' groups: film and director first, performances a little behind.
CRITICS = _emphasis(0.25, 0.20, 0.15, 0.15, 0.125, 0.125)
# Auteur-minded bodies lean into directing.
AUTEUR = _emphasis(0.20, 0.35, 0.125, 0.125, 0.10, 0.10)
# Festival tributes and the Globes honour the lead performances.
LEAD_ACTING = _emphasis(0.15, 0.10, 0.25, 0.25, 0.125, 0.125)
# Ensemble prizes spread across all four acting slots.
ENSEMBLE = _emphasis(0.10, 0.10, 0.20, 0.20, 0.20, 0.20)
# Breakthrough / supporting spotlights.
SUPPORTING = _emphasis(0.10, 0.10, 0.15, 0.15, 0.25, 0.25)
# Film-of-the-year lists care mostly about the picture.
PICTURE = _emphasis(0.45, 0.15, 0.10, 0.10, 0.10, 0.10)


@dataclass(frozen=True, slots=True)
class Ceremony:
    """One stop on the circuit."""

    index: int  # 1-30, ascending difficulty
    name: str
    emphasis: dict[Category, float]
    threshold: float


# The circuit, in order. Names are real-world flavoured stops; the order
# roughly follows the calendar (critics in December, guilds in the new year,
# the Oscars last) and, more importantly, ascends in difficulty.
_CIRCUIT: list[tuple[str, dict[Category, float]]] = [
    ("National Board of Review", CRITICS),
    ("New York Film Critics Circle", CRITICS),
    ("Los Angeles Film Critics Association", AUTEUR),
    ("Boston Society of Film Critics", CRITICS),
    ("Chicago Film Critics Association", UNIFORM),
    ("San Francisco Film Critics Circle", CRITICS),
    ("Washington DC Area Film Critics", UNIFORM),
    ("Toronto Film Critics Association", AUTEUR),
    ("Dallas-Fort Worth Film Critics", UNIFORM),
    ("Florida Film Critics Circle", CRITICS),
    ("Gotham Awards", PICTURE),
    ("Satellite Awards", UNIFORM),
    ("Online Film Critics Society", CRITICS),
    ("Southeastern Film Critics", UNIFORM),
    ("London Film Critics' Circle", CRITICS),
    ("National Society of Film Critics", AUTEUR),
    ("AFI Awards", PICTURE),
    ("Palm Springs Film Festival Tributes", LEAD_ACTING),
    ("Santa Barbara Film Festival Tributes", SUPPORTING),
    ("Critics Choice Awards", UNIFORM),
    ("Golden Globes (Musical/Comedy)", LEAD_ACTING),
    # --- the specialists: one per category (deficiency rule). Weakest
    # winner distribution first so each faces the gentlest threshold it can.
    ("Screen Actors Guild (Supporting Actress)", _focus(Category.SUPPORTING_ACTRESS)),
    ("Screen Actors Guild (Supporting Actor)", _focus(Category.SUPPORTING_ACTOR)),
    ("Screen Actors Guild (Lead Actress)", _focus(Category.ACTRESS)),
    ("Screen Actors Guild (Lead Actor)", _focus(Category.ACTOR)),
    ("Directors Guild of America", _focus(Category.DIRECTOR)),
    ("Producers Guild of America", _focus(Category.PICTURE)),
    # --- the home stretch ---
    ("Golden Globes (Drama)", LEAD_ACTING),
    ("BAFTA", UNIFORM),
    ("Academy Awards", UNIFORM),
]
assert len(_CIRCUIT) == N_CEREMONIES

CEREMONIES: tuple[Ceremony, ...] = tuple(
    Ceremony(index=i, name=name, emphasis=emphasis, threshold=threshold_for(i))
    for i, (name, emphasis) in enumerate(_CIRCUIT, start=1)
)


# --- simulation --------------------------------------------------------------


def weighted_strength(pick_scores: dict[Category, float], emphasis: dict[Category, float]) -> float:
    """Σ emphasis_c · pick_score_c. A missing category counts as 0 (an empty slot)."""
    return sum(weight * pick_scores.get(category, 0.0) for category, weight in emphasis.items())


def simulate(pick_scores: dict[Category, float]) -> list[CeremonyResult]:
    """
    Run a ballot through all 30 ceremonies. Deterministic: same ballot, same record.

    ``pick_scores`` maps each category to its 0-100 pick score.
    """
    results: list[CeremonyResult] = []
    for ceremony in CEREMONIES:
        strength = weighted_strength(pick_scores, ceremony.emphasis)
        results.append(
            CeremonyResult(
                name=ceremony.name,
                index=ceremony.index,
                threshold=ceremony.threshold,
                weighted_strength=round(strength, 2),
                emphasis=ceremony.emphasis,
                won=strength >= ceremony.threshold,
            )
        )
    return results


def weakest_category(pick_scores: dict[Category, float]) -> Category | None:
    """The slot with the lowest pick score (ties -> ballot order); ``None`` for an empty ballot."""
    if not pick_scores:
        return None
    return min(_CATS, key=lambda c: (pick_scores.get(c, 0.0), _CATS.index(c)))
