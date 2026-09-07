"""
The Catalog (``app.data.catalog``): seed parquet -> indexed in-memory contender pools.

Architecture note
-----------------
Sits between the seed data and everything else. At startup ``Catalog.load``
reads ``contenders.parquet``, joins each row to its film (title, genres,
IMDb numbers, enrichment columns) and, when the ML step has run, to
``ml_scores.parquet`` (prestige + archetype). The result is one
``ContenderRecord`` per contender (~68k objects, well under 100 MB) held in
two dict indexes:

    by_id    contender_id -> record            (pick validation, results)
    pools    (year, category) -> [record...]   (candidate lists, calibration)

``ContenderRecord`` holds the *whole truth* including ``nominated`` / ``won``.
Those two fields must never reach the client before the ballot is complete,
so every outbound conversion goes through ``public_contender`` which knows
the masking rules for each game mode and has no way to emit the outcome.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from app.models.contender import (
    AcademyOutcome,
    BrowseContender,
    CareerContext,
    Contender,
    ContenderMetrics,
    ContenderStats,
)
from app.models.enums import CandidateSort, Category, Mode

log = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class ContenderRecord:
    """
    Everything the catalog knows about one contender (internal, immutable).

    ``frozen`` + ``slots`` keeps 68k of these cheap and prevents a request
    handler from accidentally mutating shared state. Per-film fields are
    denormalised onto the record so a pool listing needs no second lookup.
    """

    contender_id: str
    category: Category
    year: int
    film_id: str
    film_title: str
    person_id: str | None
    person_name: str | None
    character: str | None
    genres: tuple[str, ...]
    runtime_minutes: int | None
    billing: int | None
    # Raw film stats (shown on the card in classic mode).
    imdb_rating: float | None
    imdb_votes: int | None
    box_office_usd: float | None
    rt_critic: int | None
    rt_audience: int | None
    metascore: int | None
    budget_usd: float | None
    poster_path: str | None
    # Percentile metrics, 0-100 within the (year, category) pool.
    acclaim: float | None
    popularity: float | None
    box_office: float | None
    prestige: float | None  # from ml_scores.parquet; None until the ranker has run
    archetype: str | None  # from ml_scores.parquet; None until clustering has run
    cluster_id: int | None
    # Ground truth. Hidden from the client until results.
    nominated: bool
    won: bool
    prior_nominations: int
    prior_wins: int

    @property
    def search_text(self) -> str:
        """Lower-cased haystack for the candidates ``?q=`` filter."""
        parts = (self.film_title, self.person_name, self.character)
        return " | ".join(part for part in parts if part).lower()


# TMDB serves posters from a shared CDN; the seed stores only the path
# fragment, so the size is chosen here. w342 is the smallest size that still
# looks sharp on a retina card and keeps a 40-card grid light.
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342"


def poster_url(poster_path: str | None) -> str | None:
    """Absolute poster URL for a TMDB path fragment, or None when unknown."""
    return f"{TMDB_IMAGE_BASE}{poster_path}" if poster_path else None


# --- outbound conversion (masking) ------------------------------------------


def public_contender(record: ContenderRecord, mode: Mode, reveal: bool = False) -> Contender:
    """
    Convert an internal record to the wire ``Contender`` under the mode's masking rules.

    * classic:   metrics, stats and archetype visible.
    * cinephile: metrics, stats and archetype all null (title / year / person only).
    * reveal:    the results page; everything visible regardless of mode.

    Nothing here reads ``nominated`` / ``won`` and the ``Contender`` model has
    no field to put them in, which is the structural guarantee that the
    Academy outcome cannot leak during play.
    """
    show = reveal or mode == Mode.CLASSIC
    if show:
        metrics = ContenderMetrics(
            acclaim=record.acclaim,
            popularity=record.popularity,
            box_office=record.box_office,
            prestige=record.prestige,
        )
        stats = ContenderStats(
            imdb_rating=record.imdb_rating,
            imdb_votes=record.imdb_votes,
            box_office_usd=record.box_office_usd,
            budget_usd=record.budget_usd,
            rt_critic=record.rt_critic,
            rt_audience=record.rt_audience,
            metascore=record.metascore,
        )
        career = CareerContext(
            prior_nominations=record.prior_nominations,
            prior_wins=record.prior_wins,
            billing=record.billing,
        )
    else:
        metrics = ContenderMetrics()  # all null
        stats = ContenderStats()
        career = CareerContext()
    return Contender(
        contender_id=record.contender_id,
        category=record.category,
        year=record.year,
        film_id=record.film_id,
        film_title=record.film_title,
        person_id=record.person_id,
        person_name=record.person_name,
        character=record.character,
        genres=list(record.genres),
        runtime_minutes=record.runtime_minutes,
        archetype=record.archetype if show else None,
        # The poster is identity, not a metric: it is what makes the grid
        # readable at a glance, so it survives cinephile masking. Recognising
        # a film by its poster is exactly the knowledge that mode tests.
        poster_url=poster_url(record.poster_path),
        metrics=metrics,
        stats=stats,
        career=career,
    )


def browse_contender(record: ContenderRecord) -> BrowseContender:
    """Unmasked ``Contender`` + Academy outcome, for the catalog-browse endpoint only."""
    base = public_contender(record, Mode.CLASSIC, reveal=True)
    return BrowseContender(
        **base.model_dump(), academy=AcademyOutcome(nominated=record.nominated, won=record.won)
    )


# --- pool search -------------------------------------------------------------


def search_pool(
    records: list[ContenderRecord], query: str | None, sort: CandidateSort
) -> list[ContenderRecord]:
    """
    Filter a pool by a case-insensitive substring and order it.

    Metric sorts are descending with unknown (null) values last, so a pool
    missing box-office data still lists sensibly. Text sorts are ascending.
    """
    if query:
        needle = query.strip().lower()
        records = [r for r in records if needle in r.search_text]
    if sort == CandidateSort.TITLE:
        return sorted(records, key=lambda r: (r.film_title.lower(), r.person_name or ""))
    if sort == CandidateSort.PERSON:
        # Best Picture has no person; fall back to the title so the key stays comparable.
        return sorted(records, key=lambda r: ((r.person_name or r.film_title).lower(), r.film_title.lower()))

    def metric_key(r: ContenderRecord) -> tuple[int, float, str]:
        value = getattr(r, sort.value)
        # (0, -value) puts known values first in descending order; (1, 0) puts nulls last.
        return (0, -value, r.film_title) if value is not None else (1, 0.0, r.film_title)

    return sorted(records, key=metric_key)


# --- loading -----------------------------------------------------------------


def _clean(value: Any) -> Any:
    """Turn pandas/numpy missing markers into ``None`` and numpy scalars into Python ones."""
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        # Arrays / lists are not scalars; leave them alone.
        pass
    if hasattr(value, "item"):  # numpy scalar -> Python scalar
        return value.item()
    return value


def _opt_int(value: Any) -> int | None:
    value = _clean(value)
    return None if value is None else int(value)


def _opt_float(value: Any) -> float | None:
    value = _clean(value)
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) else value


def _opt_str(value: Any) -> str | None:
    value = _clean(value)
    return None if value is None else str(value)


class Catalog:
    """
    Read-only index of every contender, built once from the seed tables.

    Construct with ``Catalog.load(seed_dir)``; the constructor itself takes
    prebuilt records so tests can assemble a tiny catalog without parquet.
    """

    def __init__(self, records: list[ContenderRecord]) -> None:
        self.by_id: dict[str, ContenderRecord] = {}
        self.pools: dict[tuple[int, Category], list[ContenderRecord]] = {}
        self._winners: dict[tuple[int, Category], list[ContenderRecord]] = {}
        for record in records:
            self.by_id[record.contender_id] = record
            key = (record.year, record.category)
            self.pools.setdefault(key, []).append(record)
            if record.won:
                self._winners.setdefault(key, []).append(record)
        years = [year for year, _ in self.pools]
        self.min_year: int = min(years) if years else 0
        self.max_year: int = max(years) if years else 0
        # True once ml_scores.parquet was joined; drives the meta endpoint's hints.
        self.has_ml_scores: bool = any(r.prestige is not None for r in records)

    # -- lookups ---------------------------------------------------------

    def get(self, contender_id: str) -> ContenderRecord | None:
        return self.by_id.get(contender_id)

    def pool(self, year: int, category: Category) -> list[ContenderRecord]:
        """Every contender of ``category`` in ``year`` (empty list if none)."""
        return self.pools.get((year, Category(category)), [])

    def winners(self, year: int, category: Category) -> list[ContenderRecord]:
        """The actual Oscar winner(s). Usually one; ties and pre-1936 supporting categories differ."""
        return self._winners.get((year, Category(category)), [])

    def year_pool(self, year: int) -> list[ContenderRecord]:
        """All categories for one year, in category order (catalog browse)."""
        out: list[ContenderRecord] = []
        for category in Category:
            out.extend(self.pool(year, category))
        return out

    def to_public(self, record: ContenderRecord, mode: Mode, reveal: bool = False) -> Contender:
        """Masked wire representation; see ``public_contender``."""
        return public_contender(record, mode, reveal)

    def __len__(self) -> int:
        return len(self.by_id)

    # -- loading ---------------------------------------------------------

    @classmethod
    def load(cls, seed_dir: Path) -> Catalog:
        """
        Build the catalog from ``seed_dir``.

        ``ml_scores.parquet`` is optional (the ML step may not have run yet);
        without it ``prestige`` / ``archetype`` are simply null and the
        scoring weights renormalise over the remaining metrics.
        """
        started = time.perf_counter()
        films = pd.read_parquet(seed_dir / "films.parquet")
        contenders = pd.read_parquet(seed_dir / "contenders.parquet")

        ml_path = seed_dir / "ml_scores.parquet"
        ml: dict[str, tuple[float | None, str | None, int | None]] = {}
        if ml_path.exists():
            scores = pd.read_parquet(ml_path)
            for row in scores.itertuples(index=False):
                ml[str(row.contender_id)] = (
                    _opt_float(getattr(row, "prestige", None)),
                    _opt_str(getattr(row, "archetype", None)),
                    _opt_int(getattr(row, "cluster_id", None)),
                )
            log.info("catalog: joined %d ml scores from %s", len(ml), ml_path.name)
        else:
            log.info("catalog: %s not found, prestige/archetype will be null", ml_path.name)

        # Film-level fields keyed by tconst. Genres become a shared tuple per
        # film so the 68k contender records point at ~4.5k tuples, not copies.
        film_rows: dict[str, dict[str, Any]] = {}
        for row in films.itertuples(index=False):
            genres = row.genres
            film_rows[str(row.film_id)] = {
                "title": str(row.title),
                "genres": tuple(str(g) for g in (list(genres) if genres is not None else [])),
                "runtime_minutes": _opt_int(row.runtime_minutes),
                "imdb_rating": _opt_float(row.imdb_rating),
                "imdb_votes": _opt_int(row.imdb_votes),
                "box_office_usd": _opt_float(row.box_office_usd),
                "rt_critic": _opt_int(row.rt_critic),
                "rt_audience": _opt_int(row.rt_audience),
                "metascore": _opt_int(row.metascore),
                "budget_usd": _opt_float(row.budget_usd),
                "poster_path": _opt_str(row.poster_path),
            }

        records: list[ContenderRecord] = []
        missing_films = 0
        for row in contenders.itertuples(index=False):
            film = film_rows.get(str(row.film_id))
            if film is None:
                # Should not happen with a consistent seed; skip rather than crash the app.
                missing_films += 1
                continue
            cid = str(row.contender_id)
            prestige, archetype, cluster_id = ml.get(cid, (None, None, None))
            records.append(
                ContenderRecord(
                    contender_id=cid,
                    category=Category(str(row.category)),
                    year=int(row.year),
                    film_id=str(row.film_id),
                    film_title=film["title"],
                    person_id=_opt_str(row.person_id),
                    person_name=_opt_str(row.person_name),
                    character=_opt_str(row.character),
                    genres=film["genres"],
                    runtime_minutes=film["runtime_minutes"],
                    billing=_opt_int(row.billing),
                    imdb_rating=film["imdb_rating"],
                    imdb_votes=film["imdb_votes"],
                    box_office_usd=film["box_office_usd"],
                    rt_critic=film["rt_critic"],
                    rt_audience=film["rt_audience"],
                    metascore=film["metascore"],
                    budget_usd=film["budget_usd"],
                    poster_path=film["poster_path"],
                    acclaim=_opt_float(row.acclaim),
                    popularity=_opt_float(row.popularity),
                    box_office=_opt_float(row.box_office),
                    prestige=prestige,
                    archetype=archetype,
                    cluster_id=cluster_id,
                    nominated=bool(row.nominated),
                    won=bool(row.won),
                    prior_nominations=int(row.prior_nominations),
                    prior_wins=int(row.prior_wins),
                )
            )
        if missing_films:
            log.warning(
                "catalog: skipped %d contenders whose film is missing from films.parquet",
                missing_films,
            )

        catalog = cls(records)
        log.info(
            "catalog: %d contenders, %d pools, years %d-%d, loaded in %.2fs",
            len(catalog),
            len(catalog.pools),
            catalog.min_year,
            catalog.max_year,
            time.perf_counter() - started,
        )
        return catalog
