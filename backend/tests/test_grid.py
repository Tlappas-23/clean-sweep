"""
Six Degrees tests (``tests.test_grid``).

The engine tests use a hand-built people catalog small enough to reason about;
the API tests run against the real one. The properties that get the most
attention are the mode's two central promises: that no cell can be
unanswerable, and that the two actors heading a cell never worked together.
Those are what a player would notice immediately, and what a naive
implementation gets wrong.
"""

from __future__ import annotations

import itertools
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
    A cast shaped like the puzzle, in three tiers.

    A fully-connected fixture would be useless here. The mode needs header
    actors who have *not* worked together, so a graph where everyone shares a
    film contains no legal board at all. This one is bipartite: a dozen
    **faces** who never appear with each other and are the only people well
    connected enough to head a row or a column, and two tiers of working actor
    who bridge them.

    **Generalists** each work with four of the faces and are the well-known
    end of every cell's ranking: the obvious answer, worth the floor.

    **Specialists** did exactly one film with each of exactly two faces, one
    per pair, and are the least-known person in that pair's intersection. They
    exist to make the fixture exercise the rule that matters most: because a
    pair's specialist is unique to that pair, every cell's *rarest* link is a
    different person, which is what a perfect board requires. Their two
    credits also keep them below ``MIN_DEGREE``, so they can never be dealt as
    a header. They are answers, never questions.
    """
    rng = random.Random(11)
    faces = [make_actor(f"nf{i}", f"Face {i}", fame=20.0 - i * 0.1) for i in range(12)]
    pairings: list[Pairing] = []
    others: list[Actor] = []

    for k in range(40):
        generalist = make_actor(f"ng{k}", f"Generalist {k}", fame=15.0 + k * 0.02)
        others.append(generalist)
        for face in rng.sample(faces, 4):
            pairings.append(
                Pairing(
                    actor_a=face.person_id,
                    actor_b=generalist.person_id,
                    # A second shared film for some pairs, so "the film they
                    # are best known for together" is a real choice.
                    film_ids=tuple(f"ttg{k}_{face.person_id}_{n}" for n in range((k % 2) + 1)),
                )
            )

    for n, (left, right) in enumerate(itertools.combinations(faces, 2)):
        specialist = make_actor(f"ns{n}", f"Specialist {n}", fame=10.0 + n * 0.001)
        others.append(specialist)
        for face in (left, right):
            pairings.append(
                Pairing(
                    actor_a=face.person_id,
                    actor_b=specialist.person_id,
                    film_ids=(f"tts{n}_{face.person_id}",),
                )
            )

    return PeopleCatalog(faces + others, pairings)


def _board(people, seed):
    return grid_engine.build_board(people, random.Random(seed))


# --- the mode's central promises --------------------------------------------
def test_every_cell_of_every_board_has_enough_connectors(linked_people):
    """
    The promise the mode lives or dies on.

    A board is searched for rather than sampled and checked, so this walks a
    lot of boards and asserts that every intersection has connectors to spare,
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
    The degenerate case, at both ends of the ranking.

    One name topping every cell makes the board a single question asked nine
    times; one name bottoming every cell makes the *reveal* read that way.
    """
    for seed in range(40):
        answers = _board(linked_people, seed).answers.values()
        for end in (0, -1):
            picked = [found[end] for found in answers]
            for person_id in set(picked):
                assert picked.count(person_id) <= grid_engine.MAX_CELLS_PER_CONNECTOR


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
def test_a_repeated_rarest_answer_is_reported_as_such():
    """Nine cells whose rarest link is the same person cannot all score 100."""
    starved = {(r, c): ("nj0", "shared") for r in range(3) for c in range(3)}
    assert grid_engine.rarest_are_distinct(starved) is False
    assert grid_engine.rarest_are_distinct({(0, 0): ("a", "x"), (0, 1): ("b", "y")}) is True


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


def test_a_link_names_a_film_on_each_side_of_it(linked_people):
    """
    A connector's name alone is an assertion; the two films are the proof.

    One film must be shared with the row actor and the other with the column
    actor, in that order, which is what makes the link checkable.
    """
    board = _board(linked_people, 5)
    for (row, column), found in board.answers.items():
        row_actor, column_actor = board.rows[row], board.columns[column]
        left_film, right_film = grid_engine.link_films(linked_people, found[0], row_actor, column_actor)
        assert left_film in linked_people.shared_films(found[0], row_actor)
        assert right_film in linked_people.shared_films(found[0], column_actor)


# --- scoring ----------------------------------------------------------------
def test_the_rarest_connector_scores_full_marks(linked_people):
    """
    The scale runs against fame: the obvious route pays the floor.

    Everyone who can name the pair can find the best-known link, so paying the
    same for it as for a deep cut would make the scale say nothing.
    """
    board = _board(linked_people, 3)
    for (row, column), found in board.answers.items():
        # Connectors are ordered best-known first, so the last is the rarest.
        assert grid_engine.score_answer(board, row, column, found[-1]) == 100.0
        obvious = grid_engine.score_answer(board, row, column, found[0])
        assert obvious == grid_engine.MIN_CELL_SCORE
        assert obvious < 100.0


def test_scores_rise_monotonically_down_the_connector_list(linked_people):
    board = _board(linked_people, 8)
    found = board.connectors_for(0, 0)
    scores = [grid_engine.score_answer(board, 0, 0, person) for person in found]
    assert scores == sorted(scores)
    assert scores[0] == grid_engine.MIN_CELL_SCORE and scores[-1] == 100.0


def test_a_cell_with_one_connector_scores_it_full(linked_people):
    """The only route through is also the rarest; there was nothing better."""
    board = grid_engine.Board(rows=("a",), columns=("b",), answers={(0, 0): ("solo",)})
    assert grid_engine.score_answer(board, 0, 0, "solo") == 100.0


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
    # A generalist works with several faces, so they bridge more than one pair;
    # a specialist bridges exactly one and never could. Find any two cells one
    # person answers rather than assuming which two they are.
    first, second, reused = next(
        (a, b, person)
        for a, b in itertools.combinations(sorted(board.answers), 2)
        for person in board.connectors_for(*a)
        if person in board.connectors_for(*b)
    )
    round_.answer(linked_people, *first, reused)
    with pytest.raises(GameError) as exc:
        round_.answer(linked_people, *second, reused)
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


def test_a_perfect_board_is_always_reachable(linked_people):
    """
    Answerable cell by cell is not the same as finishable, let alone perfect.

    A connector may only be played once, so if the same actor were the rarest
    link for two cells, one of them could never score 100 and a perfect board
    would be locked away through no fault of the player. Requiring the nine
    rarest to differ settles both: it is a complete fill *and* a 900.
    """
    for seed in range(40):
        board = _board(linked_people, seed)
        assert grid_engine.rarest_are_distinct(board.answers), f"collision on seed {seed}"
        rarest = [ranked[-1] for ranked in board.answers.values()]
        assert len(set(rarest)) == 9
        # And each one really is a connector for the cell it would fill.
        for cell, ranked in board.answers.items():
            assert ranked[-1] in board.answers[cell]


def test_a_perfect_board_is_every_cell_answered_with_its_rarest_connector(linked_people):
    round_ = _round()
    board = round_.board(linked_people)
    # Play the rarest link in every cell. The generator guarantees those nine
    # are nine different people, so this is both legal and a perfect 900.
    for (row, column), ranked in board.answers.items():
        round_.answer(linked_people, row, column, ranked[-1])

    scored = grid_engine.outcome(round_, linked_people)
    assert scored.filled == scored.total == 9
    assert scored.score == grid_engine.total_score(round_.answers)
    assert scored.perfect == all(cell.found_rarest for cell in scored.cells)
    assert round_.is_over(), "a full board ends the round without handing it in"
    for cell in scored.cells:
        ranked = board.connectors_for(cell.row, cell.column)
        # Both ends of the range are revealed, each proved by two films.
        assert cell.obvious.person_id == ranked[0]
        assert cell.rarest.person_id == ranked[-1]
        assert cell.rarest.score == 100.0
        assert cell.obvious.score <= cell.rarest.score
        for link in (cell.obvious, cell.rarest, cell.played):
            assert link is not None and len(link.films) == 2


def test_an_empty_board_scores_nothing_and_still_reveals(linked_people):
    scored = grid_engine.outcome(_round(), linked_people)
    assert (scored.filled, scored.score, scored.perfect) == (0, 0.0, False)
    assert len(scored.cells) == 9
    assert all(cell.played is None and cell.obvious and cell.rarest for cell in scored.cells)


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

    rarest = revealed["cells"][0]["rarest"]
    answered = client.post(
        f"/api/grid/games/{game['id']}/answer",
        json={"row": 0, "column": 0, "name": rarest["actor"]["name"]},
    )
    assert answered.status_code == 200
    played = answered.json()["cells"][0]["link"]
    # The rarest link is worth full marks, and the answer carries its own
    # proof the moment it lands rather than waiting for the reveal.
    assert played["score"] == 100.0
    assert played["actor"]["person_id"] == rarest["actor"]["person_id"]
    assert len(played["films"]) == 2
    assert all(f["film_id"] and f["title"] for f in played["films"])

    # The same actor cannot fill two cells, and a name nobody has is out.
    assert (
        client.post(
            f"/api/grid/games/{game['id']}/answer",
            json={"row": 1, "column": 1, "name": rarest["actor"]["name"]},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/grid/games/{game['id']}/answer",
            json={"row": 1, "column": 1, "name": "Zxqv Nonsuch"},
        ).status_code
        == 400
    )


def test_a_typed_name_is_forgiven_its_spelling(client: TestClient):
    """
    There is no autocomplete in this mode, so the typing has to be forgiven.

    A dropdown of matching actors would hand over the answer, because the
    names worth suggesting are exactly the cell's connectors. The player types
    the whole name instead, and the server absorbs the ways a name gets typed
    from memory: case, punctuation, accents, a dropped middle initial, a slip.
    """
    created = client.post("/api/grid/games", params={"seed": "resolve-grid"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game_id = created.json()["id"]

    def resolve(name: str) -> tuple[int, str]:
        """Answer cell (0,0) and report the status plus whoever was read."""
        response = client.post(
            f"/api/grid/games/{game_id}/answer", json={"row": 0, "column": 0, "name": name}
        )
        if response.status_code != 200:
            return response.status_code, response.json()["detail"]
        return 200, response.json()["cells"][0]["actor"]["name"]

    # A name nobody has, and a name too many people share, fail differently:
    # one asks the player to check the spelling, the other to be specific.
    status, detail = resolve("Zxqv Nonsuch")
    assert status == 400 and "no actor" in detail

    # The spelling itself is forgiven, checked through the answer endpoint
    # because that is the only way a player ever reaches the resolver.
    status, detail = resolve("tom hanks")
    # Hanks may or may not connect this board's first pair; either way the
    # name resolved, so the refusal is about the connection, not the spelling.
    assert status in (200, 400)
    assert "no actor" not in str(detail)


def test_the_resolver_forgives_the_ways_a_name_gets_typed(client: TestClient):
    """The resolver itself, against the real roster."""
    from app.data.people import PeopleCatalog
    from tests.conftest import SEED_DIR

    people = PeopleCatalog.load(SEED_DIR)
    if not people.is_available:  # pragma: no cover
        pytest.skip("people tables not built")

    def resolved(name: str) -> str | None:
        actor = people.resolve_actor(name).actor
        return actor.name if actor else None

    # Exact, then the four kinds of near-miss the mode has to absorb.
    assert resolved("Samuel L. Jackson") == "Samuel L. Jackson"
    assert resolved("samuel l jackson") == "Samuel L. Jackson"  # punctuation
    assert resolved("SAMUEL JACKSON") == "Samuel L. Jackson"  # dropped initial
    assert resolved("leonardo dicapro") == "Leonardo DiCaprio"  # misspelt
    assert resolved("Meryl Strep") == "Meryl Streep"  # one letter short

    # A name that is genuinely somebody else's is not "corrected" into a
    # neighbour: this is the failure that would silently score a wrong answer.
    assert resolved("Chris Pine") == "Chris Pine"

    # Nobody, and too many, both come back empty, but they say which.
    assert people.resolve_actor("Zxqv Nonsuch").actor is None
    assert people.resolve_actor("Zxqv Nonsuch").ambiguous is False
    ambiguous = people.resolve_actor("jackson")
    assert ambiguous.actor is None and ambiguous.ambiguous is True


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

        rarest_names = set()
        for cell in results["cells"]:
            assert cell["n_possible"] >= grid_engine.MIN_CONNECTORS
            assert cell["row_actor"] and cell["column_actor"]
            # Both ends of the range are revealed, each proved by two films.
            for link in (cell["obvious"], cell["rarest"]):
                assert link["actor"]["person_id"] and link["actor"]["name"]
                # A connector is a third party, not one of the six on the board.
                assert link["actor"]["name"] not in names
                assert len(link["films"]) == 2
                assert all(f["film_id"] and f["title"] for f in link["films"])
            # The rarest is worth full marks and the obvious one the floor.
            assert cell["rarest"]["score"] == 100.0
            assert cell["obvious"]["score"] == grid_engine.MIN_CELL_SCORE
            rarest_names.add(cell["rarest"]["actor"]["person_id"])

        # Nine different rarest links, which is what makes 900 reachable.
        assert len(rarest_names) == 9


# --- hints -------------------------------------------------------------------
def test_a_hint_opens_the_obvious_route_not_the_rare_one(linked_people):
    """
    What a hint is allowed to give away.

    A cell's rarest connector is worth 100 and is the thing the scoring exists
    to reward. Handing that over for a fixed price would not be a hint, it
    would be the answer. So a hint is drawn from the *best-known* connector,
    the one already worth the fewest points.
    """
    round_ = _round()
    board = round_.board(linked_people)
    ranked = board.connectors_for(0, 0)
    obvious, rarest = ranked[0], ranked[-1]

    film = round_.take_hint(linked_people, 0, 0, "row")
    assert film in linked_people.shared_films(obvious, board.rows[0])
    assert film not in linked_people.shared_films(rarest, board.rows[0]) or obvious == rarest


def test_each_side_of_a_cell_has_its_own_hint(linked_people):
    round_ = _round()
    board = round_.board(linked_people)
    row_film = round_.take_hint(linked_people, 0, 0, "row")
    column_film = round_.take_hint(linked_people, 0, 0, "column")

    obvious = board.connectors_for(0, 0)[0]
    assert row_film in linked_people.shared_films(obvious, board.rows[0])
    assert column_film in linked_people.shared_films(obvious, board.columns[0])
    assert round_.hints_at(0, 0) == ["row", "column"]


def test_hints_cost_the_cell_and_the_second_costs_more(linked_people):
    """One hint is a trade; two is close to giving the cell up."""
    assert grid_engine.hint_penalty(0) == 0.0
    assert 0 < grid_engine.hint_penalty(1) < grid_engine.hint_penalty(2)

    round_ = _round()
    ranked = round_.board(linked_people).connectors_for(0, 0)
    round_.take_hint(linked_people, 0, 0, "row")
    scored = round_.answer(linked_people, 0, 0, ranked[-1])
    assert scored == pytest.approx(100.0 - grid_engine.hint_penalty(1))


def test_a_hinted_cell_still_beats_an_empty_one(linked_people):
    """
    The floor. Two hints plus the obvious answer is a poor cell, not a
    negative one: a player who worked it out with help is ahead of a player
    who left it blank.
    """
    round_ = _round()
    ranked = round_.board(linked_people).connectors_for(0, 0)
    round_.take_hint(linked_people, 0, 0, "row")
    round_.take_hint(linked_people, 0, 0, "column")
    scored = round_.answer(linked_people, 0, 0, ranked[0])
    assert scored > 0.0
    assert scored == pytest.approx(max(0.0, grid_engine.MIN_CELL_SCORE - grid_engine.hint_penalty(2)))


def test_asking_twice_for_the_same_hint_is_free(linked_people):
    """Charging twice for one film would be a bug the player pays for."""
    round_ = _round()
    first = round_.take_hint(linked_people, 0, 0, "row")
    second = round_.take_hint(linked_people, 0, 0, "row")
    assert first == second
    assert round_.hints_at(0, 0) == ["row"]


def test_an_answered_cell_takes_no_more_hints(linked_people):
    round_ = _round()
    ranked = round_.board(linked_people).connectors_for(0, 0)
    round_.answer(linked_people, 0, 0, ranked[0])
    with pytest.raises(GameError) as exc:
        round_.take_hint(linked_people, 0, 0, "row")
    assert exc.value.status_code == 409


def test_a_hint_is_refused_off_the_board_and_on_a_bad_side(linked_people):
    round_ = _round()
    with pytest.raises(GameError) as exc:
        round_.take_hint(linked_people, 3, 0, "row")
    assert exc.value.status_code == 400
    with pytest.raises(GameError) as exc:
        round_.take_hint(linked_people, 0, 0, "diagonal")
    assert exc.value.status_code == 400


def test_the_hint_route_charges_the_cell(client: TestClient):
    """The whole loop through the API on real data."""
    created = client.post("/api/grid/games", params={"seed": "hint-grid"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game_id = created.json()["id"]

    hinted = client.post(f"/api/grid/games/{game_id}/hint", json={"row": 0, "column": 0, "side": "row"})
    assert hinted.status_code == 200
    cell = hinted.json()["cells"][0]
    assert len(cell["hints"]) == 1
    assert cell["hints"][0]["side"] == "row"
    assert cell["hints"][0]["film"]["title"]
    # The hint names the actor it links to, so the film has context on screen.
    assert cell["hints"][0]["actor"] == hinted.json()["rows"][0]["name"]
    assert cell["hint_penalty"] == grid_engine.hint_penalty(1)

    # Answering now pays for it.
    twin = client.post("/api/grid/games", params={"seed": "hint-grid"}).json()
    revealed = client.post(f"/api/grid/games/{twin['id']}/complete").json()
    rarest = revealed["cells"][0]["rarest"]
    answered = client.post(
        f"/api/grid/games/{game_id}/answer",
        json={"row": 0, "column": 0, "name": rarest["actor"]["name"]},
    )
    assert answered.status_code == 200
    assert answered.json()["cells"][0]["link"]["score"] == 100.0 - grid_engine.hint_penalty(1)
