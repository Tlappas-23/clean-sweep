"""
Reading the packed seed (``app.data.seedfile``).

Architecture note
-----------------
This is the whole of the serving process's contact with the seed on disk, and
it is deliberately stdlib-only: ``gzip`` and ``json``, nothing else. That is
the point of the module. The pipeline writes parquet and ``pipeline.pack``
converts it (see that module for why), which is what lets the deployed image
leave out pandas, pyarrow, numpy, scikit-learn and duckdb. Those five are
230 MB of wheel and 96 MB of resident memory for work that happens once, at
boot, on a few megabytes of data.

So: nothing here may grow a third-party import. If a loader needs something
pandas would have given it, the conversion belongs in ``pipeline.pack``, on
the offline side, where the heavy dependency is already paid for.

Columns, not rows
-----------------
A packed table is ``{column_name: [values]}``. :meth:`Table.rows` zips a
chosen few of those columns together and yields tuples, which is what the two
loaders actually want. Neither ever needs a dict per row, and at 50,000 rows
not building 50,000 dicts is worth the slightly plainer call site.
"""

from __future__ import annotations

import gzip
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

#: Suffix written by ``pipeline.pack``.
SUFFIX = ".json.gz"


class Table:
    """
    One packed seed table, held as columns.

    Missing columns are not an error. A seed built before a column existed
    should still load, with that column reading as null everywhere, because
    the alternative is that a stale checkout crashes on boot instead of
    running with one metric absent. :meth:`column` is where that is decided.
    """

    __slots__ = ("name", "columns", "n_rows")

    def __init__(self, name: str, columns: dict[str, list[Any]]) -> None:
        self.name = name
        self.columns = columns
        self.n_rows = len(next(iter(columns.values()), []))

    def __len__(self) -> int:
        return self.n_rows

    def __contains__(self, column: str) -> bool:
        return column in self.columns

    def column(self, name: str, default: Any = None) -> list[Any]:
        """One column, or a column of ``default`` if the seed predates it."""
        found = self.columns.get(name)
        if found is not None:
            return found
        log.info("seed: table %r has no column %r, reading it as %r", self.name, name, default)
        return [default] * self.n_rows

    def rows(self, *names: str) -> Iterator[tuple]:
        """
        Yield one tuple per row, holding just the named columns in that order.

        ``zip`` over the columns rather than an index loop: it is the fastest
        way through in CPython and it reads as what it is.
        """
        return zip(*(self.column(name) for name in names), strict=True)


def read_table(seed_dir: Path, name: str) -> Table | None:
    """
    Load one packed table, or ``None`` if it was never written.

    ``None`` rather than an exception because two of the tables are genuinely
    optional: ``ml_scores`` does not exist until the ML step has run, and the
    people tables do not exist until the side-mode seed step has. Both callers
    already have a designed answer for absent data, and neither is a reason to
    refuse to start.
    """
    path = seed_dir / f"{name}{SUFFIX}"
    if not path.exists():
        return None
    with gzip.open(path, "rb") as handle:
        columns = json.load(handle)
    return Table(name, columns)


def require_table(seed_dir: Path, name: str) -> Table:
    """
    Load one packed table, or explain how to produce it.

    Used for the tables the app cannot run without. The message names the
    command rather than the missing path, because "run this" is more use to
    someone with a fresh checkout than "this file is absent".
    """
    table = read_table(seed_dir, name)
    if table is None:
        raise FileNotFoundError(
            f"{seed_dir / (name + SUFFIX)} is missing. "
            f"Build it with `python -m pipeline.pack` (needs data/seed/{name}.parquet)."
        )
    return table
