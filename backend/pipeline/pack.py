"""
Pack the parquet seed into the format the API serves from (``pipeline.pack``).

    python -m pipeline.pack

Why this step exists
--------------------
The pipeline's natural output is parquet: DuckDB writes it, pandas reads it,
and ``pipeline.rescore`` operates on it in place. But reading parquet at
*request time* costs the serving process pandas and pyarrow, and those two
imports are 96 MB of resident memory and 230 MB of installed wheel for work
that happens exactly once, at boot, on 4.5 MB of data.

So the seed is packed here, offline, into gzipped JSON Lines, which the stdlib
alone can read. It is about the size of the parquet it came from, and lets the
deployed image drop pandas, pyarrow, numpy, scikit-learn and duckdb entirely.

One row per line, and why that beats one list per column
--------------------------------------------------------
The first version of this was columnar: one JSON list per column, which is
smaller on disk and looked like the obvious choice. It was the wrong one, and
the reason is peak memory rather than file size.

A columnar file has to be parsed in a single ``json.load``, which for the
contenders table means 1.1 million Python objects alive at once before a
single record has been built. That transient measured 84 MB locally and, under
glibc, is never handed back to the OS: it pushed peak RSS to 402 MB on a
512 MB instance, and peak is what an OOM killer sees.

Streamed row by row, the same load holds one row at a time. The transient
drops from 84 MB to under 1 MB, and it is *faster*, because nothing has to
build a million-element list before the first row can be used. The cost is 8%
on disk (1.91 MB against 1.76 MB for the contenders table), since every line
repeats the field order. That is a trade worth making twice.

The format is deliberately plain: line one is the column names, every line
after it is one row as an array in that order. Arrays rather than objects
because repeating 22 key names 50,000 times is exactly the waste the columnar
version was avoiding, and the header already says what the positions mean.

Both formats stay committed
---------------------------
Parquet remains the pipeline's working copy, because ``rescore`` reads and
rewrites it and a fresh clone has to be able to re-run the build. The packed
copy is what ships to the server. Two copies of anything can drift, so this
step writes a manifest of row counts and a content digest, and
``tests/test_pack.py`` asserts the two agree table for table.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "data" / "seed"

#: The tables the API reads. Anything not on this list stays parquet-only:
#: ``nominations`` and ``enrichment`` are pipeline inputs, never served.
SERVED_TABLES = ("films", "contenders", "ml_scores", "actors", "costars")

#: gzip level. 6 is the default and the knee of the curve here: 9 buys about
#: 2% for four times the pack time, on a file that is committed once a day.
GZIP_LEVEL = 6

#: Suffix written. Mirrored by ``app.data.seedfile.SUFFIX``.
SUFFIX = ".jsonl.gz"

#: Name of the index written beside the tables.
MANIFEST = "manifest.json"


def _clean(value: Any) -> Any:
    """
    One parquet cell as something ``json`` can write.

    pandas hands back numpy scalars, ``NaT``, ``NaN`` and masked ``NA``, none
    of which survive a round trip. They all become ``null``, which is what the
    loaders already treat a missing value as. NaN in particular has to go: JSON
    has no literal for it, and Python's encoder would emit a bare ``NaN`` token
    that is not valid JSON and that other readers reject.
    """
    if value is None or value is pd.NaT:
        return None
    # Lists and arrays (the genres column) recurse rather than being tested
    # for nullness, which is ambiguous for a sequence.
    if isinstance(value, (list, tuple)) or hasattr(value, "tolist") and getattr(value, "ndim", 0):
        return [_clean(item) for item in list(value)]
    if pd.isna(value):
        return None
    # numpy scalar -> Python scalar.
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, float):
        return value
    return str(value)


def pack_frame(frame: pd.DataFrame) -> bytes:
    """
    One parquet table as JSON Lines: a header of column names, then one row
    per line as an array in that order. JSON-safe throughout.
    """
    columns = [str(c) for c in frame.columns]
    # Materialised per column rather than per row because pandas is far faster
    # that way, then zipped back into rows for writing. This is the offline
    # side, where holding the whole table for a moment costs nothing.
    values = [[_clean(v) for v in frame[name].tolist()] for name in frame.columns]

    out = [json.dumps(columns, separators=(",", ":"), ensure_ascii=False)]
    out.extend(
        json.dumps(list(row), separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        for row in zip(*values, strict=True)
    )
    return ("\n".join(out) + "\n").encode()


def write_table(name: str, frame: pd.DataFrame, seed_dir: Path) -> dict[str, Any]:
    """
    Write ``<name>.jsonl.gz`` and return its manifest entry.

    ``mtime=0`` in the gzip header is what makes the output byte-identical for
    identical input within one zlib version. Without it every pack would
    produce a different file and every daily refresh would commit a diff
    whether or not the data moved.
    """
    payload = pack_frame(frame)
    blob = gzip.compress(payload, GZIP_LEVEL, mtime=0)
    (seed_dir / f"{name}{SUFFIX}").write_bytes(blob)
    return {
        "rows": int(len(frame)),
        "columns": [str(c) for c in frame.columns],
        "bytes": len(blob),
        # Digest of the *uncompressed* payload, so it describes the data rather
        # than the compressor's version. zlib does not promise identical output
        # across releases, so this is what any staleness check compares.
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def pack(seed_dir: Path = SEED_DIR) -> dict[str, Any]:
    """
    Pack every served table. Returns the manifest.

    A missing table is skipped rather than fatal: ``ml_scores`` only exists
    once the ML step has run, and the app already treats it as optional.
    """
    started = time.perf_counter()
    tables: dict[str, Any] = {}
    for name in SERVED_TABLES:
        source = seed_dir / f"{name}.parquet"
        if not source.exists():
            print(f"  {name:12s} skipped (no {source.name})")
            continue
        entry = write_table(name, pd.read_parquet(source), seed_dir)
        tables[name] = entry
        print(
            f"  {name:12s} {entry['rows']:>7,} rows  "
            f"{source.stat().st_size / 1e6:5.2f} MB parquet -> {entry['bytes'] / 1e6:5.2f} MB packed"
        )

    manifest = {"version": 1, "tables": tables}
    (seed_dir / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    total = sum(t["bytes"] for t in tables.values())
    print(f"  {'total':12s} {total / 1e6:5.2f} MB in {time.perf_counter() - started:.1f}s")
    return manifest


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    seed_dir = Path(argv[0]) if argv else SEED_DIR
    print(f"$ pack {seed_dir}")
    pack(seed_dir)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
