"""
Packed-seed tests (``tests.test_pack``).

The app serves from ``data/seed/*.json.gz`` while the pipeline works in
``data/seed/*.parquet``. Two copies of anything can drift, and a drift here
would be invisible: the app would start, serve, and quietly be a build behind.
So the contract is pinned from both ends.

* the packed table matches the parquet it came from, row for row;
* packing is deterministic, so a refresh that changed nothing commits nothing;
* every value survives JSON, including the ones that have no JSON literal.

These import pandas, which the *serving* app no longer may. That is the right
side of the line: pandas is a pipeline dependency, and this is a test of the
pipeline's output.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math

import pandas as pd
import pytest
from conftest import SEED_DIR  # noqa: E402 - pytest puts tests/ on the path

from app.data.seedfile import read_table
from pipeline.pack import MANIFEST, SERVED_TABLES, pack_frame, write_table

pytestmark = pytest.mark.skipif(
    not (SEED_DIR / "contenders.parquet").exists(),
    reason="seed parquet not built",
)


def _served() -> list[str]:
    return [name for name in SERVED_TABLES if (SEED_DIR / f"{name}.parquet").exists()]


def test_every_served_table_has_been_packed():
    """A parquet table the app reads with no packed twin is a broken deploy."""
    for name in _served():
        assert (SEED_DIR / f"{name}.json.gz").exists(), (
            f"{name}.parquet has no packed copy; run `python -m pipeline.pack`"
        )


def test_the_packed_copy_has_the_same_rows_as_the_parquet():
    for name in _served():
        frame = pd.read_parquet(SEED_DIR / f"{name}.parquet")
        table = read_table(SEED_DIR, name)
        assert table is not None
        assert len(table) == len(frame), f"{name}: {len(table)} packed vs {len(frame)} parquet"
        assert set(table.columns) == set(frame.columns), f"{name}: columns differ"


def test_the_packed_values_match_cell_for_cell():
    """
    Spot-checked rather than exhaustive: 50k rows times 22 columns is a
    million comparisons, and a packing bug is systematic, not one cell deep.
    The first and last rows plus a stride through the middle catch it.
    """
    for name in _served():
        frame = pd.read_parquet(SEED_DIR / f"{name}.parquet")
        table = read_table(SEED_DIR, name)
        assert table is not None
        stride = max(1, len(frame) // 200)
        indices = sorted({0, len(frame) - 1, *range(0, len(frame), stride)})

        for column in frame.columns:
            packed = table.column(column)
            source = frame[column]
            for i in indices:
                want, got = source.iloc[i], packed[i]
                # A numpy *scalar* also has .tolist(), so sequence-ness is
                # tested by ndim, exactly as pipeline.pack tests it.
                if isinstance(want, (list, tuple)) or getattr(want, "ndim", 0):
                    assert list(want) == list(got or []), f"{name}.{column}[{i}]"
                elif pd.isna(want):
                    assert got is None, f"{name}.{column}[{i}]: {want!r} packed as {got!r}"
                elif isinstance(want, float):
                    assert got is not None and math.isclose(float(want), got, rel_tol=1e-9), (
                        f"{name}.{column}[{i}]"
                    )
                else:
                    assert got == want.item() if hasattr(want, "item") else got == want, (
                        f"{name}.{column}[{i}]"
                    )


def test_packing_is_byte_for_byte_repeatable(tmp_path):
    """
    Otherwise the daily refresh commits a diff every day whether or not the
    data moved, and the git history stops meaning anything.

    Byte equality is the right assertion *here*, within one process: it is
    what proves the gzip header carries no timestamp. It is the wrong
    assertion across machines, which is what the next test is about.
    """
    frame = pd.read_parquet(SEED_DIR / "actors.parquet")
    first = write_table("actors", frame, tmp_path)
    blob_a = (tmp_path / "actors.json.gz").read_bytes()
    second = write_table("actors", frame, tmp_path)
    blob_b = (tmp_path / "actors.json.gz").read_bytes()

    assert blob_a == blob_b
    assert first == second


def test_the_committed_pack_is_current(tmp_path):
    """
    Repacking the parquet has to reproduce what is committed.

    This is the test that actually catches drift: a rescore that rewrote the
    parquet without repacking fails here rather than in production.

    Compared on the *content*, not the compressed bytes. zlib does not promise
    identical output across versions, so a byte comparison passes on the
    machine that packed the file and fails on any other, which says nothing
    about whether the data is stale. The manifest digest is taken over the
    uncompressed payload for exactly this reason: it describes the data rather
    than the compressor.
    """
    manifest = json.loads((SEED_DIR / MANIFEST).read_text())
    for name in _served():
        frame = pd.read_parquet(SEED_DIR / f"{name}.parquet")
        entry = write_table(name, frame, tmp_path)
        recorded = manifest["tables"].get(name)

        assert recorded is not None, f"{name} is packed but missing from {MANIFEST}"
        assert entry["sha256"] == recorded["sha256"], (
            f"{name}.json.gz is stale against {name}.parquet; run `python -m pipeline.pack`"
        )
        assert entry["rows"] == recorded["rows"]

        # And the file on disk really holds what the manifest claims, so a
        # correct manifest beside a stale table cannot pass.
        with gzip.open(SEED_DIR / f"{name}.json.gz", "rb") as handle:
            on_disk = handle.read()
        assert hashlib.sha256(on_disk).hexdigest() == recorded["sha256"], (
            f"{name}.json.gz does not match its own manifest entry"
        )


def test_values_json_has_no_literal_for_become_null():
    """
    NaN, NaT and pandas NA all have to leave as ``null``.

    Python's json encoder would happily write a bare ``NaN`` token, which is
    not valid JSON: every strict reader rejects it, and the app's own loader
    would hand a float NaN to a field typed ``float | None``. Pinned here
    because the failure is silent until something divides by it.
    """
    frame = pd.DataFrame(
        {
            "f": [1.5, float("nan"), None],
            "i": pd.array([1, None, 3], dtype="Int64"),
            "s": ["a", None, "c"],
            "t": [pd.Timestamp("2026-01-01"), pd.NaT, pd.Timestamp("2026-01-02")],
            "b": pd.array([True, None, False], dtype="boolean"),
        }
    )
    packed = pack_frame(frame)
    assert packed["f"] == [1.5, None, None]
    assert packed["i"] == [1, None, 3]
    assert packed["s"] == ["a", None, "c"]
    assert packed["b"] == [True, None, False]
    assert packed["t"][1] is None

    # And the whole thing survives a strict round trip.
    text = json.dumps(packed, allow_nan=False)
    assert json.loads(text) == packed


def test_a_missing_column_reads_as_null_rather_than_failing(tmp_path):
    """
    A seed built before a column existed should still boot.

    A checkout that is one pipeline version behind is a normal state, and
    refusing to start over one absent metric is a worse answer than running
    with it null, which every scorer already handles.
    """
    (tmp_path / "toy.json.gz").write_bytes(gzip.compress(json.dumps({"a": [1, 2, 3]}).encode(), mtime=0))
    table = read_table(tmp_path, "toy")
    assert table is not None
    assert table.column("a") == [1, 2, 3]
    assert table.column("not_there") == [None, None, None]
    assert list(table.rows("a", "not_there")) == [(1, None), (2, None), (3, None)]


def test_an_absent_table_is_none_rather_than_an_error(tmp_path):
    """``ml_scores`` and the people tables are legitimately optional."""
    assert read_table(tmp_path, "never_written") is None
