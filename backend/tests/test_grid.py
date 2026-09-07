"""
Six Degrees tests (``tests.test_grid``).

The engine tests use a hand-built people catalog small enough to reason about;
the API tests run against the real one. The properties that get the most
attention are the mode's two central promises — that no cell can be
unanswerable, and that the two actors heading a cell never worked together —
because those are what a player would notice immediately and what a naive
implementation gets wrong.
"""

from __future__ import annotations

import random

import pytest
from fastapi.testclient import TestClient

from app.data.people import Actor, Pairing, PeopleCatalog
from app.engine import grid as grid_engine
from app.engine.errors import GameError


# --- fixtures ---------------------------------------------------------------
def make_actor(
    person_id: str,
    name: str,
    *,
    fame=14.0,
    lead_share=0.5,
    year=2000,
    cluster=0,
    genres=("Drama",),
):
    return Actor(
        person_id=person_id,
        name=name,
        n_films=10,
        fame=fame,
        mean_rating=7.0,
        mean_billing=2.0,
        lead_share=lead_share,
        first_year=year - 10,
        last_year=year + 10,
        median_year=year,
        top_genres=genres,
        casting_type="Marquee Lead",
        cluster_id=cluster,
    )


@pytest.fixture
def linked_people():
    """
    A cast shaped like the puzzle: two groups who never work within their own
    group, and always across it.

    A fully-connected fixture would be useless here — the mode requires header
    actors who have *not* worked together, so a graph where everyone shares a
    film contains no legal board at all. This one is bipartite instead: nine
    "faces" who never appear with each other, and thirty "journeymen" who never
    appear with each other either, but who each work with two thirds of the
    faces. Any two faces therefore have a good number of journeymen in common
    (and vice versa), which is exactly the structure a cell asks about.

    Membership is drawn from a fixed seed rather than written out by hand so
    the connector sets differ from pair to pair, which is what gives the
    ranking and the spread rule something real to act on.
    """
    rng = random.Random(11)
    faces = [make_actor(f"nf{i}", f"Face {i}", fame=20.0 - i * 0.1) for i in range(9)]
    journeymen = [make_actor(f"nj{k}", f"Journeyman {k}", fame=18.0 - k * 0.05) for k in range(30)]

    pairings = []
    for k, journeyman in enumerate(journeymen):
        # Each journeyman has worked with six of the nine faces.
        for face in rng.sample(faces, 6):
            pairings.append(
                Pairing(
                    actor_a=face.person_id,
                    actor_b=journeyman.person_id,
                    # A couple of shared films for some pairs, so "their
                    # best-known film together" is a real choice.
                    film_ids=tuple(f"tt{k}_{face.person_id}_{n}" for n in range((k % 2) + 1)),
                )
            )
    return PeopleCatalog(faces + journeymen, pairings)


def _board(people, seed):
    return grid_engine.build_board(people, random.Random(seed))


# --- the mode's central promises --------------------------------------------
def test_every_cell_of_every_board_has_enough_connectors(linked_people):
    """
    The promise the mode lives or dies on.

    A board is searched for rather than sampled and checked, so this walks a
    lot of boards and asserts that every intersection has connectors to spare —
    and that each one really has worked with both actors heading the cell.
    """
    for seed in range(40):
        board = _board(linked_people, seed)
        for row in range(grid_engine.GRID_SIZE):
            for column in range(grid_engine.GRID_SIZE):
                found = board.connectors_for(row, column)
                assert len(found) >= grid_engine.MIN_CONNECTORS, f"thin cell on seed {seed}"
                for person in found:
                    assert linked_people.have_worked_together(person, board.rows[row])
                    assert linked_people.have_worked_together(person, board.columns[column])


def test_no_pairing_on_the_board_has_already_worked_together(linked_people):
    """
    The rule that keeps a cell worth answering.

    If the row and column actors share a film, every other name in that film
    connects them and the cell answers itself.
    """
    for seed in range(40):
        board = _board(linked_people, seed)
        for row_actor in board.rows:
            for column_actor in board.columns:
                assert not linked_people.have_worked_together(row_actor, column_actor)


