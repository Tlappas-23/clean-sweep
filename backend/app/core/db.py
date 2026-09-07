"""
Persistence layer (``app.core.db``): SQLAlchemy 2.0 engine, session and tables.

Architecture note
-----------------
Games are small, mutate a handful of times and are read back as a whole, so
the schema is deliberately document-shaped: the ``games`` table stores the
full ``GameState`` as JSON and the ``leaderboard`` table stores the flat
numbers a ranking needs. The engine never touches this module — the API
layer loads a game row, hands the parsed state to the engine, and writes the
returned state back.

Two tables:

    games        one row per game; ``state_json`` is the authoritative state,
                 ``results_json`` caches the (deterministic) season results
                 once the ballot is complete.
    leaderboard  one row per submitted game (``game_id`` is unique, which is
                 how "already submitted" is enforced).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    """Timezone-aware UTC ``now``; every timestamp we store or emit uses this."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Declarative base shared by both tables."""


class GameRow(Base):
    """A game and its JSON-serialised state (see ``app.models.game.StoredGame``)."""

    __tablename__ = "games"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    seed: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    # Filled the first time results are requested; null while the game is in play.
    results_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class LeaderboardRow(Base):
    """One submitted, completed game. ``game_id`` is unique: one submission per game."""

    __tablename__ = "leaderboard"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), nullable=False, unique=True)
    player_name: Mapped[str] = mapped_column(String(40), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    seed: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    wins: Mapped[int] = mapped_column(Integer, nullable=False)
    ballot_strength: Mapped[float] = mapped_column(Float, nullable=False)
    clean_sweep: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Database:
    """
    Engine + session factory bundle, created once in the app lifespan.

    Wrapping both in one object (instead of module globals) lets the test
    suite spin up an isolated temp-file SQLite database per session.
    """

    def __init__(self, url: str) -> None:
        connect_args = {}
        if url.startswith("sqlite"):
            # FastAPI may service a request on a different thread from the one
            # that opened the connection; SQLite needs to be told that is fine.
            connect_args["check_same_thread"] = False
        self.engine = create_engine(url, connect_args=connect_args, future=True)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)

    def create_tables(self) -> None:
        """Idempotent ``CREATE TABLE IF NOT EXISTS`` for both tables."""
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """Unit-of-work context manager: commit on success, roll back on error."""
        session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def dispose(self) -> None:
        """Release pooled connections (called at shutdown)."""
        self.engine.dispose()
