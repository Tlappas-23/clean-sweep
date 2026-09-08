"""
The Chain tests (``tests.test_chain``).

The engine tests use a hand-built cast graph small enough to reason about; the
API tests run against the real one. The properties that get the most attention
are the ones a player would notice first: that a dealt pair is actually
reachable, that the route revealed at the end is genuinely a shortest one, and
that the same board always reveals the same route.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.data.people import Actor, Pairing, PeopleCatalog
from app.engine import chain as chain_engine
from app.engine.errors import GameError


def make_actor(person_id: str, name: str, *, fame: float = 14.0) -> Actor:
    return Actor(
        person_id=person_id,
        name=name,
        n_films=10,
        fame=fame,
        mean_rating=7.0,
        mean_billing=2.0,
        lead_share=0.5,
        first_year=1990,
        last_year=2010,
        median_year=2000.0,
        top_genres=("Drama",),
        casting_type="Marquee Lead",
        cluster_id=0,
    )


@pytest.fixture
def line_graph():
    """
    A cast graph shaped like a line: f0 - f1 - f2 - f3 - f4.

    Each neighbouring pair shares exactly one actor and nothing else does, so
    every distance is known by construction and a shortest route has only one
    possible answer. That is what makes it useful: on a real graph "is this
    route shortest" needs a search to check, and here it does not.
    """
    films = [f"tt{i}" for i in range(5)]
    actors, pairings = [], []
    for i in range(4):
        link = make_actor(f"nm{i}", f"Link {i}", fame=20.0 - i)
        actors.append(link)
        # One actor in two adjacent films makes exactly one edge. Recorded as
        # two pairings against a walk-on so the pair table has both films.
        walk_a = make_actor(f"nw{i}a", f"Walk {i}a", fame=1.0)
        walk_b = make_actor(f"nw{i}b", f"Walk {i}b", fame=1.0)
        actors += [walk_a, walk_b]
        pairings.append(Pairing(link.person_id, walk_a.person_id, (films[i],)))
        pairings.append(Pairing(link.person_id, walk_b.person_id, (films[i + 1],)))
    return PeopleCatalog(actors, pairings), films


def _round(seed="chain-seed", started=None):
    return chain_engine.Round(
        id="c1",
        seed=seed,
        started_at=started or datetime.now(UTC),
        created_at="2026-09-08T00:00:00Z",
    )


# --- the graph ---------------------------------------------------------------
def test_a_step_is_a_shared_cast_member(line_graph):
    people, films = line_graph
    assert films[1] in chain_engine.neighbours(people, films[0])
    assert films[2] not in chain_engine.neighbours(people, films[0])
    assert chain_engine.shared_actors(people, films[0], films[1]) == ["nm0"]
    assert chain_engine.shared_actors(people, films[0], films[2]) == []


def test_the_route_found_is_the_shortest_one(line_graph):
    """On a line the distance is known, so the search has a right answer."""
    people, films = line_graph
    for distance in range(1, 5):
        route = chain_engine.shortest_route(people, films[0], films[distance])
        assert route is not None
        assert len(route) == distance
        # And every step really is a legal move from the one before it.
        walked = films[0]
        for step in route:
            assert step.person_id in chain_engine.shared_actors(people, walked, step.film_id)
            walked = step.film_id
        assert walked == films[distance]


def test_an_unreachable_target_says_so_rather_than_guessing(line_graph):
    people, films = line_graph
    stranded = make_actor("nz", "Stranded", fame=5.0)
    people = PeopleCatalog(
        list(people.actors.values()) + [stranded],
        list(people.pairings.values()) + [Pairing("nz", "nm0", ("tt_island",))],
    )
    # tt_island only touches nm0, who is in tt0 and tt1, so it IS reachable.
    assert chain_engine.shortest_route(people, films[0], "tt_island") is not None
    # A film nothing shares a cast with is not.
    assert chain_engine.shortest_route(people, films[0], "tt_nowhere") is None


def test_the_search_gives_up_rather_than_walking_forever(line_graph):
    people, films = line_graph
    assert chain_engine.shortest_route(people, films[0], films[4], cap=2) is None


def test_the_same_board_always_reveals_the_same_route(line_graph):
    """
    Neighbour sets iterate in an arbitrary order, so without a deliberate
    tie-break the revealed route changes between runs and a player reloading a
    finished daily sees a different answer.
    """
    people, films = line_graph
    order = {film: index for index, film in enumerate(films)}
    first = chain_engine.shortest_route(people, films[0], films[3], order=order)
    for _ in range(5):
        assert chain_engine.shortest_route(people, films[0], films[3], order=order) == first


# --- the board ---------------------------------------------------------------
def test_a_dealt_board_is_exactly_par_apart(line_graph):
    """
    Two films picked at random are usually two steps apart, which is one lucky
    guess. A board is searched for until it is the intended distance.
    """
    people, films = line_graph
    for seed in range(20):
        board = chain_engine.build_board(people, films, random.Random(seed))
        assert board.par == chain_engine.TARGET_STEPS
        assert board.start != board.target
        route = chain_engine.shortest_route(people, board.start, board.target)
        assert route is not None and len(route) == board.par


def test_a_board_is_reproducible_from_its_seed(line_graph):
    people, films = line_graph
    left = chain_engine.build_board(people, films, random.Random("2026-09-08"))
    right = chain_engine.build_board(people, films, random.Random("2026-09-08"))
    assert (left.start, left.target, left.shortest) == (right.start, right.target, right.shortest)


def test_a_graph_with_nowhere_to_go_fails_loudly(line_graph):
    people, _ = line_graph
    with pytest.raises(GameError) as exc:
        chain_engine.build_board(people, ["tt0"], random.Random(0))
    assert exc.value.status_code == 503


# --- playing -----------------------------------------------------------------
def test_a_move_has_to_share_a_cast_member(line_graph):
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[3], shortest=())
    round_ = _round()
    with pytest.raises(GameError) as exc:
        round_.move(people, board, films[2])
    assert exc.value.status_code == 400
    assert round_.steps == 0, "a refused move must not advance the round"


def test_a_move_names_the_actor_who_carried_you(line_graph):
    """The film is the player's answer; the actor is why it counted."""
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[3], shortest=())
    round_ = _round()
    assert round_.move(people, board, films[1]) == "nm0"
    assert round_.here == films[1]
    assert round_.steps == 1


