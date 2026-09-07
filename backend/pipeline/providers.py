"""
Provider clients and the response cache (``pipeline.providers``).

Architecture note
-----------------
Everything that talks to TMDB or OMDb lives here, and nothing else does. The
split matters because the two halves fail differently: this module is about
one film and one HTTP call, while ``pipeline.enrich`` is about a whole run -
what to fetch, in what order, and how much budget is left.

Keeping them apart is what let the quota bug be found and fixed in one place:
OMDb answers an exhausted allowance with HTTP 401 *and* a JSON body saying so,
so the body has to be read before the status is raised, or a perfectly good
film gets a blank cached against it.

The cache is the other half of the job. Entries carry a status and a
timestamp so a transient failure and a confirmed absence are never confused,
which is what stops one bad afternoon permanently blanking a film.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from pipeline.paths import CACHE_DIR

TMDB_BASE = "https://api.themoviedb.org/3"
OMDB_BASE = "https://www.omdbapi.com/"


# --- cache freshness policy --------------------------------------------------
#
# How long each kind of cached answer is trusted before it is fetched again.
# These are the knobs that trade accuracy against quota.
TTL_OK = timedelta(days=180)  # a settled answer: re-check twice a year
TTL_ABSENT = timedelta(days=90)  # provider had nothing; it may acquire it later
TTL_ERROR = timedelta(days=1)  # a network/5xx blip: retry tomorrow

# Films this recent are still earning at the box office and still collecting
# reviews, so their figures are refreshed far more often than the back
# catalogue's. A 1974 film's revenue is not going to change.
RECENT_YEARS = 3
TTL_RECENT = timedelta(days=7)

# Statuses stored on every cache entry.
STATUS_OK = "ok"  # the provider returned usable data
STATUS_ABSENT = "absent"  # the provider answered, and has nothing for this film
STATUS_ERROR = "error"  # the request failed; nothing was learnt


class QuotaExhausted(RuntimeError):
    """The provider says the daily allowance is gone. Stop, do not cache."""


@dataclass
class Entry:
    """One cached provider response plus the metadata that dates it."""

    status: str
    data: dict
    fetched_at: datetime

    def is_fresh(self, recent_film: bool) -> bool:
        """Whether this entry can still be trusted (see the TTL constants)."""
        age = datetime.now(UTC) - self.fetched_at
        if self.status == STATUS_ERROR:
            return age < TTL_ERROR
        if self.status == STATUS_ABSENT:
            return age < TTL_ABSENT
        return age < (TTL_RECENT if recent_film else TTL_OK)


class Cache:
    """
    JSON-per-film response cache under ``data/processed/cache/<provider>``.

    Entries are versioned by shape: anything written by an older build (a bare
    payload with no ``status``) is read as settled data so an upgrade does not
    throw away thousands of good responses and re-spend the quota.
    """

    def __init__(self, provider: str):
        self.provider = provider
        self.dir = CACHE_DIR / provider
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, imdb_id: str) -> Path:
        return self.dir / f"{imdb_id}.json"

    def get(self, imdb_id: str) -> Entry | None:
        path = self.path(imdb_id)
        if not path.exists():
            return None
        try:
            raw = json.loads(path.read_text())
        except json.JSONDecodeError:  # pragma: no cover - corrupt file
            return None
        if "status" not in raw:
            # Legacy entry: a plain payload. Treat it as settled data, but date
            # it at the file's mtime so the normal TTL still applies.
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            status = STATUS_OK if any(v is not None for v in raw.values()) else STATUS_ABSENT
            return Entry(status=status, data=raw, fetched_at=mtime)
        return Entry(
            status=raw["status"],
            data=raw.get("data") or {},
            fetched_at=datetime.fromisoformat(raw["fetched_at"]),
        )

    def put(self, imdb_id: str, status: str, data: dict) -> None:
        self.path(imdb_id).write_text(
            json.dumps(
                {"status": status, "data": data, "fetched_at": datetime.now(UTC).isoformat()},
                indent=2,
            )
        )


# --------------------------------------------------------------------- TMDB
def fetch_tmdb(client: httpx.Client, api_key: str, imdb_id: str, year: int | None) -> tuple[str, dict]:
    """
    Resolve an IMDb id to a TMDB movie and return ``(status, payload)``.

    Two calls: ``/find`` maps the external id, ``/movie/{id}`` carries the
    money and the poster. The lookup is by exact IMDb id, so there is no fuzzy
    title matching to get wrong — but the release year is still checked,
    because a wrong mapping upstream would otherwise silently attach another
    film's revenue to this one.
    """
    found = client.get(
        f"{TMDB_BASE}/find/{imdb_id}",
        params={"api_key": api_key, "external_source": "imdb_id"},
    )
    found.raise_for_status()
    results = found.json().get("movie_results") or []
    if not results:
        return STATUS_ABSENT, {}

    detail = client.get(f"{TMDB_BASE}/movie/{results[0]['id']}", params={"api_key": api_key})
    detail.raise_for_status()
    movie = detail.json()

    payload = {
        # TMDB uses 0 for "unknown"; store None so percentiles ignore it
        # rather than ranking a blockbuster as having earned nothing.
        "revenue": movie.get("revenue") or None,
        "budget": movie.get("budget") or None,
        "poster_path": movie.get("poster_path"),
        "tmdb_id": movie.get("id"),
        "tmdb_title": movie.get("title"),
        "tmdb_year": _release_year(movie.get("release_date")),
    }
    if not _year_agrees(year, payload["tmdb_year"]):
        # Keep the record but flag it; the validation pass reports these and
        # ``apply_cache`` refuses to write figures it cannot vouch for.
        payload["year_mismatch"] = True
    return STATUS_OK, payload


def _release_year(release_date: str | None) -> int | None:
    if not release_date or len(release_date) < 4:
        return None
    try:
        return int(release_date[:4])
    except ValueError:  # pragma: no cover - malformed date
        return None


def _year_agrees(expected: int | None, actual: int | None, tolerance: int = 2) -> bool:
    """
    Whether two release years are close enough to be the same film.

    A tolerance is needed rather than equality: the seed files nominees under
    their Oscar eligibility year, and festival premieres or limited releases
    routinely land a year either side of the wide release TMDB records.
    """
    if expected is None or actual is None:
        return True
    return abs(expected - actual) <= tolerance


# --------------------------------------------------------------------- OMDb
def _parse_money(value: str | None) -> float | None:
    """``'$28,341,469'`` -> ``28341469.0``."""
    if not value or value == "N/A":
        return None
    try:
        return float(value.replace("$", "").replace(",", ""))
    except ValueError:
        return None


def _parse_int(value: str | None) -> int | None:
    if not value or value == "N/A":
        return None
    try:
        return int(str(value).rstrip("%"))
    except ValueError:
        return None


def fetch_omdb(client: httpx.Client, api_key: str, imdb_id: str, year: int | None) -> tuple[str, dict]:
    """Return ``(status, payload)`` with Rotten Tomatoes, Metascore and US gross."""
    response = client.get(OMDB_BASE, params={"apikey": api_key, "i": imdb_id})

    # OMDb answers an exhausted quota with HTTP 401 *and* a JSON body saying
    # so. Parsing the body before raising for status is what keeps that case
    # out of the generic-error path: treated as a transient failure it would
    # burn the rest of the run retrying, and cache a blank for films that are
    # perfectly fine.
    try:
        body = response.json()
    except ValueError:
        body = {}
    if body.get("Response") == "False" and "limit" in (body.get("Error") or "").lower():
        raise QuotaExhausted(body.get("Error", "OMDb request limit reached"))
    response.raise_for_status()

    if body.get("Response") != "True":
        error = (body.get("Error") or "").lower()
        if "limit" in error:
            # Never cache this: the film is fine, the account is not.
            raise QuotaExhausted(body.get("Error", "OMDb request limit reached"))
        if "not found" in error or "incorrect imdb" in error:
            return STATUS_ABSENT, {}
        return STATUS_ERROR, {"error": body.get("Error")}

    rt = next((r["Value"] for r in body.get("Ratings", []) if r["Source"] == "Rotten Tomatoes"), None)
    payload = {
        "rt_critic": _parse_int(rt),
        "metascore": _parse_int(body.get("Metascore")),
        "box_office": _parse_money(body.get("BoxOffice")),
        "omdb_title": body.get("Title"),
        "omdb_year": _parse_int((body.get("Year") or "")[:4]),
    }
    if not _year_agrees(year, payload["omdb_year"]):
        payload["year_mismatch"] = True
    return STATUS_OK, payload
