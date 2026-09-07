"""
Leaderboard route (``app.api.leaderboard``).

Reads the rows written by ``POST /api/games/{id}/submit``. Ranking is by
season record first and ballot strength second, which matches how the game
is scored: 30-0 beats 29-1 however strong the losing ballot was, and strength
only settles ties.

Filtering by ``seed`` is what makes the daily challenge a competition — every
entry sharing a seed played the same six spins.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DatabaseDep
from app.core.db import LeaderboardRow
from app.models.enums import Mode
from app.models.leaderboard import LeaderboardEntry

router = APIRouter(prefix="/api", tags=["leaderboard"])


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(
    database: DatabaseDep,
    seed: str | None = Query(default=None, description="Restrict to one daily seed"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[LeaderboardEntry]:
    """Top entries, best record first. Omit ``seed`` for the all-time table."""
    statement = select(LeaderboardRow)
    if seed is not None:
        statement = statement.where(LeaderboardRow.seed == seed)
    statement = statement.order_by(
        LeaderboardRow.wins.desc(),
        LeaderboardRow.ballot_strength.desc(),
        LeaderboardRow.created_at.asc(),  # earliest identical score ranks first
    ).limit(limit)

    with database.session() as session:
        rows = session.scalars(statement).all()

    return [
        LeaderboardEntry(
            id=row.id,
            player_name=row.player_name,
            mode=Mode(row.mode),
            seed=row.seed,
            wins=row.wins,
            ballot_strength=row.ballot_strength,
            clean_sweep=row.clean_sweep,
            created_at=row.created_at.isoformat(),
        )
        for row in rows
    ]
