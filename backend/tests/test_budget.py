"""
Daily budget ledger tests (``tests.test_budget``).

This is the piece that keeps an unattended job inside a metered API's daily
allowance, so what is pinned down is the behaviour a scheduler depends on: a
second run the same day sees what the first spent, a killed run still leaves an
honest count, and the provider's own word outranks the local one.
"""

from __future__ import annotations

import json

import pytest

from pipeline.budget import Budget, today


@pytest.fixture
def ledger_path(tmp_path):
    return tmp_path / "usage.json"


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