def test_you_cannot_walk_in_circles(line_graph):
    """
    Revisiting is refused rather than allowed and scored.

    Without it a stuck player can pad their route indefinitely, and steps stop
    meaning anything on the leaderboard.
    """
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[4], shortest=())
    round_ = _round()
    round_.move(people, board, films[1])
    round_.move(people, board, films[2])
    with pytest.raises(GameError) as exc:
        round_.move(people, board, films[1])
    assert exc.value.status_code == 409


def test_standing_still_is_not_a_move(line_graph):
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[3], shortest=())
    with pytest.raises(GameError) as exc:
        _round().move(people, board, films[0])
    assert exc.value.status_code == 400


def test_arriving_ends_the_round(line_graph):
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[2], shortest=())
    round_ = _round()
    round_.move(people, board, films[1])
    assert not round_.is_over(board)
    round_.move(people, board, films[2])
    assert round_.solved(board)
    assert round_.ended_because(board) == "solved"
    with pytest.raises(GameError) as exc:
        round_.move(people, board, films[3])
    assert exc.value.status_code == 409


def test_giving_up_ends_it_without_arriving(line_graph):
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[3], shortest=())
    round_ = _round()
    round_.give_up()
    assert round_.ended_because(board) == "gave_up"
    assert not round_.solved(board)


def test_the_stopwatch_stops_the_round(line_graph):
    """A round cannot run forever, or the leaderboard holds entries with no end."""
    people, films = line_graph
    board = chain_engine.Board(start=films[0], target=films[3], shortest=())
    stale = _round(started=datetime.now(UTC) - timedelta(seconds=chain_engine.MAX_SECONDS + 30))
    assert stale.elapsed() == chain_engine.MAX_SECONDS
    assert stale.ended_because(board) == "time"
    with pytest.raises(GameError) as exc:
        stale.move(people, board, films[1])
    assert exc.value.status_code == 409


def test_the_outcome_keeps_both_routes(line_graph):
    """
    The player's route and a shortest one, side by side.

    Walking one step further than necessary is a worse answer, not a wrong
    one, and the result has to hold both to be able to say so.
    """
    people, films = line_graph
    board = chain_engine.build_board(people, films, random.Random(3))
    round_ = _round()
    for step in board.shortest:
        round_.move(people, board, step.film_id)

    scored = chain_engine.outcome(round_, board)
    assert scored.solved is True
    assert scored.steps == scored.par == board.par
    assert scored.ended == "solved"
    assert [s.film_id for s in scored.route] == [s.film_id for s in board.shortest]
    assert scored.shortest == board.shortest


# --- the leaderboard ---------------------------------------------------------
def test_the_ranking_puts_arriving_first_then_steps_then_time():
    """
    Three different achievements, kept apart.

    Blending them into one number would let a fast bad route beat a slow good
    one, and those are not the same thing.
    """
    rows = [
        {"solved": True, "steps": 4, "seconds": 30},
        {"solved": True, "steps": 3, "seconds": 200},
        {"solved": True, "steps": 3, "seconds": 90},
        {"solved": False, "steps": 2, "seconds": 10},
    ]
    ordered = sorted(rows, key=chain_engine.leaderboard_key)
    assert [(r["solved"], r["steps"], r["seconds"]) for r in ordered] == [
        (True, 3, 90),
        (True, 3, 200),
        (True, 4, 30),
        (False, 2, 10),
    ]


