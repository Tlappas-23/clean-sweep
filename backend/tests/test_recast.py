"""
Recast tests (``tests.test_recast``).

What matters here is that the shortlist is honest: drawn from the original
actor's casting type, never offering someone already cast, and scored so that
a part's *size* drives the fit rather than the original actor's stature.
"""

from __future__ import annotations

import random
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.data.people import Actor, Pairing, PeopleCatalog
from app.engine import recast as recast_engine
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


# --- recast -----------------------------------------------------------------
def test_a_shortlist_only_offers_the_original_casting_type():
    """
    The whole point of clustering the pool: everyone offered plausibly does
    this kind of work.
    """
    same = [make_actor(f"nm{i}", f"Same {i}", cluster=1) for i in range(30)]
    other = [make_actor(f"zz{i}", f"Other {i}", cluster=2) for i in range(30)]
    people = PeopleCatalog(same + other, [])
    original = same[0]
    role = recast_engine.Role(original.person_id, original.name, "Someone", billing=1)

    offered = recast_engine.shortlist(people, original, role, ("Drama",), set(), random.Random(0))
    assert offered, "a populated cluster must produce a shortlist"
    assert all(a.cluster_id == 1 for a in offered)
    assert original.person_id not in {a.person_id for a in offered}


def test_a_shortlist_never_offers_someone_already_cast():
    members = [make_actor(f"nm{i}", f"Actor {i}", cluster=1) for i in range(30)]
    people = PeopleCatalog(members, [])
    original, used = members[0], {members[1].person_id, members[2].person_id}
    role = recast_engine.Role(original.person_id, original.name, None, billing=1)

    offered = recast_engine.shortlist(people, original, role, ("Drama",), used, random.Random(1))
    assert not ({a.person_id for a in offered} & used)


def test_stature_and_role_size_drive_the_fit_score():
    """A lead part wants a lead-sized name; the score should say so."""
    star = make_actor("nm_star", "Star", fame=18.0, lead_share=0.9)
    bit_player = make_actor("nm_bit", "Bit", fame=11.0, lead_share=0.05)
    role = recast_engine.Role("nm_orig", "Original", "Hero", billing=1)
    original = make_actor("nm_orig", "Original", fame=18.0, lead_share=0.9)

    assert recast_engine.fit_score(star, original, role, ("Drama",)) > recast_engine.fit_score(
        bit_player, original, role, ("Drama",)
    )


def test_a_supporting_part_does_not_demand_a_leading_name():
    """Scored against the role, not the original, so the reverse holds too."""
    supporting_role = recast_engine.Role("nm_orig", "Original", "Friend", billing=6)
    original = make_actor("nm_orig", "Original", lead_share=0.2)
    character_actor = make_actor("nm_char", "Character", lead_share=0.3)
    leading_man = make_actor("nm_lead", "Leading", lead_share=0.95)

    assert recast_engine.fit_score(
        character_actor, original, supporting_role, ("Drama",)
    ) > recast_engine.fit_score(leading_man, original, supporting_role, ("Drama",))


def test_a_film_without_enough_profiled_roles_is_refused():
    """
    Role selection filters to actors who have a casting profile, and it is the
    single place that decides. The film chooser and the round itself both call
    it, so they cannot disagree about how many roles a film has - which they
    once did, leaving a round that believed it had five parts while the player
    was shown three.
    """

    class FakeCatalog:
        def __init__(self, roles):
            self._roles = roles

        def roles_in_film(self, film_id):
            return self._roles

    profiled = make_actor("nm_ok", "Profiled", cluster=1)
    unprofiled = make_actor("nm_no", "No cluster", cluster=None)
    people = PeopleCatalog([profiled, unprofiled], [])

    roles = [
        recast_engine.Role("nm_ok", "Profiled", None, billing=1),
        recast_engine.Role("nm_no", "No cluster", None, billing=2),
        recast_engine.Role("nm_missing", "Not in catalog", None, billing=3),
    ]
    with pytest.raises(GameError) as exc:
        recast_engine.playable_roles(FakeCatalog(roles), people, "tt1")
    assert exc.value.status_code == 422


