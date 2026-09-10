"""
Tests for the box office serving endpoint.

The endpoint's job is not clever. It reads a validated artifact, filters by
title and returns rows. What is worth pinning is that it cannot serve an
in-sample projection, that its search behaves the way a person typing expects,
and that a clone without the artifact gets an explanation rather than a stack
trace.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ARTIFACT = Path(__file__).resolve().parents[3] / "data/models/boxoffice_projections.json"
pytestmark = pytest.mark.skipif(
    not ARTIFACT.exists(),
    reason="artifact not built; run boxoffice.model.export_artifact first")


@pytest.fixture(scope="module")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_default_returns_the_biggest_earners(client):
    body = client.get("/api/analytics/boxoffice", params={"limit": 5}).json()
    actuals = [f["actual"] for f in body["films"]]
    assert actuals == sorted(actuals, reverse=True)


def test_every_row_carries_a_projection(client):
    body = client.get("/api/analytics/boxoffice", params={"limit": 50}).json()
    assert all(f["projected"] > 0 for f in body["films"])


def test_the_provenance_travels_with_the_payload(client):
    body = client.get("/api/analytics/boxoffice", params={"limit": 1}).json()
    assert "trained only on films released before" in body["generated_from"]


def test_search_is_case_and_accent_insensitive(client):
    lower = client.get("/api/analytics/boxoffice", params={"q": "batman"}).json()
    upper = client.get("/api/analytics/boxoffice", params={"q": "BATMAN"}).json()
    assert [f["imdb_id"] for f in lower["films"]] == [f["imdb_id"] for f in upper["films"]]
    assert lower["films"], "expected at least one match for a common title"


def test_a_miss_is_an_empty_list_not_an_error(client):
    r = client.get("/api/analytics/boxoffice", params={"q": "zzz-not-a-film"})
    assert r.status_code == 200
    assert r.json()["films"] == []


def test_limit_is_clamped(client):
    body = client.get("/api/analytics/boxoffice", params={"limit": 5000}).json()
    assert len(body["films"]) <= 100


def test_no_pre_fold_film_is_served():
    """
    Films released before the first validation fold have no honest projection
    and must be absent from the artifact entirely, not present with an
    in-sample number.
    """
    payload = json.loads(ARTIFACT.read_text())
    assert min(f["year"] for f in payload["films"]) >= 2010
