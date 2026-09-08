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
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from app.data import seedfile
from app.models.contender import (
    AcademyOutcome,
    BrowseContender,
    CareerContext,
    Contender,
    ContenderMetrics,
    ContenderStats,
)
from app.models.enums import CandidateSort, Category, Mode
from app.models.people import FilmCard

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
    # Estimated revenue for films no provider could supply, and the flag that
    # says so. Shown to the player, never scored (see pipeline.boxoffice).
    box_office_est_usd: float | None
    # Percentile metrics, 0-100 within the (year, category) pool.
    audience: float | None
    critics: float | None
    award_standing: float | None
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
    def poster_url(self) -> str | None:
        """Absolute poster URL, or None. Used by the side modes' film cards."""
        return poster_url(self.poster_path)

    @property
    def search_text(self) -> str:
        """Lower-cased haystack for the candidates ``?q=`` filter."""
        parts = (self.film_title, self.person_name, self.character)
        return " | ".join(part for part in parts if part).lower()


# TMDB serves posters from a shared CDN; the seed stores only the path
# fragment, so the size is chosen here. w342 is the smallest size that still
# looks sharp on a retina card and keeps a 40-card grid light.
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342"

# How many of the best-known films the Recast mode draws from.
RECASTABLE_FILMS = 400

# Categories whose records carry a cast credit.
_ACTING = frozenset(
    {Category.ACTOR, Category.ACTRESS, Category.SUPPORTING_ACTOR, Category.SUPPORTING_ACTRESS}
)


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
            audience=record.audience,
            critics=record.critics,
            popularity=record.popularity,
            box_office=record.box_office,
            prestige=record.prestige,
        )
        stats = ContenderStats(
            imdb_rating=record.imdb_rating,
            imdb_votes=record.imdb_votes,
            box_office_usd=record.box_office_usd,
            box_office_est_usd=record.box_office_est_usd,
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


def film_card(record: ContenderRecord) -> FilmCard:
    """
    The film-level facts, for the side modes.

    Recast and Six Degrees deal in films rather than performances, so they
    get a shape carrying only what a film *is* - no metrics, no masking, no
    Academy outcome to leak.
    """
    return FilmCard(
        film_id=record.film_id,
        title=record.film_title,
        year=record.year,
        poster_url=record.poster_url,
        genres=list(record.genres),
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


# The packed seed already carries Python natives and a real ``null`` for every
# missing cell (``pipeline.pack`` normalises NaN, NaT and pandas NA on the way
# out, since JSON has no literal for any of them). So these three only have to
# widen a null into the right optional type, which is why none of them tests
# for a missing marker any more.


def _opt_int(value: Any) -> int | None:
    return None if value is None else int(value)


def _opt_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _opt_str(value: Any) -> str | None:
    return None if value is None else str(value)


#: How close a typed title has to be before a misspelling is accepted. Tight
#: enough that "The Godfather" never resolves to "The Godfather Part II", which
#: is a different film a player might legitimately have meant.
_TITLE_FUZZ = 0.88


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
        # Film-level and cast indexes for the side modes.
        self._by_film: dict[str, ContenderRecord] = {}
        self._films_by_fame: list[str] | None = None
        self._film_cast: dict[str, list[ContenderRecord]] = {}
        for record in records:
            self._by_film.setdefault(record.film_id, record)
            if record.person_id and record.category in _ACTING:
                self._film_cast.setdefault(record.film_id, []).append(record)

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

    def film(self, film_id: str) -> ContenderRecord | None:
        """
        Any record for a film, for the film-level facts (title, year, poster).

        The side modes deal in films rather than contenders, and every record
        of a film carries the same denormalised film columns, so the first one
        found answers the question.
        """
        return self._by_film.get(film_id)

    def films_by_fame(self) -> list[str]:
        """
        Every film id, most recognisable first, by vote count.

        The people graph knows who worked with whom and nothing about which
        titles anyone has heard of, so The Chain gets its endpoints from here.
        Cached on first use because it is a full sort of the catalogue and the
        answer never changes for a loaded seed.
        """
        if self._films_by_fame is None:
            self._films_by_fame = [
                record.film_id
                for record in sorted(self._by_film.values(), key=lambda r: -(r.imdb_votes or 0))
            ]
        return self._films_by_fame

    def resolve_film(self, typed: str) -> ContenderRecord | None:
        """
        Turn a typed title into the film meant, or ``None``.

        The same forgiveness the actor resolver gives a name, for the same
        reason: a player is typing from memory against a clock, and losing a
        move to a missing apostrophe would be a bad joke rather than a
        difficulty. Exact match first, then a prefix, then a substring, each
        settled by vote count so "the godfather" reaches the original rather
        than a sequel and "batman" reaches the best-known one.

        Unlike an actor's name, an ambiguous title is not refused. Film titles
        repeat across remakes constantly, and the popular one is almost always
        the one meant; refusing would strand a player on a legitimate answer.
        """
        needle = " ".join(typed.strip().casefold().split())
        if not needle:
            return None
        matches = [(record.film_title.casefold(), record) for record in self._by_film.values()]

        def best(candidates: list[ContenderRecord]) -> ContenderRecord | None:
            return max(candidates, key=lambda r: r.imdb_votes or 0, default=None)

        exact = best([r for title, r in matches if title == needle])
        if exact:
            return exact
        prefix = best([r for title, r in matches if title.startswith(needle)])
        if prefix:
            return prefix
        contained = best([r for title, r in matches if needle in title])
        if contained:
            return contained
        # Last, a misspelling. Cheap to allow because the puzzle is which
        # films share a cast, not whether you can spell "Schwarzenegger", and
        # a typo costing a move under a stopwatch would be a bad joke.
        scored = [
            (SequenceMatcher(None, needle, title).ratio(), r)
            for title, r in matches
            if abs(len(title) - len(needle)) <= 4
        ]
        near = [r for ratio, r in scored if ratio >= _TITLE_FUZZ]
        return best(near)

    def search_films(self, query: str, limit: int = 12) -> list[ContenderRecord]:
        """
        Films whose title contains ``query``, best known first.

        The Chain offers this where Six Degrees deliberately does not. There,
        a list of matching actors *is* the answer key, because the cell asks
        for a name. Here the puzzle is which films share a cast, and a list of
        titles matching what you typed says nothing about that, so withholding
        it would only make the player type more.
        """
        needle = " ".join(query.strip().casefold().split())
        if not needle:
            return []
        hits = [r for r in self._by_film.values() if needle in r.film_title.casefold()]
        hits.sort(key=lambda r: (not r.film_title.casefold().startswith(needle), -(r.imdb_votes or 0)))
        return hits[:limit]

    def roles_in_film(self, film_id: str) -> list:
        """
        Credited principals of a film as Recast roles, best-billed first.

        Deduplicated by person: an actor credited in both the lead and
        supporting pools of the same film is one part, not two.
        """
        from app.engine.recast import Role

        seen: dict[str, ContenderRecord] = {}
        for record in self._film_cast.get(film_id, []):
            if record.person_id and record.billing is not None:
                current = seen.get(record.person_id)
                if current is None or record.billing < current.billing:
                    seen[record.person_id] = record
        return sorted(
            (
                Role(
                    person_id=r.person_id,
                    person_name=r.person_name or r.person_id,
                    character=r.character,
                    billing=int(r.billing),
                )
                for r in seen.values()
            ),
            key=lambda r: r.billing,
        )

    def recastable_films(self) -> list[str]:
        """
        Films well known enough to be worth recasting, most-seen first.

        Recasting a film nobody can picture is not a decision, so the list is
        capped at the catalog's most-seen titles.
        """
        ranked = sorted(
            {r.film_id: r for r in self.by_id.values()}.values(),
            key=lambda r: -(r.imdb_votes or 0),
        )
        return [r.film_id for r in ranked[:RECASTABLE_FILMS]]

    def to_public(self, record: ContenderRecord, mode: Mode, reveal: bool = False) -> Contender:
        """Masked wire representation; see ``public_contender``."""
        return public_contender(record, mode, reveal)

    def __len__(self) -> int:
        return len(self.by_id)

    # -- loading ---------------------------------------------------------

    @classmethod
    def load(cls, seed_dir: Path) -> Catalog:
        """
        Build the catalog from the packed seed in ``seed_dir``.

        Streams gzipped JSON Lines through :mod:`app.data.seedfile`, never
        parquet: the conversion happens offline in ``pipeline.pack`` so that
        the serving process never imports pandas. Streaming rather than
        loading is what keeps peak memory at boot near the size of the objects
        being built rather than double it; see that module for the measurement.

        ``ml_scores`` is optional (the ML step may not have run yet); without
        it ``prestige`` / ``archetype`` are simply null and the scoring weights
        renormalise over the remaining metrics.
        """
        started = time.perf_counter()

        ml: dict[str, tuple[float | None, str | None, int | None]] = {}
        if seedfile.exists(seed_dir, "ml_scores"):
            for cid, prestige, archetype, cluster_id in seedfile.rows(
                seed_dir, "ml_scores", "contender_id", "prestige", "archetype", "cluster_id"
            ):
                ml[str(cid)] = (
                    _opt_float(prestige),
                    _opt_str(archetype),
                    _opt_int(cluster_id),
                )
            log.info("catalog: joined %d ml scores", len(ml))
        else:
            log.info("catalog: no ml_scores table, prestige/archetype will be null")

        # Film-level fields keyed by tconst. Genres become a shared tuple per
        # film so the 50k contender records point at ~4.2k tuples, not copies.
        film_rows: dict[str, dict[str, Any]] = {}
        for (
            film_id,
            title,
            genres,
            runtime_minutes,
            imdb_rating,
            imdb_votes,
            box_office_usd,
            rt_critic,
            rt_audience,
            metascore,
            budget_usd,
            poster_path,
            box_office_est_usd,
        ) in seedfile.rows(
            seed_dir,
            "films",
            "film_id",
            "title",
            "genres",
            "runtime_minutes",
            "imdb_rating",
            "imdb_votes",
            "box_office_usd",
            "rt_critic",
            "rt_audience",
            "metascore",
            "budget_usd",
            "poster_path",
            "box_office_est_usd",
        ):
            film_rows[str(film_id)] = {
                "title": str(title),
                "genres": tuple(str(g) for g in (genres or ())),
                "runtime_minutes": _opt_int(runtime_minutes),
                "imdb_rating": _opt_float(imdb_rating),
                "imdb_votes": _opt_int(imdb_votes),
                "box_office_usd": _opt_float(box_office_usd),
                "rt_critic": _opt_int(rt_critic),
                "rt_audience": _opt_int(rt_audience),
                "metascore": _opt_int(metascore),
                "budget_usd": _opt_float(budget_usd),
                "poster_path": _opt_str(poster_path),
                "box_office_est_usd": _opt_float(box_office_est_usd),
            }

        records: list[ContenderRecord] = []
        missing_films = 0
        for (
            cid,
            category,
            year,
            film_id,
            person_id,
            person_name,
            character,
            billing,
            audience,
            critics,
            award_standing,
            popularity,
            box_office,
            nominated,
            won,
            prior_nominations,
            prior_wins,
        ) in seedfile.rows(
            seed_dir,
            "contenders",
            "contender_id",
            "category",
            "year",
            "film_id",
            "person_id",
            "person_name",
            "character",
            "billing",
            "audience",
            "critics",
            "award_standing",
            "popularity",
            "box_office",
            "nominated",
            "won",
            "prior_nominations",
            "prior_wins",
        ):
            film = film_rows.get(str(film_id))
            if film is None:
                # Should not happen with a consistent seed; skip rather than
                # crash the app.
                missing_films += 1
                continue
            cid = str(cid)
            prestige, archetype, cluster_id = ml.get(cid, (None, None, None))
            records.append(
                ContenderRecord(
                    contender_id=cid,
                    category=Category(str(category)),
                    year=int(year),
                    film_id=str(film_id),
                    film_title=film["title"],
                    person_id=_opt_str(person_id),
                    person_name=_opt_str(person_name),
                    character=_opt_str(character),
                    genres=film["genres"],
                    runtime_minutes=film["runtime_minutes"],
                    billing=_opt_int(billing),
                    imdb_rating=film["imdb_rating"],
                    imdb_votes=film["imdb_votes"],
                    box_office_usd=film["box_office_usd"],
                    rt_critic=film["rt_critic"],
                    rt_audience=film["rt_audience"],
                    metascore=film["metascore"],
                    budget_usd=film["budget_usd"],
                    poster_path=film["poster_path"],
                    box_office_est_usd=film["box_office_est_usd"],
                    audience=_opt_float(audience),
                    critics=_opt_float(critics),
                    award_standing=_opt_float(award_standing),
                    popularity=_opt_float(popularity),
                    box_office=_opt_float(box_office),
                    prestige=prestige,
                    archetype=archetype,
                    cluster_id=cluster_id,
                    nominated=bool(nominated),
                    won=bool(won),
                    prior_nominations=int(prior_nominations or 0),
                    prior_wins=int(prior_wins or 0),
                )
            )
        if missing_films:
            log.warning(
                "catalog: skipped %d contenders whose film is missing from the films table",
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
