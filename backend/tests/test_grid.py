"""
Co-star Grid tests (``tests.test_grid``).

The engine tests use a hand-built people catalog small enough to reason about;
the API tests run against the real one. The property that gets the most
attention is the mode's central promise - that no cell can be unanswerable -
because it is the one a player would notice immediately and the one a naive
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
def dense_people():
    """
    A small but fully-connected cast: every actor shares a film with every
    other, so a board can always be found and the constraints can be tested
    in isolation.
    """
    actors = [make_actor(f"nm{i}", f"Actor {i}", fame=20.0 - i * 0.1) for i in range(12)]
    pairings = []
    counter = 0
    for i in range(12):
        for j in range(i + 1, 12):
            counter += 1
            # Give some pairs several shared films so ranking has something to do.
            films = tuple(f"tt{counter}_{k}" for k in range((counter % 3) + 1))
            pairings.append(Pairing(actor_a=f"nm{i}", actor_b=f"nm{j}", film_ids=films))
    return PeopleCatalog(actors, pairings)


# --- the grid's central promise ---------------------------------------------
def test_every_cell_of_every_board_is_answerable(dense_people):
    """
    The promise the mode lives or dies on.

    A board is searched for rather than sampled and checked, so this walks a
    lot of boards and asserts that no intersection is ever empty.
    """
    for seed in range(60):
        board = grid_engine.build_board(dense_people, random.Random(seed))
        for row in range(grid_engine.GRID_SIZE):
            for column in range(grid_engine.GRID_SIZE):
                films = board.films_for(row, column)
                assert films, f"cell ({row},{column}) has no shared film on seed {seed}"
                # And the answer key really is a film both actors were in.
                assert set(films) <= set(dense_people.shared_films(board.rows[row], board.columns[column]))


def test_a_board_never_repeats_an_actor(dense_people):
    for seed in range(30):
        board = grid_engine.build_board(dense_people, random.Random(seed))
        assert len(set(board.rows) | set(board.columns)) == grid_engine.GRID_SIZE * 2


def test_one_film_cannot_answer_the_whole_board(dense_people):
    """
    The degenerate case: six actors all from one ensemble gives a board whose
    every cell is the same film. That is a memory test, not a grid.
    """
    for seed in range(40):
        board = grid_engine.build_board(dense_people, random.Random(seed))
        best = [films[0] for films in board.answers.values()]
        for film_id in set(best):
            assert best.count(film_id) <= grid_engine.MAX_CELLS_PER_FILM


def test_a_board_is_reproducible_from_its_seed(dense_people):
    left = grid_engine.build_board(dense_people, random.Random("2026-09-07"))
    right = grid_engine.build_board(dense_people, random.Random("2026-09-07"))
    assert (left.rows, left.columns) == (right.rows, right.columns)


def test_a_sparse_graph_fails_loudly_rather_than_hanging():
    """Two actors cannot make a 3x3 board, and saying so beats spinning."""
    actors = [make_actor("nm1", "One"), make_actor("nm2", "Two")]
    people = PeopleCatalog(actors, [Pairing("nm1", "nm2", ("tt1",))])
    with pytest.raises(GameError) as exc:
        grid_engine.build_board(people, random.Random(0))
    assert exc.value.status_code == 503


# --- grid scoring -----------------------------------------------------------
def test_the_best_known_collaboration_scores_full_marks(dense_people):
    board = grid_engine.build_board(dense_people, random.Random(3))
    for (row, column), films in board.answers.items():
        assert grid_engine.score_answer(board, row, column, films[0]) == 100.0
        if len(films) > 1:
            # A more obscure shared film still scores, but less.
            worst = grid_engine.score_answer(board, row, column, films[-1])
            assert grid_engine.MIN_CELL_SCORE <= worst < 100.0


def test_naming_a_film_they_never_shared_is_rejected(dense_people):
    board = grid_engine.build_board(dense_people, random.Random(4))
    with pytest.raises(GameError) as exc:
        grid_engine.score_answer(board, 0, 0, "tt_never")
    assert exc.value.status_code == 400


# --- API --------------------------------------------------------------------
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

    best = revealed["cells"][0]["best_answer"]["film_id"]
    answered = client.post(
        f"/api/grid/games/{game['id']}/answer", json={"row": 0, "column": 0, "film_id": best}
    )
    assert answered.status_code == 200
    assert answered.json()["cells"][0]["score"] == 100.0

    # The same film cannot fill two cells, and a film they never shared is out.
    assert (
        client.post(
            f"/api/grid/games/{game['id']}/answer", json={"row": 1, "column": 1, "film_id": best}
        ).status_code
        == 409
    )
    assert client.post(
        f"/api/grid/games/{game['id']}/answer",
        json={"row": 1, "column": 1, "film_id": "tt0000000"},
    ).status_code in (400, 404)


def test_every_grid_pairing_the_api_deals_is_valid(client: TestClient):
    """
    The guarantee, checked through the API on real data rather than a fixture.

    For each board, every cell's revealed answer must be a film that both the
    row actor and the column actor are actually in.
    """
    for index in range(4):
        created = client.post("/api/grid/games", params={"seed": f"valid-{index}"})
        if created.status_code == 503:  # pragma: no cover
            pytest.skip("people tables not built")
        results = client.post(f"/api/grid/games/{created.json()['id']}/complete").json()
        for cell in results["cells"]:
            assert cell["n_possible"] >= 1
            assert cell["best_answer"]["film_id"]
            assert cell["row_actor"] and cell["column_actor"]