def test_a_header_actor_is_never_also_an_answer(linked_people):
    """Answering one header with another is a different, much cheaper question."""
    for seed in range(30):
        board = _board(linked_people, seed)
        for found in board.answers.values():
            assert not (set(found) & board.header_ids)


def test_a_board_never_repeats_an_actor(linked_people):
    for seed in range(30):
        board = _board(linked_people, seed)
        assert len(board.header_ids) == grid_engine.GRID_SIZE * 2


def test_one_actor_cannot_be_the_answer_to_the_whole_board(linked_people):
    """
    The degenerate case: one hugely-connected name topping every cell, which
    makes the board a single question asked nine times.
    """
    for seed in range(40):
        best = [found[0] for found in _board(linked_people, seed).answers.values()]
        for person_id in set(best):
            assert best.count(person_id) <= grid_engine.MAX_CELLS_PER_CONNECTOR


def test_a_board_is_reproducible_from_its_seed(linked_people):
    left = _board(linked_people, "2026-09-07")
    right = _board(linked_people, "2026-09-07")
    assert (left.rows, left.columns) == (right.rows, right.columns)
    assert left.answers == right.answers


def test_a_sparse_graph_fails_loudly_rather_than_hanging():
    """Two actors cannot make a 3x3 board, and saying so beats spinning."""
    people = PeopleCatalog(
        [make_actor("nm1", "One"), make_actor("nm2", "Two")],
        [Pairing("nm1", "nm2", ("tt1",))],
    )
    with pytest.raises(GameError) as exc:
        grid_engine.build_board(people, random.Random(0))
    assert exc.value.status_code == 503


def test_a_graph_where_everyone_has_worked_together_yields_no_board():
    """
    The other way the search can legitimately come up empty.

    Every actor shares a film with every other, so no pair is unconnected and
    there is no legal board. It must say so rather than return a giveaway.
    """
    actors = [make_actor(f"nm{i}", f"Actor {i}", fame=20.0 - i) for i in range(10)]
    pairings = [Pairing(f"nm{i}", f"nm{j}", (f"tt{i}_{j}",)) for i in range(10) for j in range(i + 1, 10)]
    with pytest.raises(GameError) as exc:
        grid_engine.build_board(PeopleCatalog(actors, pairings), random.Random(0))
    assert exc.value.status_code == 503


# --- connectors and links ---------------------------------------------------
def test_an_unfillable_answer_key_is_reported_as_such(linked_people):
    """The matching must say no when nine cells share fewer than nine names."""
    starved = {(r, c): ("nj0", "nj1") for r in range(3) for c in range(3)}
    assert grid_engine.complete_fill(starved) is None


def test_connectors_are_the_intersection_of_two_co_star_lists(linked_people):
    left, right = "nf0", "nf1"
    expected = linked_people.partners[left] & linked_people.partners[right]
    assert set(grid_engine.connectors(linked_people, left, right)) == expected


def test_two_actors_with_no_one_in_common_have_no_connectors(linked_people):
    """Two journeymen who never overlap on a face cannot be bridged."""
    isolated = make_actor("nz", "Isolated", fame=1.0)
    people = PeopleCatalog(
        list(linked_people.actors.values()) + [isolated],
        list(linked_people.pairings.values()) + [Pairing("nz", "nf0", ("tt_zz",))],
    )
    # "nz" only knows nf0, so it can only bridge pairs involving nf0.
    assert grid_engine.connectors(people, "nz", "nj0") in ([], ["nf0"])
    assert grid_engine.connectors(people, "nz", "nf1") == []


def test_the_reveal_names_a_film_on_each_side_of_the_link(linked_people):
    """
    A connector's name alone is an assertion; the two films are the proof.

    One film must be shared with the row actor and the other with the column
    actor, which is what makes the link checkable.
    """
    board = _board(linked_people, 5)
    for (row, column), found in board.answers.items():
        row_actor, column_actor = board.rows[row], board.columns[column]
        left_film, right_film = grid_engine.link_films(linked_people, found[0], row_actor, column_actor)
        assert left_film in linked_people.shared_films(found[0], row_actor)
        assert right_film in linked_people.shared_films(found[0], column_actor)


