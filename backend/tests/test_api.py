"""
API integration tests (``tests.test_api``).

These run the real application over the real seed tables (68k contenders,
1927-2025) with a throwaway database, so they check the things the engine
tests cannot: routing, persistence between requests, query handling, the
masking rules as they appear on the wire, and the shape of every payload
against docs/API.md.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

CATEGORIES = [
    "picture",
    "director",
    "actor",
    "actress",
    "supporting_actor",
    "supporting_actress",
]


# --- helpers -----------------------------------------------------------------


def create_game(client: TestClient, mode: str = "classic", seed: str | None = None) -> dict:
    body: dict[str, object] = {"mode": mode}
    if seed is not None:
        body["seed"] = seed
    response = client.post("/api/games", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def play_to_completion(client: TestClient, game: dict, pick_winner: bool = True) -> dict:
    """
    Play a game out, optionally always drafting the contender who really won.

    The winner is found through the browse endpoint, which is the only place
    the Academy outcome is public - the in-game candidate list deliberately
    cannot reveal it.
    """
    game_id = game["id"]
    for _ in range(6):
        state = client.post(f"/api/games/{game_id}/spin").json()
        spin = state["current_spin"]
        candidates = client.get(f"/api/games/{game_id}/candidates", params={"sort": "title"}).json()

        chosen = candidates[0]["contender_id"]
        if pick_winner:
            browse = client.get(
                f"/api/catalog/years/{spin['year']}", params={"category": spin["category"]}
            ).json()
            winners = [c for c in browse if c["academy"]["won"]]
            assert winners, f"the reels dealt an unwinnable slot: {spin}"
            chosen = winners[0]["contender_id"]

        response = client.post(f"/api/games/{game_id}/pick", json={"contender_id": chosen})
        assert response.status_code == 200, response.text
        state = response.json()
    assert state["status"] == "complete"
    return state


# --- meta and health ---------------------------------------------------------


def test_health(client: TestClient):
    assert client.get("/health").json() == {"status": "ok"}


def test_meta_describes_the_game(client: TestClient):
    meta = client.get("/api/meta").json()
    assert [c["id"] for c in meta["categories"]] == CATEGORIES
    assert {m["id"] for m in meta["modes"]} == {"classic", "cinephile"}
    assert meta["years"]["min"] == 1927 and meta["years"]["max"] >= 2024
    assert meta["decades"][0] == "1920s"
    assert len(meta["ceremonies"]) == 30
    # Thresholds ascend, ending at the Academy Awards.
    thresholds = [c["threshold"] for c in meta["ceremonies"]]
    assert thresholds == sorted(thresholds)
    assert meta["ceremonies"][-1]["name"] == "Academy Awards"
    assert {m["id"] for m in meta["metrics"]} == {
        "academy",
        "prestige",
        "acclaim",
        "popularity",
        "box_office",
    }


# --- the round loop ----------------------------------------------------------


def test_full_game_flow_with_real_data(client: TestClient):
    """Create, spin, list, pick six times, then read the results."""
    game = create_game(client, seed="test-flow")
    assert game["status"] == "spinning"
    assert game["skips_remaining"] == {"year": 1, "category": 1}

    final = play_to_completion(client, game)
    assert len(final["picks"]) == 6
    assert {p["category"] for p in final["picks"]} == set(CATEGORIES)

    results = client.get(f"/api/games/{game['id']}/results").json()
    assert results["wins"] + results["losses"] == 30
    assert 0 <= results["ballot_strength"] <= 600
    assert len(results["ceremonies"]) == 30
    assert len(results["picks"]) == 6
    # Every slot was filled with the real winner, so the ballot must sweep.
    assert all(p["won_oscar"] for p in results["picks"])
    assert results["clean_sweep"] is True
    assert results["wins"] == 30


def test_results_reveal_metrics_and_the_actual_winner(client: TestClient):
    game = create_game(client, seed="test-reveal")
    play_to_completion(client, game, pick_winner=False)
    results = client.get(f"/api/games/{game['id']}/results").json()

    for entry in results["picks"]:
        assert set(entry["metric_breakdown"]) == {
            "academy",
            "prestige",
            "acclaim",
            "popularity",
            "box_office",
        }
        assert entry["academy"] in (0, 60, 100)
        assert entry["actual_winner"] is not None
        assert entry["pick"]["contender"]["metrics"]["acclaim"] is not None
    assert results["weakest_category"] in CATEGORIES


def test_candidates_search_and_sort(client: TestClient):
    game = create_game(client, seed="test-search")
    game_id = game["id"]
    spin = client.post(f"/api/games/{game_id}/spin").json()["current_spin"]

    by_acclaim = client.get(f"/api/games/{game_id}/candidates", params={"sort": "acclaim"}).json()
    assert len(by_acclaim) > 1
    scores = [c["metrics"]["acclaim"] for c in by_acclaim if c["metrics"]["acclaim"] is not None]
    assert scores == sorted(scores, reverse=True)
    assert all(c["year"] == spin["year"] and c["category"] == spin["category"] for c in by_acclaim)

    by_title = client.get(f"/api/games/{game_id}/candidates", params={"sort": "title"}).json()
    titles = [c["film_title"].lower() for c in by_title]
    assert titles == sorted(titles)

    # A substring filter narrows the pool and matches title, person or character.
    needle = by_title[0]["film_title"][:4]
    filtered = client.get(f"/api/games/{game_id}/candidates", params={"q": needle}).json()
    assert 0 < len(filtered) <= len(by_title)
    assert all(
        needle.lower()
        in c["film_title"].lower() + (c["person_name"] or "").lower() + (c["character"] or "").lower()
        for c in filtered
    )


def test_skips_are_limited_to_one_each(client: TestClient):
    game = create_game(client, seed="test-skips")
    game_id = game["id"]
    client.post(f"/api/games/{game_id}/spin")

    state = client.post(f"/api/games/{game_id}/skip", json={"kind": "year"}).json()
    assert state["skips_remaining"]["year"] == 0
    assert state["current_spin"]["category"] == "picture"

    again = client.post(f"/api/games/{game_id}/skip", json={"kind": "year"})
    assert again.status_code == 409
    assert "no year skips remaining" in again.json()["detail"]

    state = client.post(f"/api/games/{game_id}/skip", json={"kind": "category"}).json()
    assert state["skips_remaining"]["category"] == 0
    assert state["current_spin"]["category"] == "director"
    assert state["category_order"][-1] == "picture"


def test_invalid_transitions_return_conflicts(client: TestClient):
    game = create_game(client, seed="test-invalid")
    game_id = game["id"]

    # No pool on the board yet.
    assert client.get(f"/api/games/{game_id}/candidates").status_code == 409
    assert client.get(f"/api/games/{game_id}/results").status_code == 409

    client.post(f"/api/games/{game_id}/spin")
    assert client.post(f"/api/games/{game_id}/spin").status_code == 409

    bad_pick = client.post(f"/api/games/{game_id}/pick", json={"contender_id": "actor:nm0:tt0"})
    assert bad_pick.status_code == 404

    assert client.get("/api/games/does-not-exist").status_code == 404


def test_a_contender_outside_the_current_pool_is_rejected(client: TestClient):
    """Knowing an id is not enough: it has to be the pool actually on the board."""
    game = create_game(client, seed="test-wrong-pool")
    game_id = game["id"]
    spin = client.post(f"/api/games/{game_id}/spin").json()["current_spin"]

    other_year = 1994 if spin["year"] != 1994 else 1995
    elsewhere = client.get(f"/api/catalog/years/{other_year}", params={"category": "picture"}).json()
    response = client.post(f"/api/games/{game_id}/pick", json={"contender_id": elsewhere[0]["contender_id"]})
    assert response.status_code == 400
    assert "not in the" in response.json()["detail"]


# --- modes and masking -------------------------------------------------------


def test_cinephile_mode_hides_every_number(client: TestClient):
    game = create_game(client, mode="cinephile", seed="test-cinephile")
    game_id = game["id"]
    client.post(f"/api/games/{game_id}/spin")

    candidates = client.get(f"/api/games/{game_id}/candidates", params={"sort": "title"}).json()
    for candidate in candidates[:10]:
        assert candidate["metrics"] == {
            "acclaim": None,
            "popularity": None,
            "box_office": None,
            "prestige": None,
        }
        assert all(value is None for value in candidate["stats"].values())
        assert candidate["archetype"] is None
        assert candidate["film_title"]  # the identity is still shown

    # Sorting by a hidden metric would leak the ranking, so it is refused.
    refused = client.get(f"/api/games/{game_id}/candidates", params={"sort": "prestige"})
    assert refused.status_code == 400


def test_classic_mode_shows_metrics_and_archetypes(client: TestClient):
    game = create_game(client, seed="test-classic")
    game_id = game["id"]
    client.post(f"/api/games/{game_id}/spin")
    candidates = client.get(f"/api/games/{game_id}/candidates").json()

    assert any(c["metrics"]["acclaim"] is not None for c in candidates)
    assert any(c["metrics"]["prestige"] is not None for c in candidates), "ML scores should be joined"
    assert any(c["archetype"] for c in candidates)
    # The Academy outcome has no field to hide in.
    assert "nominated" not in candidates[0] and "won" not in candidates[0]


def test_the_daily_seed_is_reproducible(client: TestClient):
    """Two games created with the same seed are dealt the same reels."""
    first = create_game(client, seed="2026-09-06")
    second = create_game(client, seed="2026-09-06")
    assert first["id"] != second["id"]

    spins = []
    for game in (first, second):
        state = client.post(f"/api/games/{game['id']}/spin").json()
        spins.append(state["current_spin"])
    assert spins[0] == spins[1]

    # An unseeded game gets its own stream keyed off the game id.
    unseeded = create_game(client)
    assert client.post(f"/api/games/{unseeded['id']}/spin").json()["current_spin"] is not None


def test_every_dealt_slot_is_winnable(client: TestClient):
    """
    The reels must never deal a year in which the category was not awarded.

    Best Supporting Actor/Actress did not exist before the 1936 ceremony, so
    landing on 1929 would make a clean sweep impossible through no fault of the
    player. The engine re-spins past those years; this walks several games to
    confirm it.
    """
    for index in range(6):
        game = create_game(client, seed=f"winnable-{index}")
        for _ in range(6):
            spin = client.post(f"/api/games/{game['id']}/spin").json()["current_spin"]
            browse = client.get(
                f"/api/catalog/years/{spin['year']}", params={"category": spin["category"]}
            ).json()
            assert any(c["academy"]["won"] for c in browse), f"unwinnable slot dealt: {spin}"
            candidates = client.get(f"/api/games/{game['id']}/candidates").json()
            client.post(f"/api/games/{game['id']}/pick", json={"contender_id": candidates[0]["contender_id"]})


# --- leaderboard -------------------------------------------------------------


def test_submit_and_read_the_leaderboard(client: TestClient):
    game = create_game(client, seed="2026-01-01")
    play_to_completion(client, game)

    submitted = client.post(f"/api/games/{game['id']}/submit", json={"player_name": "Thomas"})
    assert submitted.status_code == 201
    entry = submitted.json()
    assert entry["player_name"] == "Thomas"
    assert entry["wins"] == 30 and entry["clean_sweep"] is True

    # One entry per game.
    assert client.post(f"/api/games/{game['id']}/submit", json={"player_name": "Thomas"}).status_code == 409

    table = client.get("/api/leaderboard", params={"seed": "2026-01-01"}).json()
    assert any(row["id"] == entry["id"] for row in table)
    # Ordered by record, then strength.
    keys = [(-row["wins"], -row["ballot_strength"]) for row in table]
    assert keys == sorted(keys)


def test_an_unfinished_game_cannot_be_submitted(client: TestClient):
    game = create_game(client, seed="test-unfinished")
    response = client.post(f"/api/games/{game['id']}/submit", json={"player_name": "Nobody"})
    assert response.status_code == 409


# --- catalog and analytics ---------------------------------------------------


def test_browse_a_year_unmasked(client: TestClient):
    """1994 Best Picture: the pool is public here, winner flag and all."""
    pool = client.get("/api/catalog/years/1994", params={"category": "picture"}).json()
    titles = {c["film_title"] for c in pool}
    assert {"Forrest Gump", "Pulp Fiction", "The Shawshank Redemption"} <= titles

    winners = [c for c in pool if c["academy"]["won"]]
    assert [c["film_title"] for c in winners] == ["Forrest Gump"]
    nominated = {c["film_title"] for c in pool if c["academy"]["nominated"]}
    assert "Pulp Fiction" in nominated and "The Shawshank Redemption" in nominated

    assert client.get("/api/catalog/years/1850").status_code == 404


def test_browse_acting_categories_carry_person_and_character(client: TestClient):
    pool = client.get("/api/catalog/years/1994", params={"category": "actor"}).json()
    winner = next(c for c in pool if c["academy"]["won"])
    assert winner["person_name"] == "Tom Hanks"
    assert winner["film_title"] == "Forrest Gump"
    assert winner["character"]
    assert winner["person_id"].startswith("nm")


def test_analytics_endpoints_serve_the_model_artifacts(client: TestClient):
    """Both are optional; when the models have been trained they must match the contract."""
    clusters = client.get("/api/analytics/clusters")
    if clusters.status_code == 200:
        payload = clusters.json()
        assert payload["archetypes"] and payload["points"] and payload["features"]
        assert {"label", "size", "centroid", "examples"} <= set(payload["archetypes"][0])
        assert {"film_id", "title", "year", "x", "y", "archetype"} <= set(payload["points"][0])
    else:
        assert clusters.status_code == 404

    ranker = client.get("/api/analytics/ranker")
    if ranker.status_code == 200:
        payload = ranker.json()
        assert payload["model"]
        assert 0.5 < payload["metrics"]["roc_auc"] <= 1.0
        assert payload["feature_importances"] and payload["calibration"]
    else:
        assert ranker.status_code == 404
