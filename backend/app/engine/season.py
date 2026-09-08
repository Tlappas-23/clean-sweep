"""
The awards circuit (``app.engine.season``): 30 ceremonies and the season simulation.

Design (docs/GAME_DESIGN.md §4)
-------------------------------
A season is a fixed table of 30 ceremonies in ascending difficulty, from
regional critics' circles through the guilds to the Academy Awards. Each has

* a **threshold** on a convex curve, so the last few stops need a near
  perfect ballot, and
* an **emphasis vector** over the eight categories (summing to 1), so a body
  that cares about directing weights Best Director heavily.

The ballot wins a ceremony when its emphasis-weighted strength clears the
threshold. Thresholds alone cannot separate a ballot of winners from one
carrying a single weak slot -- on a plain average those distributions
overlap -- so the *deficiency rule* does the work: eight "specialist"
ceremonies late in the season each put ``FOCUS_WEIGHT`` on one category. An
un-nominated pick scores near zero on the Academy metric, which sinks the
ballot at that category's specialist no matter how strong the rest is.

Calibration (``python -m app.engine.calibrate``, 20 000 random year
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
# Numbers from ``python -m app.engine.calibrate`` (20 000 random ballot draws
# against the committed seed, with ML prestige and TMDB box office joined):
#
#   ballot type                        sweeps at T_MAX 76
#   every actual winner and crown              0.8450
#   nominees and runners-up only               0.0040
#
# T_MAX = 76 is the top of the curve, and what it is protecting changed.
#
# It used to be 80, set so that drafting every real winner swept on *every*
# draw and a single un-nominated pick sank the season. That was the whole
# game: the sweep was the goal, so it had to be exactly achievable and
# exactly deniable. Holding that line is why the ceremony metric had to carry
# 0.60 of a pick's score, which in turn is why Fight Club scored 32.
#
# The score is the goal now, and the circuit is what the ballot *did* rather
# than whether it passed. So the curve is set for a readable spread instead
# of a gate: a perfect ballot sweeps most of the time but not always, an
# ordinary one wins a respectable share, and a ballot of losing nominees
# essentially never sweeps. Sweeping is an achievement on top of a score, not
# the only outcome that counts.
#
# FOCUS_WEIGHT = 0.92 on the eight specialists at stops 21-28 is what makes a
# weak slot expensive: each puts almost all its emphasis on one category, so a
# ballot cannot hide a bad pick behind seven good ones. That still holds, and
# it is what stops the circuit from being a restatement of the total score.
#
# What it deliberately does not do is punish a snub as such. A landmark film
# the Academy overlooked now scores well on quality and clears a specialist;
# a genuinely weak pick does not. The rule discriminates on how good the film
# is, which is the same thing the score does. See docs/BALANCE.md.
T_MIN = 35.0
T_MAX = 76.0
CURVE_POWER = 1.6
N_CEREMONIES = 30
FOCUS_WEIGHT = 0.92  # share of emphasis on a specialist ceremony's own category


def threshold_for(index: int) -> float:
    """Threshold of ceremony ``index`` (1-based) on the convex curve, rounded for display."""
    progress = (index - 1) / (N_CEREMONIES - 1)
    return round(T_MIN + (T_MAX - T_MIN) * progress**CURVE_POWER, 2)


# --- emphasis presets --------------------------------------------------------

_CATS = list(Category)


def _emphasis(**weights: float) -> dict[Category, float]:
    """
    Build an emphasis vector from category names, asserting it is a distribution.

    Taking keyword arguments rather than eight positional floats keeps the
    table below readable and makes a typo a ``KeyError`` instead of a silently
    shifted weight.
    """
    vector = {Category(name): weight for name, weight in weights.items()}
    missing = set(_CATS) - set(vector)
    if missing:
        raise ValueError(f"emphasis vector is missing {sorted(c.value for c in missing)}")
    total = sum(vector.values())
    assert abs(total - 1.0) < 1e-9, f"emphasis must sum to 1, got {total}: {weights}"
    return {c: vector[c] for c in _CATS}


def _focus(category: Category) -> dict[Category, float]:
    """A specialist vector: ``FOCUS_WEIGHT`` on one category, the rest shared equally."""
    rest = (1.0 - FOCUS_WEIGHT) / (len(_CATS) - 1)
    return {c: (FOCUS_WEIGHT if c == category else rest) for c in _CATS}


_EIGHTH = 1 / 8
UNIFORM = _emphasis(
    picture=_EIGHTH,
    director=_EIGHTH,
    actor=_EIGHTH,
    actress=_EIGHTH,
    supporting_actor=_EIGHTH,
    supporting_actress=_EIGHTH,
    horror=_EIGHTH,
    comedy=_EIGHTH,
)
# Critics' groups: film and director first, performances a little behind.
CRITICS = _emphasis(
    picture=0.22,
    director=0.18,
    actor=0.13,
    actress=0.13,
    supporting_actor=0.09,
    supporting_actress=0.09,
    horror=0.08,
    comedy=0.08,
)
# Auteur-minded bodies lean into directing.
AUTEUR = _emphasis(
    picture=0.18,
    director=0.32,
    actor=0.10,
    actress=0.10,
    supporting_actor=0.08,
    supporting_actress=0.08,
    horror=0.07,
    comedy=0.07,
)
# Festival tributes and the Globes honour the lead performances.
LEAD_ACTING = _emphasis(
    picture=0.12,
    director=0.08,
    actor=0.22,
    actress=0.22,
    supporting_actor=0.11,
    supporting_actress=0.11,
    horror=0.07,
    comedy=0.07,
)
# Ensemble prizes spread across all four acting slots.
ENSEMBLE = _emphasis(
    picture=0.08,
    director=0.08,
    actor=0.17,
    actress=0.17,
    supporting_actor=0.17,
    supporting_actress=0.17,
    horror=0.08,
    comedy=0.08,
)
# Breakthrough / supporting spotlights.
SUPPORTING = _emphasis(
    picture=0.08,
    director=0.08,
    actor=0.12,
    actress=0.12,
    supporting_actor=0.22,
    supporting_actress=0.22,
    horror=0.08,
    comedy=0.08,
)
# Film-of-the-year lists care mostly about the picture.
PICTURE = _emphasis(
    picture=0.38,
    director=0.14,
    actor=0.09,
    actress=0.09,
    supporting_actor=0.07,
    supporting_actress=0.07,
    horror=0.08,
    comedy=0.08,
)
# Genre bodies weight the two categories the Academy never created.
GENRE = _emphasis(
    picture=0.10,
    director=0.10,
    actor=0.08,
    actress=0.08,
    supporting_actor=0.06,
    supporting_actress=0.06,
    horror=0.28,
    comedy=0.24,
)
HORROR_LEAN = _emphasis(
    picture=0.10,
    director=0.10,
    actor=0.07,
    actress=0.07,
    supporting_actor=0.07,
    supporting_actress=0.07,
    horror=0.40,
    comedy=0.12,
)
COMEDY_LEAN = _emphasis(
    picture=0.10,
    director=0.10,
    actor=0.07,
    actress=0.07,
    supporting_actor=0.07,
    supporting_actress=0.07,
    horror=0.12,
    comedy=0.40,
)


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
# The circuit, in the order a real awards season runs: the regional critics'
# circles first, then the festivals and the televised shows, then the guilds,
# then BAFTA and the Academy.
#
# Each genre slot is represented twice, and by two *different* bodies, which
# is a rule rather than an accident. Horror leans at Sitges (stop 6) and is
# decided at the Fangoria Chainsaw Awards (stop 28); comedy leans at the
# Golden Globes' Musical/Comedy half (stop 20) and is decided at Critics
# Choice (stop 27). Sitges replaced a second Fangoria entry that differed from
# the first only by a parenthesis, which read as a duplicate rather than as a
# body appearing twice. The Screen Actors Guild does appear five times, but
# its five are five visibly distinct awards.
_CIRCUIT: list[tuple[str, dict[Category, float]]] = [
    ("National Board of Review", CRITICS),
    ("New York Film Critics Circle", CRITICS),
    ("Los Angeles Film Critics Association", AUTEUR),
    ("Boston Society of Film Critics", CRITICS),
    ("Chicago Film Critics Association", UNIFORM),
    ("Sitges Film Festival", HORROR_LEAN),
    ("San Francisco Film Critics Circle", CRITICS),
    ("Washington DC Area Film Critics", UNIFORM),
    ("Toronto Film Critics Association", AUTEUR),
    ("Palm Springs Film Festival Tributes", LEAD_ACTING),
    ("Gotham Awards", PICTURE),
    ("Satellite Awards", UNIFORM),
    ("Saturn Awards", GENRE),
    ("Online Film Critics Society", CRITICS),
    ("Santa Barbara Film Festival Tributes", SUPPORTING),
    ("London Film Critics' Circle", CRITICS),
    ("National Society of Film Critics", AUTEUR),
    ("AFI Awards", PICTURE),
    ("Screen Actors Guild (Ensemble)", ENSEMBLE),
    ("Golden Globes (Musical/Comedy)", COMEDY_LEAN),
    # --- the specialists: one per category (deficiency rule). Weakest winner
    # distribution first so each faces the gentlest threshold it can.
    # Ordered weakest-category-first, measured from the 5th percentile of the
    # best winner score in each category's pools: supporting actress bottoms
    # out at 70.5 while the genre crowns start at 86.0. Pairing the weakest
    # slot with the gentlest threshold is what lets a flawless ballot sweep
    # even on a thin year draw. Re-derive this order whenever the pool changes
    # - dropping the pre-1950 years moved Best Director from third-weakest to
    # fifth, and leaving the old order cost a perfect ballot 1.3% of its
    # sweeps.
    ("Screen Actors Guild (Supporting Actress)", _focus(Category.SUPPORTING_ACTRESS)),
    ("Screen Actors Guild (Lead Actress)", _focus(Category.ACTRESS)),
    ("Screen Actors Guild (Supporting Actor)", _focus(Category.SUPPORTING_ACTOR)),
    ("Screen Actors Guild (Lead Actor)", _focus(Category.ACTOR)),
    ("Producers Guild of America", _focus(Category.PICTURE)),
    ("Directors Guild of America", _focus(Category.DIRECTOR)),
    ("Critics Choice (Best Comedy)", _focus(Category.COMEDY)),
    ("Fangoria Chainsaw Award (Best Film)", _focus(Category.HORROR)),
    # --- the home stretch ---
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
