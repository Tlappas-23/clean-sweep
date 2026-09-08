"""
``app.models`` holds the Pydantic schemas mirroring ``docs/API.md``.

    enums.py      categories, modes, statuses shared by every layer
    contender.py  the Oscars mode's contender and its masking-safe shape
    game.py       Oscars game state and request bodies
    results.py    the Oscars reveal
    meta.py       GET /api/meta
    menu.py       the game-mode menu card
    people.py     actor and film cards, shared by the two side modes
    grid.py       Six Degrees state and results
    recast.py     Recast state and results
    analytics.py  the ML artifacts as they are served
    leaderboard.py

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
from app.models.grid import GridResults, GridState
from app.models.leaderboard import LeaderboardEntry
from app.models.menu import ModeCard
from app.models.meta import Meta
from app.models.people import ActorCard, FilmCard
from app.models.recast import RecastResults, RecastState
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
    "ActorCard",
    "FilmCard",
    "GridResults",
    "GridState",
    "ModeCard",
    "RecastResults",
    "RecastState",
]
