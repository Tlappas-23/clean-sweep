"""
Leaderboard schema (``app.models.leaderboard``).

A flat, sortable summary of a submitted game. ``seed`` is what groups the
daily challenge: every entry with the same seed played the same spins.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.models.enums import Mode


class LeaderboardEntry(BaseModel):
    id: str
    player_name: str
    mode: Mode
    seed: str | None
    wins: int
    ballot_strength: float
    clean_sweep: bool
    created_at: str
