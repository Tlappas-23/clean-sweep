"""
Recompute the scoring columns in place (``python -m pipeline.rescore``).

Why this is a separate step
---------------------------
``build_seed`` needs the 1.4 GB IMDb download to run. The metric columns it
writes, though, are derived entirely from tables that are already committed:
``films``, ``contenders`` and ``nominations``. When the *definition* of a
metric changes, rebuilding the whole seed to apply it would mean re-downloading
and re-deriving everything else for no reason, and would risk the tables
drifting out of step with one another.

This is the same pattern ``pipeline.enrich`` already uses when new revenue
arrives: recompute the affected columns from the committed seed, leave
everything else untouched, and write the tables back together.

What it writes
--------------
``films.parquet``
    ``award_points`` and ``award_standing`` (see ``pipeline.awards``).

``contenders.parquet``
    ``award_standing`` joined from the film, and the four percentile metrics
    named in ``pipeline.metrics.METRIC_SOURCES``: ``audience``, ``critics``,
    ``popularity`` and ``box_office``.

Both tables are written in one pass at the end, so a failure part-way through
leaves the seed as it was rather than half-migrated with one table's metrics
computed against another table's data.
"""

from __future__ import annotations

import argparse

import pandas as pd

from pipeline.awards import add_film_standing
from pipeline.metrics import METRIC_SOURCES, add_percentile_metrics
from pipeline.paths import SEED_DIR

#: Columns the contender frame needs from its film in order to be scored.
FROM_FILM = ("imdb_rating", "imdb_votes", "box_office_usd", "rt_critic", "metascore", "award_standing")


def rescore(seed_dir=SEED_DIR, *, dry_run: bool = False) -> dict[str, int]:
    """Recompute the metric columns and write both tables back together."""
    films = pd.read_parquet(seed_dir / "films.parquet")
    contenders = pd.read_parquet(seed_dir / "contenders.parquet")
    nominations = pd.read_parquet(seed_dir / "nominations.parquet")

    films = add_film_standing(films, nominations)

    # Drop any previous copy of the joined columns so a rerun is idempotent
    # rather than accumulating _x / _y suffixes.
    stale = [c for c in FROM_FILM if c in contenders.columns]
    contenders = contenders.drop(columns=stale)
    contenders = contenders.merge(
        films[["film_id", *FROM_FILM]], on="film_id", how="left", validate="many_to_one"
    )
    contenders = add_percentile_metrics(contenders)

    # The old metric name, kept out of the seed so nothing can read it by
    # accident and get the pre-change definition.
    contenders = contenders.drop(columns=[c for c in ("acclaim",) if c in contenders.columns])

    summary = {
        "films": len(films),
        "contenders": len(contenders),
        "films_with_awards": int((films["award_points"] > 0).sum()),
        **{name: int(contenders[name].notna().sum()) for name in METRIC_SOURCES},
    }
    if not dry_run:
        films.to_parquet(seed_dir / "films.parquet", index=False)
        contenders.to_parquet(seed_dir / "contenders.parquet", index=False)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="compute but do not write")
    args = parser.parse_args()

    summary = rescore(dry_run=args.dry_run)
    print("rescore" + (" (dry run)" if args.dry_run else ""))
    for key, value in summary.items():
        print(f"  {key:20s} {value:,}")


if __name__ == "__main__":
    main()
