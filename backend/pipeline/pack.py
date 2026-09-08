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

So the seed is packed here, offline, into gzipped columnar JSON, which the
stdlib alone can read. The result is smaller than the parquet it came from
(3.3 MB against 4.5 MB), parses in about a tenth of a second, and lets the
deployed image drop pandas, pyarrow, numpy, scikit-learn and duckdb entirely.

Columnar rather than row-wise
-----------------------------
One list per column, not one object per row. Two reasons, and both matter at
50k rows: repeating every field name 50,000 times is most of what a row-wise
JSON file *is*, and a column of one type compresses far better than rows of
mixed ones. The loaders want columns anyway, since they zip a handful of them
together and never materialise a dict per row.

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


def pack_frame(frame: pd.DataFrame) -> dict[str, list[Any]]:
    """One parquet table as ``{column: [values]}``, JSON-safe throughout."""
    return {str(name): [_clean(v) for v in frame[name].tolist()] for name in frame.columns}


def write_table(name: str, frame: pd.DataFrame, seed_dir: Path) -> dict[str, Any]:
    """
    Write ``<name>.json.gz`` and return its manifest entry.

    ``mtime=0`` in the gzip header is what makes the output byte-identical for
    identical input. Without it every pack would produce a different file and
    every daily refresh would commit a diff whether or not the data moved.
    """
    payload = json.dumps(pack_frame(frame), separators=(",", ":"), ensure_ascii=False).encode()
    blob = gzip.compress(payload, GZIP_LEVEL, mtime=0)
    (seed_dir / f"{name}.json.gz").write_bytes(blob)
    return {
        "rows": int(len(frame)),
        "columns": [str(c) for c in frame.columns],
        "bytes": len(blob),
        # Digest of the *uncompressed* payload, so it describes the data
        # rather than the compressor's mood.
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
