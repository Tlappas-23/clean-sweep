"""
Persistence layer (``app.core.db``): SQLAlchemy 2.0 engine, session and tables.

Architecture note
-----------------
Games are small, mutate a handful of times and are read back as a whole, so
the schema is deliberately document-shaped: the ``games`` table stores the
full ``GameState`` as JSON and the ``leaderboard`` table stores the flat
numbers a ranking needs. The engine never touches this module. The API layer
loads a game row, hands the parsed state to the engine, and writes the
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
from datetime import UTC, datetime, timedelta

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    delete,
    select,
)
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


class SideGameRow(Base):
    """
    One Recast or Six Degrees game.

    The two side modes share a table because they store the same thing - a
    seeded board plus whatever the player has done to it - and differ only in
    the shape of ``state_json``. ``kind`` discriminates. Keeping them together
    means one place to look for "what games exist" and one migration story.
    """

    __tablename__ = "side_games"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    seed: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    # The Chain leaderboard reads "the most recent rounds of this kind", which
    # without this is a full scan plus a sort of every side game ever played.
    # Composite and in that column order, because an index is only used from
    # its leading column: filtering on `kind` then ordering by `created_at` is
    # exactly what this serves.
    __table_args__ = (Index("ix_side_games_kind_created", "kind", "created_at"),)


#: Rows older than this are swept at startup. Every visitor here is anonymous
#: and creates a row by pressing Play, so without a sweep the table grows for
#: as long as the site is up, and the free Postgres tier is half a gigabyte.
#:
#: Two weeks is chosen against what a row is *for*: a game is a link somebody
#: might reopen, and a daily board stops being interesting once its day has
#: passed. Nothing on a leaderboard is ever swept, because that is the one
#: thing here meant to last.
RETENTION_DAYS = 14


class Database:
    """
    Engine + session factory bundle, created once in the app lifespan.

    Wrapping both in one object (instead of module globals) lets the test
    suite spin up an isolated temp-file SQLite database per session.
    """

    def __init__(self, url: str) -> None:
        url = normalise_url(url)
        connect_args: dict = {}
        options: dict = {}

        if url.startswith("sqlite"):
            # FastAPI may service a request on a different thread from the one
            # that opened the connection; SQLite needs to be told that is fine.
            connect_args["check_same_thread"] = False
        else:
            # Postgres, and in practice a serverless one (Neon). Three
            # settings, each answering something that host actually does:
            #
            #   pool_pre_ping  it drops idle connections, and a pooled handle
            #                  to a closed connection fails the *next* request
            #                  rather than the one that idled. One cheap round
            #                  trip turns that into a transparent reconnect.
            #   pool_recycle   belt and braces: retire a connection before the
            #                  far end decides to.
            #   pool_size      the free tier caps total connections, and this
            #                  is one small instance. A large pool would not
            #                  make it faster, only likelier to be refused.
            options.update(
                pool_pre_ping=True,
                pool_recycle=280,
                pool_size=5,
                max_overflow=5,
                # Do not let a stuck connection hold a request open forever.
                connect_args={"connect_timeout": 10},
            )
            connect_args = options.pop("connect_args")

        self.url = url
        self.engine = create_engine(url, connect_args=connect_args, future=True, **options)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)

    @property
    def dialect(self) -> str:
        """ "sqlite" or "postgresql", for logging and the health probe."""
        return self.engine.dialect.name

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

    def sweep(self, days: int = RETENTION_DAYS) -> dict[str, int]:
        """
        Delete abandoned games older than ``days``. Returns what it removed.

        Run at startup rather than on a timer: this deployment restarts often
        (a free instance sleeps when idle and wakes on the next request), so
        startup is both frequent enough to keep the table small and the one
        moment when doing a little extra work costs a waking user nothing.

        Games with a leaderboard entry are kept. Deleting one would break the
        foreign key, and more to the point a submitted score is the only thing
        here anyone expects to persist.
        """
        cutoff = utcnow() - timedelta(days=days)
        removed: dict[str, int] = {}
        with self.session() as session:
            submitted = select(LeaderboardRow.game_id)
            removed["games"] = (
                session.execute(
                    delete(GameRow).where(GameRow.created_at < cutoff, GameRow.id.not_in(submitted))
                ).rowcount
                or 0
            )
            removed["side_games"] = (
                session.execute(delete(SideGameRow).where(SideGameRow.created_at < cutoff)).rowcount or 0
            )
        return removed

    def dispose(self) -> None:
        """Release pooled connections (called at shutdown)."""
        self.engine.dispose()


def normalise_url(url: str) -> str:
    """
    Accept the URL shape hosting providers actually hand out.

    Render and Neon both print ``postgres://...``, which SQLAlchemy 2 no
    longer recognises, and neither names a driver. Rewriting here rather than
    asking whoever deploys this to hand-edit an environment variable is the
    difference between "paste the connection string" and a confusing failure
    on first boot.
    """
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url
