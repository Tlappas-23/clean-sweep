"""
``app.models`` — Pydantic schemas mirroring ``docs/API.md``.

Architecture note
-----------------
These classes are the Python side of the "one contract" principle: field
names and shapes match the TypeScript interfaces in ``docs/API.md`` exactly,
so the frontend's generated types line up with the JSON FastAPI emits. The
engine also works on these objects (``GameState`` in, ``GameState`` out),
which keeps it free of any framework-specific types.

Only additions beyond the contract live here and are marked as such:
``StoredGame`` (engine bookkeeping persisted alongside the public state) and
``BrowseContender`` (the unmasked catalog-browse row).
"""

from app.models.analytics import ClusterSummary, RankerSummary, ValidationReport
from app.models.contender import (
    AcademyOutcome,
    BrowseContender,
    Contender,
    ContenderMetrics,
    ContenderStats,
)
from app.models.enums import CandidateSort, Category, GameStatus, Mode, SkipKind
from app.models.game import (
    CreateGameRequest,
    GameState,
    Pick,
    PickRequest,
    SkipRequest,
    SkipsRemaining,
    Spin,
    StoredGame,
    SubmitRequest,
)
from app.models.leaderboard import LeaderboardEntry
from app.models.meta import Meta
from app.models.results import CeremonyResult, GameResults, PickResult

__all__ = [
    "AcademyOutcome",
    "BrowseContender",
    "CandidateSort",
    "Category",
    "CeremonyResult",
    "ClusterSummary",
    "Contender",
    "ContenderMetrics",
    "ContenderStats",
    "CreateGameRequest",
    "GameResults",
    "GameState",
    "GameStatus",
    "LeaderboardEntry",
    "Meta",
    "Mode",
    "Pick",
    "PickRequest",
    "PickResult",
    "RankerSummary",
    "SkipKind",
    "SkipRequest",
    "SkipsRemaining",
    "Spin",
    "StoredGame",
    "SubmitRequest",
    "ValidationReport",
]
