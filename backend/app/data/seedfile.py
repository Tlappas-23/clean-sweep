"""
Reading the packed seed (``app.data.seedfile``).

Architecture note
-----------------
This is the whole of the serving process's contact with the seed on disk, and
it is deliberately stdlib-only: ``gzip`` and ``json``, nothing else. That is
the point of the module. The pipeline writes parquet and ``pipeline.pack``
converts it (see that module for the format), which is what lets the deployed
image leave out pandas, pyarrow, numpy, scikit-learn and duckdb. Those five
are 230 MB of wheel and 96 MB of resident memory for work that happens once,
at boot, on a few megabytes of data.

So: nothing here may grow a third-party import. If a loader needs something
pandas would have given it, the conversion belongs in ``pipeline.pack``, on
the offline side, where the heavy dependency is already paid for.

Streamed, one row at a time
---------------------------
The reader never holds the whole table. This is the single most important
thing about the module, and it was learned the hard way: an earlier version
read a columnar file with one ``json.load``, which meant 1.1 million Python
objects alive before a single record existed. That transient was 84 MB, and
glibc does not hand freed memory back to the OS, so it pushed peak RSS to
402 MB on a 512 MB instance. Peak is what an OOM killer sees.

Streaming holds one row. The transient is under a megabyte, and it is faster,
because nothing has to build a million-element list before the first row can
be used.

:func:`rows` therefore returns a generator, and the loaders consume it once.
There is no table object to hold, which is deliberate: there is nothing here
that *could* accidentally be kept alive.
"""

from __future__ import annotations

import gzip
import json
import logging
from collections.abc import Iterator
from pathlib import Path

log = logging.getLogger(__name__)

#: Suffix written by ``pipeline.pack``.
SUFFIX = ".jsonl.gz"


def exists(seed_dir: Path, name: str) -> bool:
    """Whether a packed table is present. Two of them are legitimately not."""
    return (seed_dir / f"{name}{SUFFIX}").exists()


def rows(seed_dir: Path, name: str, *columns: str) -> Iterator[tuple]:
    """
    Stream one tuple per row, holding just the named columns in that order.

    The file's first line names its columns; every line after it is one row as
    an array in that order. Only the requested positions are read out, so a
    loader that wants 17 of 22 columns never materialises the other five.

    A missing column yields ``None`` rather than raising. A checkout one
    pipeline version behind is a normal state, and refusing to start over one
    absent metric is a worse answer than running with it null, which every
    scorer already handles.

    Raises ``FileNotFoundError`` if the table is absent, since a caller that
    reaches here has already decided the table is required; use :func:`exists`
    for the optional ones.
    """
    path = seed_dir / f"{name}{SUFFIX}"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} is missing. Build it with `python -m pipeline.pack` (needs data/seed/{name}.parquet)."
        )

    with gzip.open(path, "rt", encoding="utf-8") as handle:
        header = json.loads(next(handle))
        index = {name: i for i, name in enumerate(header)}

        missing = [c for c in columns if c not in index]
        if missing:
            log.info("seed: table %r has no column(s) %s, reading them as None", name, missing)

        # Resolved once, outside the loop: this runs 50,000 times and a dict
        # lookup per column per row is the difference between a fast boot and
        # a slow one.
        positions = [index.get(column) for column in columns]

        for line in handle:
            record = json.loads(line)
            yield tuple(None if p is None else record[p] for p in positions)


def count(seed_dir: Path, name: str) -> int:
    """Rows in a packed table, without parsing any of them."""
    path = seed_dir / f"{name}{SUFFIX}"
    if not path.exists():
        return 0
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        next(handle)  # header
        return sum(1 for _ in handle)