# --- API --------------------------------------------------------------------
def test_a_recast_round_plays_through(client: TestClient):
    created = client.post("/api/recast/games", params={"seed": "test-recast"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game = created.json()
    assert len(game["roles"]) >= recast_engine.MIN_ROLES
    assert game["film"]["title"]

    while game["status"] != "complete":
        shortlist = client.get(f"/api/recast/games/{game['id']}/shortlist").json()
        assert shortlist, "a role must always have someone to cast"
        game = client.post(
            f"/api/recast/games/{game['id']}/cast", json={"person_id": shortlist[0]["person_id"]}
        ).json()

    results = client.get(f"/api/recast/games/{game['id']}/results").json()
    assert 0 <= results["score"] <= 100
    assert len(results["castings"]) == len(game["roles"])
    for casting in results["castings"]:
        assert set(casting["breakdown"]) == {"stature", "role_fit", "genre", "era"}
        assert casting["best_available"] is not None


def test_casting_someone_off_the_shortlist_is_refused(client: TestClient):
    created = client.post("/api/recast/games", params={"seed": "test-offlist"})
    if created.status_code == 503:  # pragma: no cover
        pytest.skip("people tables not built")
    game_id = created.json()["id"]
    refused = client.post(f"/api/recast/games/{game_id}/cast", json={"person_id": "nm_nobody"})
    assert refused.status_code == 400


# --- the acting line ---------------------------------------------------------
def test_a_shortlist_stays_on_the_role_s_academy_line(client: TestClient):
    """
    Recasting a man must not offer a list of actresses.

    The casting clusters are built from career shape alone (how much somebody
    works, how often they lead, which genres), and none of that is gendered,
    so without an explicit filter a shortlist for Vito Corleone comes back
    mixed. The question the mode asks is who *else* could have played this
    part, and an answer that ignores the part is not an answer.

    Checked over several rounds rather than one, because a single shortlist
    could be uniform by luck.
    """
    for seed in ("line-1", "line-2", "line-3"):
        created = client.post("/api/recast/games", params={"seed": seed})
        if created.status_code == 503:  # pragma: no cover - side tables not built
            pytest.skip("people tables not built")
        game = created.json()
        for _ in range(len(game["roles"])):
            state = client.get(f"/api/recast/games/{game['id']}").json()
            if state["status"] == "complete":
                break
            role = state["roles"][state["current_role"]]
            shortlist = client.get(f"/api/recast/games/{game['id']}/shortlist").json()
            assert shortlist, "a role with no shortlist is not playable"

            original_line = _line_of(role["original"]["person_id"])
            for candidate in shortlist:
                got = _line_of(candidate["person_id"])
                assert got == original_line, (
                    f"{candidate['name']} ({got}) offered for {role['original']['name']} ({original_line})"
                )
            client.post(
                f"/api/recast/games/{game['id']}/cast",
                json={"person_id": shortlist[0]["person_id"]},
            )


def _line_of(person_id: str) -> str | None:
    """The Academy line for a person, read from the built people catalog."""
    from app.core.config import Settings
    from app.data.people import PeopleCatalog

    global _PEOPLE
    try:
        people = _PEOPLE
    except NameError:
        people = _PEOPLE = PeopleCatalog.load(Settings().seed_dir)
    actor = people.get(person_id)
    return actor.academy_line if actor else None


def test_an_actor_with_no_line_is_offered_rather_than_dropped():
    """
    Missing data should widen a shortlist, not remove somebody from the game.

    Every actor on the committed roster resolves, so this is a guard against a
    future seed rather than a path anyone hits today. It is pinned because the
    failure would be invisible: an actor would simply stop appearing.
    """
    from app.engine.recast import same_line

    known = SimpleNamespace(academy_line="actor")
    other = SimpleNamespace(academy_line="actress")
    unknown = SimpleNamespace(academy_line=None)

    assert same_line(known, known) is True
    assert same_line(known, other) is False
    assert same_line(unknown, known) is True
    assert same_line(known, unknown) is True
