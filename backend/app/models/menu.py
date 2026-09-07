"""
The game-mode menu (``app.models.menu``).

One card per mode for the front page. ``available`` exists because the two
side modes depend on seed tables the core pipeline does not build, so a
checkout that has only run ``build_seed`` should see them listed and disabled
rather than have them fail when clicked.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ModeCard(BaseModel):
    """One entry in the game-mode menu."""

    id: str
    label: str
    tagline: str
    description: str
    available: bool = Field(description="False when the mode's tables have not been built")
    path: str = Field(description="Client route that starts the mode")