# --- scoring ----------------------------------------------------------------
def test_the_best_known_connector_scores_full_marks(linked_people):
    board = _board(linked_people, 3)
    for (row, column), found in board.answers.items():
        assert grid_engine.score_answer(board, row, column, found[0]) == 100.0
        # A more obscure actor who also connects them still scores, but less.
        worst = grid_engine.score_answer(board, row, column, found[-1])
        assert grid_engine.MIN_CELL_SCORE <= worst < 100.0


def test_scores_fall_monotonically_down_the_connector_list(linked_people):
    board = _board(linked_people, 8)
    found = board.connectors_for(0, 0)
    scores = [grid_engine.score_answer(board, 0, 0, person) for person in found]
    assert scores == sorted(scores, reverse=True)


def test_naming_someone_who_does_not_connect_them_is_rejected(linked_people):
    board = _board(linked_people, 4)
    with pytest.raises(GameError) as exc:
        grid_engine.score_answer(board, 0, 0, "nm_stranger")
    assert exc.value.status_code == 400


# --- round rules ------------------------------------------------------------
def _round(seed="round-seed"):
    from datetime import UTC, datetime

    return grid_engine.Round(
        id="g1", seed=seed, started_at=datetime.now(UTC), created_at="2026-09-07T00:00:00Z"
    )


def test_an_actor_can_only_be_played_once_per_board(linked_people):
    """Otherwise one well-connected name could fill a whole row."""
    round_ = _round()
    board = round_.board(linked_people)
    # Find a person who connects two different cells.
    reused = next(person for person in board.connectors_for(0, 0) if person in board.connectors_for(1, 1))
    round_.answer(linked_people, 0, 0, reused)
    with pytest.raises(GameError) as exc:
        round_.answer(linked_people, 1, 1, reused)
    assert exc.value.status_code == 409


def test_a_cell_cannot_be_answered_twice(linked_people):
    round_ = _round()
    found = round_.board(linked_people).connectors_for(0, 0)
    round_.answer(linked_people, 0, 0, found[0])
    with pytest.raises(GameError) as exc:
        round_.answer(linked_people, 0, 0, found[1])
    assert exc.value.status_code == 409


def test_a_cell_off_the_board_is_rejected(linked_people):
    with pytest.raises(GameError) as exc:
        _round().answer(linked_people, 3, 0, "nj0")
    assert exc.value.status_code == 400


def test_a_finished_board_takes_no_more_answers(linked_people):
    round_ = _round()
    round_.hand_in()
    with pytest.raises(GameError) as exc:
        round_.answer(linked_people, 0, 0, "nj0")
    assert exc.value.status_code == 409


def test_every_board_can_actually_be_finished(linked_people):
    """
    Answerable cell by cell is not the same as finishable.

    A connector may only be played once, so nine cells drawing on overlapping
    names can strand the last one. Every board must admit a complete
    assignment — and the assignment is verified here rather than trusted:
    nine distinct people, each genuinely a connector for the cell they fill.
    """
    for seed in range(40):
        board = _board(linked_people, seed)
        fill = grid_engine.complete_fill(board.answers)
        assert fill is not None, f"board on seed {seed} cannot be filled"
        assert len(set(fill.values())) == 9
        for cell, person in fill.items():
            assert person in board.answers[cell]


def test_a_perfect_board_is_every_cell_answered_with_its_best_connector(linked_people):
    round_ = _round()
    board = round_.board(linked_people)
    # A full board is only reachable because the generator guarantees one
    # exists; use that assignment rather than filling greedily, which can
    # strand a cell even when a complete fill is available.
    for (row, column), person in grid_engine.complete_fill(board.answers).items():
        round_.answer(linked_people, row, column, person)

    scored = grid_engine.outcome(round_, linked_people)
    assert scored.filled == scored.total == 9
    assert scored.score == grid_engine.total_score(round_.answers)
    assert scored.perfect == all(cell.found_best for cell in scored.cells)
    assert round_.is_over(), "a full board ends the round without handing it in"
    for cell in scored.cells:
        assert cell.best_person_id in board.connectors_for(cell.row, cell.column)
        assert len(cell.best_link_films) == 2


