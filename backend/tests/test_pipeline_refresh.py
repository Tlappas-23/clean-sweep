"""
Tests for the scheduled refresh (``tests.test_pipeline_refresh``).

This job runs unattended against a metered API, so the things worth pinning
down are the ones that would quietly waste a day's quota or write data nobody
checked: the budget ledger, the cache's freshness rules, the newest-first
queue, and the validator. None of these touch the network — the provider
responses are fed in as fixtures.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
import pytest

from pipeline import enrich
from pipeline.budget import Budget, today


# --- fixtures ---------------------------------------------------------------
@pytest.fixture
def ledger_path(tmp_path):
    return tmp_path / "usage.json"


@pytest.fixture
def cache(tmp_path, monkeypatch):
    """A Cache rooted in a temp dir, for whichever provider a test asks for."""

    def make(provider: str = "omdb") -> enrich.Cache:
        instance = enrich.Cache.__new__(enrich.Cache)
        instance.provider = provider
        instance.dir = tmp_path / provider
        instance.dir.mkdir(parents=True, exist_ok=True)
        return instance

    return make


def films_frame(rows: list[dict]) -> pd.DataFrame:
    """A minimal films frame with every column the queue and validator read."""
    defaults = {
        "title": "A Film",
        "year": 2000,
        "imdb_votes": 1000,
        "poster_path": None,
        "box_office_usd": None,
        "budget_usd": None,
        "rt_critic": None,
        "metascore": None,
    }
    return pd.DataFrame([{**defaults, **row} for row in rows])


# --- budget -----------------------------------------------------------------
def test_budget_persists_spend_across_processes(ledger_path):
    """A second run the same day must see what the first one spent."""
    first = Budget.load("omdb", limit=100, path=ledger_path)
    assert first.used == 0
    first.spend(30)

    second = Budget.load("omdb", limit=100, path=ledger_path)
    assert second.used == 30
    # The safety margin is held back from every budget.
    assert second.remaining == 100 - 30 - 10


def test_budget_is_written_after_every_request(ledger_path):
    """A killed run still leaves an honest count, so spend is flushed each time."""
    budget = Budget.load("omdb", limit=100, path=ledger_path)
    for _ in range(5):
        budget.spend(1)
        on_disk = json.loads(ledger_path.read_text())["omdb"][today()]
        assert on_disk == budget.used


def test_budget_never_reports_negative_headroom(ledger_path):
    budget = Budget.load("omdb", limit=20, path=ledger_path)
    budget.spend(1000)
    assert budget.remaining == 0
    assert budget.can_spend(1) is False
    assert budget.films_affordable() == 0


def test_exhaust_marks_the_whole_day_spent(ledger_path):
    """
    The provider outranks the ledger.

    A shared key or a run from before the ledger existed can leave the local
    count optimistic; when the provider says the quota is gone, the day is
    gone.
    """
    budget = Budget.load("omdb", limit=1000, path=ledger_path)
    budget.spend(3)
    budget.exhaust()
    assert budget.remaining == 0
    assert Budget.load("omdb", limit=1000, path=ledger_path).remaining == 0


def test_tmdb_costs_two_requests_per_film(ledger_path):
    """TMDB needs a find plus a detail call, so its budget buys half as many films."""
    budget = Budget.load("tmdb", limit=110, path=ledger_path)
    assert budget.films_affordable() == (110 - 10) // 2


# --- cache freshness --------------------------------------------------------
def test_a_transient_error_is_retried_but_a_confirmed_absence_is_not(cache):
    """
    The distinction that keeps the data honest.

    A failed request means nothing was learnt and must be retried; "the
    provider genuinely has no data" is an answer and should be trusted for a
    while. Collapsing the two would let one bad afternoon permanently blank a
    film's box office.
    """
    store = cache("omdb")
    store.put("tt_error", enrich.STATUS_ERROR, {})
    store.put("tt_absent", enrich.STATUS_ABSENT, {})

    assert store.get("tt_error").is_fresh(recent_film=False) is True  # not yet
    _age(store, "tt_error", enrich.TTL_ERROR + timedelta(hours=1))
    assert store.get("tt_error").is_fresh(recent_film=False) is False  # retried

    _age(store, "tt_absent", enrich.TTL_ERROR + timedelta(days=2))
    assert store.get("tt_absent").is_fresh(recent_film=False) is True  # still trusted


def test_recent_films_are_refreshed_far_sooner(cache):
    """A film still in cinemas has not finished earning; a 1974 one has."""
    store = cache("tmdb")
    store.put("tt_new", enrich.STATUS_OK, {"revenue": 1})
    _age(store, "tt_new", TTL := enrich.TTL_RECENT + timedelta(days=1))

    assert store.get("tt_new").is_fresh(recent_film=True) is False
    assert store.get("tt_new").is_fresh(recent_film=False) is True
    assert TTL < enrich.TTL_OK


def test_legacy_cache_entries_are_not_thrown_away(cache):
    """An upgrade must not re-spend the quota on data already on disk."""
    store = cache("omdb")
    store.path("tt_old").write_text(json.dumps({"rt_critic": 89, "metascore": 82}))

    entry = store.get("tt_old")
    assert entry is not None
    assert entry.status == enrich.STATUS_OK
    assert entry.data["rt_critic"] == 89


# --- queue ------------------------------------------------------------------
def test_the_queue_is_newest_first(cache):
    films = films_frame(
        [
            {"film_id": "tt_old", "year": 1954},
            {"film_id": "tt_new", "year": 2025},
            {"film_id": "tt_mid", "year": 1999},
        ]
    )
    queue = enrich.build_queue(films, cache("omdb"), limit=None)
    assert [film_id for film_id, _ in queue] == ["tt_new", "tt_mid", "tt_old"]


def test_the_queue_stops_at_the_budget(cache):
    films = films_frame([{"film_id": f"tt{i}", "year": 2000 + i} for i in range(10)])
    assert len(enrich.build_queue(films, cache("omdb"), limit=3)) == 3


def test_a_cold_cache_does_not_re_fetch_what_the_seed_already_has(cache):
    """
    The first scheduled run on a fresh CI runner has no response cache. It
    must not spend the day re-fetching films the committed seed already
    answers for - but recent films are still refreshed, because theirs is the
    data that moves.
    """
    current = datetime.now(UTC).year
    films = films_frame(
        [
            {"film_id": "tt_have", "year": 1980, "poster_path": "/a.jpg"},
            {"film_id": "tt_missing", "year": 1981, "poster_path": None},
            {"film_id": "tt_recent", "year": current, "poster_path": "/b.jpg"},
        ]
    )
    queued = {film_id for film_id, _ in enrich.build_queue(films, cache("tmdb"), limit=None)}
    assert queued == {"tt_missing", "tt_recent"}


# --- durability across a rebuild --------------------------------------------
def test_enrichment_survives_a_rebuild_with_a_cold_cache(tmp_path, monkeypatch):
    """
    The regression that matters most.

    ``build_seed`` rewrites films.parquet with blank enrichment columns, and a
    fresh CI runner has no response cache, so for one run the committed table
    is the *only* copy of months of API calls. A scheduled rebuild once
    published a catalog with 0.1% poster coverage exactly this way.
    """
    table = tmp_path / "enrichment.parquet"
    monkeypatch.setattr(enrich, "ENRICHMENT_PATH", table)

    enriched = films_frame(
        [
            {"film_id": "tt1", "poster_path": "/a.jpg", "box_office_usd": 5.0},
            {"film_id": "tt2", "poster_path": "/b.jpg", "rt_critic": 91},
        ]
    )
    assert enrich.save_enrichment_table(enriched) == 2

    # What build_seed hands back: the same films, every enriched column blank.
    rebuilt = films_frame([{"film_id": "tt1"}, {"film_id": "tt2"}, {"film_id": "tt3"}])
    assert rebuilt["poster_path"].notna().sum() == 0

    restored = enrich.apply_enrichment_table(rebuilt)

    assert restored > 0
    assert rebuilt.loc[rebuilt.film_id == "tt1", "poster_path"].iloc[0] == "/a.jpg"
    assert rebuilt.loc[rebuilt.film_id == "tt1", "box_office_usd"].iloc[0] == 5.0
    assert rebuilt.loc[rebuilt.film_id == "tt2", "rt_critic"].iloc[0] == 91
    # A film the table has never seen stays empty rather than picking up a
    # neighbour's values.
    assert pd.isna(rebuilt.loc[rebuilt.film_id == "tt3", "poster_path"].iloc[0])


def test_the_table_is_restored_before_the_queue_is_built(tmp_path, monkeypatch):
    """
    Ordering, not just presence.

    The queue's cold-cache fallback reads the seed's enrichment columns to
    decide what still needs fetching. Restoring the committed table *after*
    the fetch would leave every film looking unenriched on a rebuild day and
    re-queue the whole catalog - which is exactly what happened: one scheduled
    run spent 11,364 TMDB requests re-fetching data it already had, and would
    have burned OMDb's entire daily allowance the same way.
    """
    monkeypatch.setattr(enrich, "ENRICHMENT_PATH", tmp_path / "enrichment.parquet")
    monkeypatch.setattr(enrich, "SEED_DIR", tmp_path)
    monkeypatch.setattr(enrich, "CACHE_DIR", tmp_path / "cache")

    enrich.save_enrichment_table(films_frame([{"film_id": "tt_old", "year": 1980, "poster_path": "/a.jpg"}]))
    # A rebuilt catalog: the same film, enrichment columns blank.
    rebuilt = films_frame([{"film_id": "tt_old", "year": 1980, "poster_path": None}])

    # What the queue sees is the question. Before the restore it looks
    # unenriched; after it, there is nothing to fetch.
    cold = enrich.Cache.__new__(enrich.Cache)
    cold.provider = "tmdb"
    cold.dir = tmp_path / "cold"
    cold.dir.mkdir(parents=True, exist_ok=True)

    assert enrich.build_queue(rebuilt, cold, limit=None), "blank seed should look unenriched"
    enrich.apply_enrichment_table(rebuilt)
    assert enrich.build_queue(rebuilt, cold, limit=None) == [], (
        "after restoring the table the rebuilt catalog must need no requests"
    )


def test_the_table_only_holds_films_with_data(tmp_path, monkeypatch):
    """It is committed, so it stays small and its diff stays readable."""
    table = tmp_path / "enrichment.parquet"
    monkeypatch.setattr(enrich, "ENRICHMENT_PATH", table)

    rows = enrich.save_enrichment_table(
        films_frame(
            [
                {"film_id": "tt_has", "poster_path": "/a.jpg"},
                {"film_id": "tt_empty"},
            ]
        )
    )
    assert rows == 1
    assert pd.read_parquet(table)["film_id"].tolist() == ["tt_has"]


# --- provider parsing -------------------------------------------------------
def test_omdb_reports_an_exhausted_quota_rather_than_an_error(cache):
    """
    OMDb answers an exhausted quota with HTTP 401 *and* a JSON body saying so.

    Read as a plain HTTP failure it would be cached as "no data" for a film
    that is perfectly fine, so the body is parsed before the status is raised.
    """
    transport = httpx.MockTransport(
        lambda request: httpx.Response(401, json={"Response": "False", "Error": "Request limit reached!"})
    )
    with httpx.Client(transport=transport) as client:
        with pytest.raises(enrich.QuotaExhausted):
            enrich.fetch_omdb(client, "key", "tt0111161", 1994)


def test_omdb_parses_scores_and_money(cache):
    body = {
        "Response": "True",
        "Title": "The Shawshank Redemption",
        "Year": "1994",
        "Metascore": "82",
        "BoxOffice": "$28,341,469",
        "Ratings": [{"Source": "Rotten Tomatoes", "Value": "89%"}],
    }
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    with httpx.Client(transport=transport) as client:
        status, payload = enrich.fetch_omdb(client, "key", "tt0111161", 1994)

    assert status == enrich.STATUS_OK
    assert payload["rt_critic"] == 89
    assert payload["metascore"] == 82
    assert payload["box_office"] == 28_341_469.0
    assert "year_mismatch" not in payload


def test_a_year_mismatch_is_flagged_and_never_written(cache):
    """
    An IMDb id that resolves to a film from another decade is a bad mapping,
    and its money must not be attached to ours.
    """
    body = {
        "Response": "True",
        "Title": "Some Other Film",
        "Year": "1975",
        "Metascore": "70",
        "Ratings": [],
    }
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    with httpx.Client(transport=transport) as client:
        _, payload = enrich.fetch_omdb(client, "key", "tt0111161", 1994)
    assert payload["year_mismatch"] is True

    store = cache("omdb")
    store.put("tt_bad", enrich.STATUS_OK, payload)
    films = films_frame([{"film_id": "tt_bad", "year": 1994}])

    monkey = enrich.Cache
    try:
        enrich.Cache = lambda provider: store  # type: ignore[assignment]
        written, skipped = enrich.apply_cache(films, "omdb")
    finally:
        enrich.Cache = monkey

    assert skipped == 1
    assert written == 0
    assert films["metascore"].isna().all()


def test_a_release_year_may_differ_by_a_year_or_two():
    """
    The seed files nominees under their Oscar eligibility year and festival
    premieres straddle new year, so exact equality would reject good data.
    """
    assert enrich._year_agrees(1994, 1994)
    assert enrich._year_agrees(1994, 1995)
    assert enrich._year_agrees(1994, 1996)
    assert not enrich._year_agrees(1994, 1975)
    assert enrich._year_agrees(None, 1994)  # unknown either side is not a conflict


# --- validation -------------------------------------------------------------
def test_validation_catches_impossible_values():
    films = films_frame(
        [
            {"film_id": "tt1", "title": "Bad Score", "rt_critic": 140},
            {"film_id": "tt2", "title": "Negative Gross", "box_office_usd": -5.0},
            {"film_id": "tt3", "title": "Absurd Gross", "box_office_usd": 9e9},
        ]
    )
    problems = " ".join(enrich.validate(films))
    assert "rt_critic outside 0-100" in problems
    assert "negative box_office_usd" in problems
    assert "implausible box_office_usd" in problems


def test_a_poster_shared_within_one_year_is_fine_across_years_is_not():
    """
    TMDB legitimately reuses one image across the parts of a serial released
    the same year; the same image on films decades apart is a bad lookup.
    """
    same_year = films_frame(
        [
            {"film_id": "tt1", "title": "Part I", "year": 1949, "poster_path": "/x.jpg"},
            {"film_id": "tt2", "title": "Part II", "year": 1949, "poster_path": "/x.jpg"},
        ]
    )
    assert enrich.validate(same_year) == []

    across_years = films_frame(
        [
            {"film_id": "tt1", "title": "One", "year": 1949, "poster_path": "/x.jpg"},
            {"film_id": "tt2", "title": "Two", "year": 2011, "poster_path": "/x.jpg"},
        ]
    )
    assert any("shared across different years" in p for p in enrich.validate(across_years))


def test_clean_data_reports_no_problems():
    films = films_frame([{"film_id": "tt1", "title": "Fine", "rt_critic": 89, "poster_path": "/a.jpg"}])
    assert enrich.validate(films) == []


# --- helper -----------------------------------------------------------------
def _age(store: enrich.Cache, imdb_id: str, by: timedelta) -> None:
    """Rewrite a cache entry's timestamp so it looks ``by`` older."""
    raw = json.loads(store.path(imdb_id).read_text())
    raw["fetched_at"] = (datetime.now(UTC) - by).isoformat()
    store.path(imdb_id).write_text(json.dumps(raw))
