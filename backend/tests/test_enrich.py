"""
Enrichment run tests (``tests.test_enrich``).

The *run* rather than the provider: which films get queued and in what order,
how the committed enrichment table survives a rebuild, and whether the
validator would catch bad data before it is committed.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
import pytest

from pipeline import enrich, providers


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
    monkeypatch.setattr(providers, "CACHE_DIR", tmp_path / "cache")

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
        _, payload = providers.fetch_omdb(client, "key", "tt0111161", 1994)
    assert payload["year_mismatch"] is True

    store = cache("omdb")
    store.put("tt_bad", providers.STATUS_OK, payload)
    films = films_frame([{"film_id": "tt_bad", "year": 1994}])

    # apply_cache builds its own Cache, so point that constructor at the
    # temp store for the duration of the call.
    original = enrich.Cache
    try:
        enrich.Cache = lambda provider: store  # type: ignore[assignment]
        written, skipped = enrich.apply_cache(films, "omdb")
    finally:
        enrich.Cache = original

    assert skipped == 1
    assert written == 0
    assert films["metascore"].isna().all()


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


# --- contender metric recompute ---------------------------------------------
def test_recompute_survives_contenders_that_already_carry_the_raw_columns(tmp_path, monkeypatch):
    """
    The scheduled refresh failed three days running on exactly this shape.

    The contender table carries its own `imdb_rating`, `imdb_votes` and
    `box_office_usd` because the scorer reads them off the record. Joining the
    fresh values onto a frame that already has those names does not overwrite
    them: pandas suffixes both sides `_x`/`_y`, the plain name disappears, and
    the percentile step dies looking for `imdb_votes`.
    """
    contenders = pd.DataFrame({
        "contender_id": ["c1", "c2"],
        "film_id": ["tt1", "tt2"],
        "year": [2020, 2020],
        "category": ["BEST_PICTURE"] * 2,
        # Already present, and stale on purpose.
        "imdb_rating": [1.0, 1.0],
        "imdb_votes": [1, 1],
        "box_office_usd": [1.0, 1.0],
        "rt_critic": [90, 40],
        "metascore": [80, 50],
        # The derived columns from the previous run.
        "audience": [0.0, 0.0], "critics": [0.0, 0.0],
        "popularity": [0.0, 0.0], "box_office": [0.0, 0.0],
    })
    contenders.to_parquet(tmp_path / "contenders.parquet", index=False)
    monkeypatch.setattr(enrich, "SEED_DIR", tmp_path)

    films = pd.DataFrame({
        "film_id": ["tt1", "tt2"],
        "imdb_rating": [8.2, 6.1],
        "imdb_votes": [1_200_000, 9_000],
        "box_office_usd": [1.06e9, 4.0e6],
    })
    enrich._recompute_contender_metrics(films)

    out = pd.read_parquet(tmp_path / "contenders.parquet")
    assert len(out) == 2
    # No _x/_y anywhere: the join replaced the columns rather than doubling them.
    assert not [c for c in out.columns if c.endswith(("_x", "_y"))]
    # The fresh measurements are on the table, because the scorer reads them.
    assert out.set_index("film_id").loc["tt1", "imdb_votes"] == 1_200_000
    # And the percentiles were re-derived rather than left at the stale zeros.
    assert out["popularity"].max() > 0


def test_recompute_is_idempotent(tmp_path, monkeypatch):
    """Running twice has to produce the same table, or the daily job drifts."""
    contenders = pd.DataFrame({
        "contender_id": ["c1", "c2"],
        "film_id": ["tt1", "tt2"],
        "year": [2020, 2020],
        "imdb_rating": [8.2, 6.1], "imdb_votes": [1_200_000, 9_000],
        "box_office_usd": [1.06e9, 4.0e6],
        "rt_critic": [90, 40], "metascore": [80, 50],
        "audience": [0.0, 0.0], "critics": [0.0, 0.0],
        "popularity": [0.0, 0.0], "box_office": [0.0, 0.0],
    })
    contenders.to_parquet(tmp_path / "contenders.parquet", index=False)
    monkeypatch.setattr(enrich, "SEED_DIR", tmp_path)

    films = contenders[["film_id", "imdb_rating", "imdb_votes", "box_office_usd"]]
    enrich._recompute_contender_metrics(films)
    once = pd.read_parquet(tmp_path / "contenders.parquet")
    enrich._recompute_contender_metrics(films)
    twice = pd.read_parquet(tmp_path / "contenders.parquet")

    pd.testing.assert_frame_equal(once, twice)