# --- API ---------------------------------------------------------------------
def test_the_mode_menu_lists_the_chain(client: TestClient):
    modes = client.get("/api/modes").json()
    chain_card = next(m for m in modes if m["id"] == "chain")
    assert chain_card["label"] and chain_card["description"]
    assert chain_card["path"] == "/chain"


def test_a_chain_plays_through(client: TestClient):
    created = client.post("/api/chain/games", params={"seed": "api-chain"})
    if created.status_code == 503:  # pragma: no cover - side tables not built
        pytest.skip("people tables not built")
    game = created.json()
    assert game["status"] == "playing"
    assert game["here"]["film_id"] == game["start"]["film_id"]
    assert game["steps"] == 0
    # The board in play must not carry the answer.
    assert "shortest" not in game

    # The answer key comes from a throwaway board on the same seed.
    twin = client.post("/api/chain/games", params={"seed": "api-chain"}).json()
    key = client.post(f"/api/chain/games/{twin['id']}/give-up").json()
    assert key["ended"] == "gave_up" and key["solved"] is False
    assert len(key["shortest"]) == key["par"] == chain_engine.TARGET_STEPS

    game_id = game["id"]
    for step in key["shortest"]:
        moved = client.post(f"/api/chain/games/{game_id}/move", json={"title": step["film"]["title"]})
        assert moved.status_code == 200, moved.json()

    results = client.get(f"/api/chain/games/{game_id}/results").json()
    assert results["solved"] is True
    assert results["steps"] == results["par"]
    assert results["ended"] == "solved"
    assert [s["film"]["film_id"] for s in results["route"]] == [s["film"]["film_id"] for s in key["shortest"]]


def test_the_two_refusals_say_different_things(client: TestClient):
    """
    A title nothing matches and a real film with nobody in common are
    different mistakes, so they do not share a message.
    """
    created = client.post("/api/chain/games", params={"seed": "refusals"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game_id = created.json()["id"]

    unknown = client.post(f"/api/chain/games/{game_id}/move", json={"title": "Zzzz Nonesuch"})
    assert unknown.status_code == 400
    assert "no film" in unknown.json()["detail"]

    # A real film that shares nobody with the start. Found rather than assumed,
    # since which films connect depends on the seed. Searching two common words
    # gives plenty of candidates; almost none of them will connect.
    start_id = created.json()["start"]["film_id"]
    candidates = [
        film
        for word in ("the", "man")
        for film in client.get(f"/api/chain/games/{game_id}/search", params={"q": word, "limit": 40}).json()
        if film["film_id"] != start_id
    ]
    assert candidates, "the search should offer something to try"

    refused = None
    for film in candidates:
        response = client.post(f"/api/chain/games/{game_id}/move", json={"title": film["title"]})
        if response.status_code == 400:
            refused = response.json()["detail"]
            break
        # It connected, so that was a legal move. Start a clean round and
        # keep looking rather than testing against a board mid-walk.
        game_id = client.post("/api/chain/games", params={"seed": "refusals"}).json()["id"]

    assert refused is not None, "no unconnected film found to refuse"
    assert "was in the one you are on" in refused
    assert refused != unknown.json()["detail"], "the two refusals must not be the same message"


def test_a_title_is_forgiven_its_spelling(client: TestClient):
    """Typing against a stopwatch should not lose a move to a missing letter."""
    created = client.post("/api/chain/games", params={"seed": "spelling"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    twin = client.post("/api/chain/games", params={"seed": "spelling"}).json()
    key = client.post(f"/api/chain/games/{twin['id']}/give-up").json()

    title = key["shortest"][0]["film"]["title"]
    sloppy = title.lower()[:-1]  # drop the last letter and the capitals
    moved = client.post(f"/api/chain/games/{created.json()['id']}/move", json={"title": sloppy})
    assert moved.status_code == 200, f"{sloppy!r} should still reach {title!r}"
    assert moved.json()["here"]["title"] == title


def test_results_are_refused_while_the_chain_is_live(client: TestClient):
    created = client.post("/api/chain/games", params={"seed": "live"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    assert client.get(f"/api/chain/games/{created.json()['id']}/results").status_code == 409


def test_the_leaderboard_ranks_finished_chains(client: TestClient):
    created = client.post("/api/chain/games", params={"seed": "board"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    client.post(f"/api/chain/games/{created.json()['id']}/give-up")

    rows = client.get("/api/chain/leaderboard").json()
    assert rows, "a finished chain should appear"
    keys = [(not r["solved"], r["steps"], r["seconds"]) for r in rows]
    assert keys == sorted(keys), "the board must come back ranked"
