"""
Provider client and response-cache tests (``tests.test_providers``).

Nothing here touches the network - responses are fed in through a mock
transport. The distinctions that matter are the ones that decide whether a
blank in the data means "the provider has nothing" or "we failed to ask".
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from pipeline import providers


@pytest.fixture
def cache(tmp_path):
    """A Cache rooted in a temp dir, for whichever provider a test asks for."""

    def make(provider: str = "omdb") -> providers.Cache:
        instance = providers.Cache.__new__(providers.Cache)
        instance.provider = provider
        instance.dir = tmp_path / provider
        instance.dir.mkdir(parents=True, exist_ok=True)
        return instance

    return make


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
    store.put("tt_error", providers.STATUS_ERROR, {})
    store.put("tt_absent", providers.STATUS_ABSENT, {})

    assert store.get("tt_error").is_fresh(recent_film=False) is True  # not yet
    _age(store, "tt_error", providers.TTL_ERROR + timedelta(hours=1))
    assert store.get("tt_error").is_fresh(recent_film=False) is False  # retried

    _age(store, "tt_absent", providers.TTL_ERROR + timedelta(days=2))
    assert store.get("tt_absent").is_fresh(recent_film=False) is True  # still trusted


def test_recent_films_are_refreshed_far_sooner(cache):
    """A film still in cinemas has not finished earning; a 1974 one has."""
    store = cache("tmdb")
    store.put("tt_new", providers.STATUS_OK, {"revenue": 1})
    _age(store, "tt_new", TTL := providers.TTL_RECENT + timedelta(days=1))

    assert store.get("tt_new").is_fresh(recent_film=True) is False
    assert store.get("tt_new").is_fresh(recent_film=False) is True
    assert TTL < providers.TTL_OK


def test_legacy_cache_entries_are_not_thrown_away(cache):
    """An upgrade must not re-spend the quota on data already on disk."""
    store = cache("omdb")
    store.path("tt_old").write_text(json.dumps({"rt_critic": 89, "metascore": 82}))

    entry = store.get("tt_old")
    assert entry is not None
    assert entry.status == providers.STATUS_OK
    assert entry.data["rt_critic"] == 89


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
        with pytest.raises(providers.QuotaExhausted):
            providers.fetch_omdb(client, "key", "tt0111161", 1994)


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
        status, payload = providers.fetch_omdb(client, "key", "tt0111161", 1994)

    assert status == providers.STATUS_OK
    assert payload["rt_critic"] == 89
    assert payload["metascore"] == 82
    assert payload["box_office"] == 28_341_469.0
    assert "year_mismatch" not in payload


def test_a_release_year_may_differ_by_a_year_or_two():
    """
    The seed files nominees under their Oscar eligibility year and festival
    premieres straddle new year, so exact equality would reject good data.
    """
    assert providers._year_agrees(1994, 1994)
    assert providers._year_agrees(1994, 1995)
    assert providers._year_agrees(1994, 1996)
    assert not providers._year_agrees(1994, 1975)
    assert providers._year_agrees(None, 1994)  # unknown either side is not a conflict


# --- helper -----------------------------------------------------------------
def _age(store: providers.Cache, imdb_id: str, by: timedelta) -> None:
    """Rewrite a cache entry's timestamp so it looks ``by`` older."""
    raw = json.loads(store.path(imdb_id).read_text())
    raw["fetched_at"] = (datetime.now(UTC) - by).isoformat()
    store.path(imdb_id).write_text(json.dumps(raw))
