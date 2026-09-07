"""
Application settings (``app.core.config``).

Architecture note
-----------------
One ``Settings`` object, built once per process, tells the API layer where
the seed parquet tables and model artifacts live, which SQLite file to use
and which browser origins may call the API. Values come from (in priority
order) real environment variables, the repo-root ``.env`` file, then the
defaults below. Every variable is prefixed ``CLEAN_SWEEP_`` so the backend
never collides with the pipeline's ``TMDB_API_KEY`` / ``OMDB_API_KEY``.

The defaults are *absolute* paths derived from this file's location, so
``uvicorn app.main:app`` works from ``backend/`` and ``pytest`` works from
anywhere without extra configuration.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# backend/app/core/config.py -> core -> app -> backend -> <repo>
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Runtime configuration, read from ``CLEAN_SWEEP_*`` env vars / ``.env``."""

    model_config = SettingsConfigDict(
        env_prefix="CLEAN_SWEEP_",
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",  # the .env also holds pipeline keys we do not care about
    )

    # Where the committed parquet seed tables live (films, contenders, ml_scores...).
    seed_dir: Path = REPO_ROOT / "data" / "seed"
    # Where the ML step writes cluster_summary.json / ranker_metrics.json.
    models_dir: Path = REPO_ROOT / "data" / "models"
    # SQLAlchemy URL. SQLite keeps the project zero-infrastructure; the
    # persistence layer only uses portable Core features so Postgres works too.
    db_url: str = f"sqlite:///{REPO_ROOT / 'clean_sweep.db'}"
    # Browser origins allowed by CORS. ``NoDecode`` stops pydantic-settings
    # from JSON-decoding the env var so a plain comma-separated string works:
    #   CLEAN_SWEEP_CORS_ORIGINS=http://localhost:5173,https://example.com
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept either a list or a comma-separated string."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    """
    Return the process-wide ``Settings``.

    Cached so every router sees the same object; tests call
    ``get_settings.cache_clear()`` after pointing the env at a temp database.
    """
    return Settings()
