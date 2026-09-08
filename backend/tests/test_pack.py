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
from collections.abc import Iterator

import pandas as pd
import pytest
from conftest import SEED_DIR  # noqa: E402 - pytest puts tests/ on the path

from app.data import seedfile
from pipeline.pack import MANIFEST, SERVED_TABLES, SUFFIX, pack_frame, write_table

pytestmark = pytest.mark.skipif(
    not (SEED_DIR / "contenders.parquet").exists(),
    reason="seed parquet not built",
)


def _served() -> list[str]:
    return [name for name in SERVED_TABLES if (SEED_DIR / f"{name}.parquet").exists()]


def test_every_served_table_has_been_packed():
    """A parquet table the app reads with no packed twin is a broken deploy."""
    for name in _served():
        assert seedfile.exists(SEED_DIR, name), (
            f"{name}.parquet has no packed copy; run `python -m pipeline.pack`"
        )


def test_the_packed_copy_has_the_same_rows_as_the_parquet():
    for name in _served():
        frame = pd.read_parquet(SEED_DIR / f"{name}.parquet")
        assert seedfile.count(SEED_DIR, name) == len(frame), f"{name}: row count differs"
        # Every parquet column has to be readable back by name.
        first = next(seedfile.rows(SEED_DIR, name, *[str(c) for c in frame.columns]))
        assert len(first) == len(frame.columns)


def test_the_packed_values_match_cell_for_cell():
    """
    Spot-checked rather than exhaustive: 50k rows times 22 columns is a
    million comparisons, and a packing bug is systematic, not one cell deep.
    The first and last rows plus a stride through the middle catch it.
    """
    for name in _served():
        frame = pd.read_parquet(SEED_DIR / f"{name}.parquet")
        columns = [str(c) for c in frame.columns]
        stride = max(1, len(frame) // 200)
        indices = sorted({0, len(frame) - 1, *range(0, len(frame), stride)})
        wanted = set(indices)
        packed_rows = {i: row for i, row in enumerate(seedfile.rows(SEED_DIR, name, *columns)) if i in wanted}

        for position, column in enumerate(columns):
            source = frame[column]
            for i in indices:
                want, got = source.iloc[i], packed_rows[i][position]
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
    blob_a = (tmp_path / f"actors{SUFFIX}").read_bytes()
    second = write_table("actors", frame, tmp_path)
    blob_b = (tmp_path / f"actors{SUFFIX}").read_bytes()

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
            f"{name}{SUFFIX} is stale against {name}.parquet; run `python -m pipeline.pack`"
        )
        assert entry["rows"] == recorded["rows"]

        # And the file on disk really holds what the manifest claims, so a
        # correct manifest beside a stale table cannot pass.
        with gzip.open(SEED_DIR / f"{name}{SUFFIX}", "rb") as handle:
            on_disk = handle.read()
        assert hashlib.sha256(on_disk).hexdigest() == recorded["sha256"], (
            f"{name}{SUFFIX} does not match its own manifest entry"
        )


def test_the_row_stream_holds_one_row_at_a_time():
    """
    The property the whole format exists for.

    A columnar file has to be parsed whole, which for the contenders table
    meant 1.1 million objects alive before a single record was built: 84 MB
    that glibc never gave back, and 402 MB of peak RSS on a 512 MB instance.
    Streaming is what fixed it, so "it is a generator" is a contract rather
    than an implementation detail.
    """
    stream = seedfile.rows(SEED_DIR, "contenders", "contender_id")
    assert isinstance(stream, Iterator), "the reader must not materialise the table"
    # Taking one row must not require reading the rest.
    assert next(stream)[0]
    stream.close()


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
    lines = pack_frame(frame).decode().strip().splitlines()
    header = json.loads(lines[0])
    # Parsed with the strict reader: a bare NaN token is not valid JSON, and
    # Python's encoder emits one unless it is stopped. This is the assertion.
    values = [json.loads(line) for line in lines[1:]]
    columns = {name: [row[i] for row in values] for i, name in enumerate(header)}

    assert columns["f"] == [1.5, None, None]
    assert columns["i"] == [1, None, 3]
    assert columns["s"] == ["a", None, "c"]
    assert columns["b"] == [True, None, False]
    assert columns["t"][1] is None


def test_a_missing_column_reads_as_null_rather_than_failing(tmp_path):
    """
    A seed built before a column existed should still boot.

    A checkout that is one pipeline version behind is a normal state, and
    refusing to start over one absent metric is a worse answer than running
    with it null, which every scorer already handles.
    """
    payload = '["a","b"]\n[1,"x"]\n[2,"y"]\n[3,"z"]\n'
    (tmp_path / f"toy{SUFFIX}").write_bytes(gzip.compress(payload.encode(), mtime=0))

    assert list(seedfile.rows(tmp_path, "toy", "a")) == [(1,), (2,), (3,)]
    assert list(seedfile.rows(tmp_path, "toy", "a", "not_there")) == [
        (1, None),
        (2, None),
        (3, None),
    ]
    # Column order is the caller's, not the file's.
    assert list(seedfile.rows(tmp_path, "toy", "b", "a")) == [("x", 1), ("y", 2), ("z", 3)]
    assert seedfile.count(tmp_path, "toy") == 3


def test_an_absent_table_is_reported_rather_than_guessed_at(tmp_path):
    """``ml_scores`` and the people tables are legitimately optional."""
    assert seedfile.exists(tmp_path, "never_written") is False
    assert seedfile.count(tmp_path, "never_written") == 0
    # A caller that asks for one anyway is told how to build it.
    with pytest.raises(FileNotFoundError, match="pipeline.pack"):
        next(seedfile.rows(tmp_path, "never_written", "a"))
