"""
Enumerations shared by the API, engine and catalog (``app.models.enums``).

All of them are ``StrEnum``s so they serialise to the plain string literals
the contract uses (``"picture"``, ``"classic"``...), compare equal to those
strings and format as them, which keeps dict keys, parquet values and JSON
interchangeable without a conversion step.
"""

from __future__ import annotations

from enum import StrEnum


class Category(StrEnum):
    """The six ballot slots, in the default draft order (docs/GAME_DESIGN.md §1)."""

    PICTURE = "picture"
    DIRECTOR = "director"
    ACTOR = "actor"
    ACTRESS = "actress"
    SUPPORTING_ACTOR = "supporting_actor"
    SUPPORTING_ACTRESS = "supporting_actress"

    @property
    def label(self) -> str:
        """Human-readable name as printed on the ballot."""
        return CATEGORY_LABELS[self]


# Kept next to the enum so the meta endpoint and the tests share one source.
CATEGORY_LABELS: dict[Category, str] = {
    Category.PICTURE: "Best Picture",
    Category.DIRECTOR: "Best Director",
    Category.ACTOR: "Best Actor",
    Category.ACTRESS: "Best Actress",
    Category.SUPPORTING_ACTOR: "Best Supporting Actor",
    Category.SUPPORTING_ACTRESS: "Best Supporting Actress",
}

# The canonical draft order. ``list(Category)`` would give the same thing,
# but naming it makes the intent explicit wherever the order matters.
DEFAULT_CATEGORY_ORDER: tuple[Category, ...] = tuple(Category)


class Mode(StrEnum):
    """Game mode: what a player sees while picking (docs/GAME_DESIGN.md §5)."""

    CLASSIC = "classic"  # metrics + raw stats visible
    CINEPHILE = "cinephile"  # title / year / person / character only


class GameStatus(StrEnum):
    """Where a game is in its round loop: spin -> pick -> spin ... -> complete."""

    SPINNING = "spinning"
    PICKING = "picking"
    COMPLETE = "complete"


class SkipKind(StrEnum):
    """The two skips a player gets per game (docs/GAME_DESIGN.md §2)."""

    YEAR = "year"
    CATEGORY = "category"


class CandidateSort(StrEnum):
    """Accepted values of ``?sort=`` on the candidates endpoint."""

    ACCLAIM = "acclaim"
    POPULARITY = "popularity"
    BOX_OFFICE = "box_office"
    PRESTIGE = "prestige"
    TITLE = "title"
    PERSON = "person"

    @property
    def is_metric(self) -> bool:
        """Metric sorts reveal ranking information, so cinephile mode refuses them."""
        return self in (self.ACCLAIM, self.POPULARITY, self.BOX_OFFICE, self.PRESTIGE)