def test_an_empty_board_scores_nothing_and_still_reveals(linked_people):
    scored = grid_engine.outcome(_round(), linked_people)
    assert (scored.filled, scored.score, scored.perfect) == (0, 0.0, False)
    assert len(scored.cells) == 9
    assert all(cell.person_id is None and cell.best_person_id for cell in scored.cells)


# --- API --------------------------------------------------------------------
def test_the_mode_menu_lists_every_mode(client: TestClient):
    modes = client.get("/api/modes").json()
    assert [m["id"] for m in modes] == ["oscars", "recast", "grid"]
    assert all(m["label"] and m["description"] and m["path"] for m in modes)


def test_a_grid_round_plays_through(client: TestClient):
    created = client.post("/api/grid/games", params={"seed": "test-grid"})
    if created.status_code == 503:  # pragma: no cover - side tables not built
        pytest.skip("people tables not built")
    game = created.json()
    assert len(game["rows"]) == len(game["columns"]) == grid_engine.GRID_SIZE
    assert game["seconds_remaining"] > 0

    # The answer key comes from a throwaway board on the same seed.
    twin = client.post("/api/grid/games", params={"seed": "test-grid"}).json()
    revealed = client.post(f"/api/grid/games/{twin['id']}/complete").json()
    assert len(revealed["cells"]) == grid_engine.GRID_SIZE**2

    best = revealed["cells"][0]["best_answer"]["person_id"]
    answered = client.post(
        f"/api/grid/games/{game['id']}/answer", json={"row": 0, "column": 0, "person_id": best}
    )
    assert answered.status_code == 200
    assert answered.json()["cells"][0]["score"] == 100.0
    assert answered.json()["cells"][0]["actor"]["person_id"] == best

    # The same actor cannot fill two cells, and a stranger is out.
    assert (
        client.post(
            f"/api/grid/games/{game['id']}/answer", json={"row": 1, "column": 1, "person_id": best}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/grid/games/{game['id']}/answer",
            json={"row": 1, "column": 1, "person_id": "nm0000000"},
        ).status_code
        == 400
    )


def test_the_answer_box_searches_actors_by_name(client: TestClient):
    created = client.post("/api/grid/games", params={"seed": "search-grid"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game_id = created.json()["id"]

    hits = client.get(f"/api/grid/games/{game_id}/search", params={"q": "ford"}).json()
    assert hits, "no actor matched a common name fragment"
    assert all("ford" in actor["name"].lower() for actor in hits)
    # Someone whose own name starts with the fragment ranks above a mid-string
    # match, so typing a surname reaches the obvious person first.
    assert any(part.startswith("ford") for part in hits[0]["name"].lower().split()), hits[0]["name"]

    assert client.get(f"/api/grid/games/{game_id}/search", params={"q": "a"}).status_code == 422
    assert client.get("/api/grid/games/nope/search", params={"q": "ford"}).status_code == 404


def test_every_grid_pairing_the_api_deals_is_valid(client: TestClient):
    """
    The guarantee, checked through the API on real data rather than a fixture.

    For each board: the two actors heading a cell must never have worked
    together, and the revealed connector must have a film with each of them.
    """
    for index in range(4):
        created = client.post("/api/grid/games", params={"seed": f"valid-{index}"})
        if created.status_code == 503:  # pragma: no cover
            pytest.skip("people tables not built")
        board = created.json()
        results = client.post(f"/api/grid/games/{created.json()['id']}/complete").json()

        names = {a["name"] for a in board["rows"]} | {a["name"] for a in board["columns"]}
        assert len(names) == grid_engine.GRID_SIZE * 2

        for cell in results["cells"]:
            assert cell["n_possible"] >= grid_engine.MIN_CONNECTORS
            assert cell["row_actor"] and cell["column_actor"]
            best = cell["best_answer"]
            assert best["person_id"] and best["name"]
            # The connector is a third party, not one of the six on the board.
            assert best["name"] not in names
            # And the link is shown as two real films, one per side.
            assert len(cell["best_link_films"]) == 2
            assert all(film["film_id"] and film["title"] for film in cell["best_link_films"])
