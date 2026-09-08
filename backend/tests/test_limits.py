"""
Rate limit, header and caching tests (``tests.test_limits``).

Everything here is anonymous, so the limiter in ``app.core.limits`` is the
only thing between the database and a script. That makes it worth testing on
its own terms rather than trusting that it is wired up.

Three claims are pinned:

* the limiter actually refuses, and says how long to wait;
* real play never reaches the ceiling, which is the failure that would matter
  far more than a missed abuse case;
* a live game is never cacheable, and reference data is.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core import limits
from app.core.limits import RateLimiter, client_key, limiter


# --- the limiter itself ------------------------------------------------------
def test_it_allows_up_to_the_limit_and_then_refuses():
    rl = RateLimiter()
    for i in range(5):
        allowed, remaining, retry = rl.check("caller", "b", limit=5, window=60)
        assert allowed, f"request {i + 1} of 5 should be allowed"
        assert remaining == 4 - i
        assert retry == 0

    allowed, remaining, retry = rl.check("caller", "b", limit=5, window=60)
    assert not allowed
    assert remaining == 0
    # A refusal that does not say when to come back just invites a retry loop.
    assert retry > 0


def test_callers_are_counted_separately():
    """Otherwise one busy client locks out everyone behind the same proxy."""
    rl = RateLimiter()
    for _ in range(5):
        rl.check("noisy", "b", limit=5, window=60)
    assert rl.check("noisy", "b", limit=5, window=60)[0] is False
    assert rl.check("quiet", "b", limit=5, window=60)[0] is True


def test_the_three_allowances_do_not_share_a_budget():
    """Reading a lot must not use up the ability to make a move."""
    rl = RateLimiter()
    for _ in range(5):
        rl.check("caller", "read", limit=5, window=60)
    assert rl.check("caller", "read", limit=5, window=60)[0] is False
    assert rl.check("caller", "write", limit=5, window=60)[0] is True


def test_the_window_expires():
    rl = RateLimiter()
    for _ in range(2):
        rl.check("caller", "b", limit=2, window=0.05)
    assert rl.check("caller", "b", limit=2, window=0.05)[0] is False
    time.sleep(0.06)
    assert rl.check("caller", "b", limit=2, window=0.05)[0] is True


def test_the_bucket_table_cannot_grow_without_bound(monkeypatch):
    """
    A flood from many addresses would otherwise fill memory, which is the same
    denial of service by a different route. Shedding entries only ever *grants*
    an allowance, so the failure mode is a lenient limiter, not a locked door.
    """
    monkeypatch.setattr(limits, "MAX_TRACKED", 50)
    rl = RateLimiter()
    for i in range(500):
        rl.check(f"caller-{i}", "b", limit=5, window=60)
    assert rl.snapshot()["tracked"] <= 100, "the limiter is holding every caller it ever saw"


def test_the_caller_is_read_from_the_forwarded_header():
    """
    Behind a managed host the socket address is the platform's proxy, so
    limiting on it would put every visitor in one bucket.
    """
    assert client_key("203.0.113.9, 70.41.3.18", "10.0.0.1") == "203.0.113.9"
    assert client_key(None, "10.0.0.1") == "10.0.0.1"
    assert client_key("", "10.0.0.1") == "10.0.0.1"
    assert client_key(None, None) == "unknown"


# --- wired into the app ------------------------------------------------------
def test_a_flood_is_refused_with_a_retry_after(client: TestClient):
    limiter.reset()
    last = None
    for _ in range(limits.CREATE_LIMIT + 5):
        last = client.post("/api/chain/games")
        if last.status_code == 429:
            break

    assert last is not None and last.status_code == 429, "creating games is not limited"
    assert last.headers["Retry-After"].isdigit()
    assert "Too many requests" in last.json()["detail"]
    limiter.reset()


def test_a_whole_round_of_real_play_never_hits_the_ceiling(client: TestClient):
    """
    The limit that matters most is the one a *player* could reach, because
    that failure is invisible in testing and infuriating in use.

    A fast Six Degrees round is nine answers plus a few hints inside three
    minutes. This plays one at machine speed and expects every request through.
    """
    limiter.reset()
    created = client.post("/api/grid/games", params={"seed": "limits"})
    assert created.status_code == 201
    game_id = created.json()["id"]

    for row in range(3):
        for column in range(3):
            for side in ("row", "column"):
                assert (
                    client.post(
                        f"/api/grid/games/{game_id}/hint",
                        json={"row": row, "column": column, "side": side},
                    ).status_code
                    != 429
                ), "buying every hint on a board is normal play, not abuse"
            assert (
                client.post(
                    f"/api/grid/games/{game_id}/answer",
                    json={"row": row, "column": column, "name": "Nobody At All"},
                ).status_code
                != 429
            )
    assert client.post(f"/api/grid/games/{game_id}/complete").status_code != 429
    limiter.reset()


def test_the_health_probe_is_never_limited(client: TestClient):
    """Limiting the check that decides whether to restart the service is how a
    service gets restarted."""
    limiter.reset()
    for _ in range(limits.READ_LIMIT + 20):
        assert client.get("/health").status_code == 200
    limiter.reset()


# --- headers and caching -----------------------------------------------------
def test_a_live_game_is_never_cacheable(client: TestClient):
    """A cached board is a wrong board."""
    created = client.post("/api/chain/games", params={"seed": "cache"})
    assert created.headers["Cache-Control"] == "no-store"
    game = client.get(f"/api/chain/games/{created.json()['id']}")
    assert game.headers["Cache-Control"] == "no-store"


def test_reference_data_is_cacheable(client: TestClient):
    """
    The seed only changes when the pipeline runs, so a phone should not fetch
    it twice. This is most of what makes the second visit feel instant.
    """
    for path in ("/api/meta", "/api/modes", "/api/catalog/years/1994"):
        header = client.get(path).headers["Cache-Control"]
        assert "public" in header and "max-age=" in header, f"{path} is not cacheable"
        assert "stale-while-revalidate" in header, f"{path} cannot serve stale while it wakes"


def test_the_security_headers_are_present(client: TestClient):
    headers = client.get("/api/modes").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in headers["Permissions-Policy"]


def test_the_remaining_allowance_is_reported(client: TestClient):
    """A limit nobody can see from outside is a limit nobody can debug."""
    limiter.reset()
    headers = client.get("/api/modes").headers
    assert int(headers["X-RateLimit-Limit"]) == limits.READ_LIMIT
    assert int(headers["X-RateLimit-Remaining"]) < limits.READ_LIMIT
