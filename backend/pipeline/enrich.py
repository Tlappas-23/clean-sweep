"""
Step 3 of the pipeline: enrich films with posters, box office and critic scores.

Usage (from ``backend/``)::

    python -m pipeline.enrich --tmdb --omdb        # spend today's budget
    python -m pipeline.enrich --from-cache-only    # re-apply, zero requests
    python -m pipeline.enrich --omdb --limit 50    # cap this run by hand

Architecture note
-----------------
The provider clients and the response cache live in ``pipeline.providers``;
this module is the *run*: which films to fetch, in what order, how much daily
allowance is left, and how what comes back lands in the seed.

The game runs on IMDb + Oscar data alone; this step *adds* columns to
``films.parquet`` (poster_path, box_office_usd, budget_usd, rt_critic,
metascore) and recomputes the ``box_office`` percentile on
``contenders.parquet`` through the shared ``pipeline.metrics`` helper.

Three properties matter, because this runs unattended on a schedule
(see ``pipeline.refresh`` and ``.github/workflows/refresh-data.yml``):

**It stays inside the daily quota.** Every request is counted against a
persistent per-UTC-day ledger (``pipeline.budget``) *before* it is made, so a
run started by a scheduler that also ran an hour ago picks up the remaining
allowance rather than starting from zero. Hitting the provider's own limit
error stops the pass cleanly instead of poisoning the cache.

**It works newest-first.** Recent films are the ones a freshly rebuilt catalog
just added, the ones whose box office is still moving, and the ones players
recognise; a quota spent on 1931 shorts is a quota wasted. The queue is
ordered by film year descending, then by vote count.

**It does not mistake a hiccup for an answer.** Cache entries carry a status
and a timestamp. A confirmed "the provider has no data for this film" is kept
for a long time; a transient failure is kept only briefly and retried; and a
recent film's figures are refreshed weekly, because a film released last month
has not finished earning. Without that distinction a single bad afternoon
would permanently blank a film's box office.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import UTC, datetime

import httpx
import pandas as pd
from dotenv import load_dotenv

from pipeline import boxoffice
from pipeline.budget import REQUESTS_PER_FILM, Budget
from pipeline.metrics import METRIC_SOURCES, add_percentile_metrics
from pipeline.paths import REPO_ROOT, SEED_DIR, ensure_dirs
from pipeline.providers import (
    RECENT_YEARS,
    STATUS_ERROR,
    STATUS_OK,
    Cache,
    QuotaExhausted,
    fetch_omdb,
    fetch_tmdb,
)

# The durable home of everything the providers have ever told us.
#
# ``build_seed`` rewrites films.parquet from the IMDb dumps with blank
# enrichment columns, so a weekly rebuild would otherwise wipe months of API
# calls. The response cache normally covers that, but the cache is gitignored
# and a fresh CI runner starts without one - which is exactly how a scheduled
# rebuild once committed a catalog with 0.1% poster coverage. This small table
# (one row per enriched film) IS committed, so enrichment survives a rebuild
# on any machine, cold cache or not.
ENRICHMENT_PATH = SEED_DIR / "enrichment.parquet"
ENRICHED_COLUMNS: tuple[str, ...] = (
    "poster_path",
    "box_office_usd",
    "budget_usd",
    "rt_critic",
    "rt_audience",
    "metascore",
)
# Derived here rather than fetched, and recomputed on every pass because a
# newly fetched revenue changes the group medians every estimate rests on.
DERIVED_COLUMNS: tuple[str, ...] = (boxoffice.ESTIMATE_COLUMN,)


# The column whose presence in the seed proves a provider's lookup already
# succeeded for a film. Used only as a cold-cache fallback (see build_queue):
# a poster means TMDB resolved the film, a critic score means OMDb answered.
ENRICHED_SENTINELS: dict[str, tuple[str, ...]] = {
    "tmdb": ("poster_path",),
    "omdb": ("rt_critic", "metascore"),
}


# --------------------------------------------------------------------- queue
def build_queue(films: pd.DataFrame, cache: Cache, limit: int | None) -> list[tuple[str, int | None]]:
    """
    Films still worth a request, newest first.

    "Worth a request" means never fetched, or the cached entry has aged past
    the TTL for its status (see the module docstring). Ordering by year
    descending is the scheduling rule the whole design turns on: a daily
    budget should always land on the newest gaps first, because those are the
    films a rebuilt catalog just added and the ones whose numbers still move.

    There is a second, weaker signal for when the response cache is cold - a
    fresh CI runner, or a machine that has only ever pulled the committed
    seed. If the seed already carries the column that proves this provider
    answered for a film, that film is skipped even with no cache entry.
    Without it the first scheduled run on a new machine would spend a whole
    day's quota re-fetching data the repository already holds. Recent films
    are exempt, because theirs is exactly the data that goes stale.
    """
    current_year = datetime.now(UTC).year
    ranked = films.sort_values(["year", "imdb_votes"], ascending=[False, False], na_position="last")
    sentinels = [c for c in ENRICHED_SENTINELS.get(cache.provider, ()) if c in ranked.columns]

    queue: list[tuple[str, int | None]] = []
    for row in ranked.itertuples(index=False):
        year_value = None if pd.isna(row.year) else int(row.year)
        recent = year_value is not None and year_value >= current_year - RECENT_YEARS

        entry = cache.get(row.film_id)
        if entry is not None:
            if entry.is_fresh(recent_film=recent):
                continue
        elif not recent and any(pd.notna(getattr(row, c, None)) for c in sentinels):
            # Cold response cache, but the committed seed already carries this
            # provider's answer for this film, so there is nothing to learn.
            continue

        queue.append((row.film_id, year_value))
        if limit is not None and len(queue) >= limit:
            break
    return queue


# --------------------------------------------------------------------- apply
# Which cache payload key lands in which films.parquet column, per provider.
COLUMN_MAP: dict[str, dict[str, str]] = {
    "tmdb": {
        "revenue": "box_office_usd",
        "budget": "budget_usd",
        "poster_path": "poster_path",
    },
    "omdb": {
        "rt_critic": "rt_critic",
        "metascore": "metascore",
        # OMDb reports domestic gross only, so it never overwrites TMDB's
        # worldwide revenue - it only fills a gap TMDB could not.
        "box_office": "box_office_usd",
    },
}

# Columns a provider may only fill, never overwrite (see above).
FILL_ONLY: set[tuple[str, str]] = {("omdb", "box_office_usd")}


def apply_enrichment_table(films: pd.DataFrame) -> int:
    """
    Restore the committed enrichment table into a freshly built ``films``.

    This runs before any provider replay, so the cache (which is newer) can
    still override it. Returns the number of values restored.
    """
    if not ENRICHMENT_PATH.exists():
        return 0
    table = pd.read_parquet(ENRICHMENT_PATH).set_index("film_id")

    restored = 0
    for column in ENRICHED_COLUMNS:
        if column not in table.columns or column not in films.columns:
            continue
        incoming = films["film_id"].map(table[column])
        films[column] = incoming.where(incoming.notna(), films[column])
        restored += int(incoming.notna().sum())
    return restored


def save_enrichment_table(films: pd.DataFrame) -> int:
    """
    Write the enriched columns out as their own committed artifact.

    Only rows carrying at least one value are kept, so the file stays small
    and a diff shows exactly which films gained data.
    """
    columns = [c for c in ENRICHED_COLUMNS if c in films.columns]
    table = films[["film_id", *columns]].copy()
    table = table[table[columns].notna().any(axis=1)].sort_values("film_id")
    table.to_parquet(ENRICHMENT_PATH, index=False)
    return len(table)


def apply_cache(films: pd.DataFrame, provider: str) -> tuple[int, int]:
    """
    Write every usable cached response for ``provider`` into ``films``.

    Returns ``(values_written, records_skipped)``. This is the step that makes
    a seed rebuild cheap: ``build_seed`` emits empty enrichment columns, and
    replaying the cache restores every previously fetched value without a
    single request.
    """
    cache = Cache(provider)
    values: dict[str, dict] = {}
    skipped = 0

    for film_id in films["film_id"]:
        entry = cache.get(film_id)
        if entry is None or entry.status != STATUS_OK:
            continue
        if entry.data.get("year_mismatch"):
            skipped += 1  # refuse to attach figures we cannot vouch for
            continue
        values[film_id] = entry.data

    written = 0
    for source, column in COLUMN_MAP[provider].items():
        incoming = films["film_id"].map(lambda f, k=source: values.get(f, {}).get(k))
        if (provider, column) in FILL_ONLY:
            films[column] = films[column].where(films[column].notna(), incoming)
        else:
            films[column] = incoming.where(incoming.notna(), films[column])
        written += int(incoming.notna().sum())
    return written, skipped


# Re-exported so a caller that thinks in terms of "enrichment" does not have to
# know the provider module exists. The definitions live in pipeline.providers.
__all__ = [
    "Cache",
    "QuotaExhausted",
    "STATUS_ERROR",
    "STATUS_OK",
    "apply_cache",
    "build_queue",
    "coverage",
    "run",
    "validate",
]


# --------------------------------------------------------------------- run
def fetch_provider(
    provider: str, films: pd.DataFrame, api_key: str, limit: int | None, sleep: float
) -> dict[str, int]:
    """
    Spend the provider's remaining daily allowance, newest films first.

    Returns a small report the scheduler prints and the workflow surfaces.
    """
    cache = Cache(provider)
    budget = Budget.load(provider)
    per_film = REQUESTS_PER_FILM[provider]

    affordable = budget.films_affordable(per_film)
    if limit is not None:
        affordable = min(affordable, limit)
    report = {"fetched": 0, "ok": 0, "absent": 0, "error": 0, "remaining": budget.remaining}
    if affordable <= 0:
        print(f"  {provider}: daily budget spent ({budget}); nothing to do")
        return report

    queue = build_queue(films, cache, limit=affordable)
    print(f"  {provider}: {budget}; {len(queue)} film(s) queued (newest first)")
    if not queue:
        return report

    fetch = fetch_tmdb if provider == "tmdb" else fetch_omdb
    with httpx.Client(timeout=30) as client:
        for index, (film_id, year) in enumerate(queue, start=1):
            if not budget.can_spend(per_film):
                print(f"  {provider}: budget reached after {report['fetched']} film(s)")
                break
            # Count the spend *before* the call: a request that times out still
            # consumed the provider's allowance.
            budget.spend(per_film)
            try:
                status, payload = fetch(client, api_key, film_id, year)
            except QuotaExhausted as exc:
                # The provider is the source of truth, and it disagrees with
                # the local ledger (another machine, or a run from before the
                # ledger existed). Record the day as fully spent so nothing
                # else today queues work that cannot succeed.
                print(f"  {provider}: provider reports the quota is gone ({exc}); stopping")
                budget.exhaust()
                break
            except httpx.HTTPError as exc:
                # Deliberately not str(exc): httpx puts the full request URL in
                # the message, and that URL carries the API key. Only the
                # exception type is recorded.
                status, payload = STATUS_ERROR, {"error": type(exc).__name__}

            cache.put(film_id, status, payload)
            report["fetched"] += 1
            report[status] += 1
            if index % 100 == 0:
                print(f"    {index}/{len(queue)}")
            time.sleep(sleep)

    report["remaining"] = budget.remaining
    return report


def validate(films: pd.DataFrame) -> list[str]:
    """
    Sanity-check the enriched columns and return human-readable problems.

    Cheap, and it runs on every scheduled pass: a provider changing a field's
    units, or a bad merge, is exactly the kind of thing that otherwise sits
    unnoticed in committed data for weeks.
    """
    problems: list[str] = []

    def flag(mask: pd.Series, message: str) -> None:
        count = int(mask.sum())
        if count:
            example = films.loc[mask, "title"].iloc[0]
            problems.append(f"{count} film(s) {message} (e.g. {example!r})")

    for column in ("rt_critic", "metascore"):
        numeric = pd.to_numeric(films[column], errors="coerce")
        flag(numeric.notna() & ((numeric < 0) | (numeric > 100)), f"have {column} outside 0-100")

    for column in ("box_office_usd", "budget_usd"):
        numeric = pd.to_numeric(films[column], errors="coerce")
        flag(numeric.notna() & (numeric < 0), f"have a negative {column}")
        # A five-billion-dollar gross means a mismatched film, not a hit.
        flag(numeric.notna() & (numeric > 5e9), f"have an implausible {column}")

    flag(
        films["poster_path"].notna() & ~films["poster_path"].astype(str).str.startswith("/"),
        "have a poster_path that is not a TMDB path fragment",
    )

    # A poster shared by two films of the *same* year is normal and correct:
    # TMDB reuses one image across the parts of a serial ("The Ghost of
    # Yotsuya" I and II, 1949) and across re-releases. The same image on films
    # of different years is the signature of a mismatched lookup, so only that
    # is worth reporting.
    with_poster = films[films["poster_path"].notna()]
    if not with_poster.empty:
        spread = with_poster.groupby("poster_path")["year"].nunique()
        crossed = spread[spread > 1]
        if len(crossed):
            problems.append(
                f"{len(crossed)} poster(s) shared across different years "
                f"(e.g. {crossed.index[0]!r}) - possible mismatched lookup"
            )
    return problems


def coverage(films: pd.DataFrame) -> dict[str, float]:
    """Fraction of films carrying each enriched column, for the run report."""
    columns = ("poster_path", "box_office_usd", "budget_usd", "rt_critic", "metascore")
    out = {c: round(float(films[c].notna().mean()), 4) for c in columns if c in films.columns}
    if boxoffice.ESTIMATE_COLUMN in films.columns:
        combined = boxoffice.combined(films)
        out["box_office_measured_or_estimated"] = round(float(combined.notna().mean()), 4)
    return out


def run(
    use_tmdb: bool,
    use_omdb: bool,
    limit: int | None,
    sleep: float,
    cache_only: bool = False,
) -> dict:
    """Fetch what the budget allows, replay the cache into the seed, validate."""
    load_dotenv(REPO_ROOT / ".env")
    ensure_dirs()
    films = pd.read_parquet(SEED_DIR / "films.parquet")
    summary: dict = {"providers": {}, "cache_only": cache_only}

    # Restore the committed table BEFORE anything is queued. ``build_seed``
    # hands back blank enrichment columns, and the queue's cold-cache fallback
    # reads those columns to decide what still needs fetching - so restoring
    # afterwards would make every film look unenriched and re-queue the whole
    # catalog. That is not hypothetical: the first scheduled rebuild spent
    # 11,364 TMDB requests re-fetching data it already had, and would have
    # burned OMDb's entire daily allowance the same way.
    summary["restored_from_table"] = apply_enrichment_table(films)

    if not cache_only:
        for provider, enabled in (("tmdb", use_tmdb), ("omdb", use_omdb)):
            if not enabled:
                continue
            api_key = os.environ.get(f"{provider.upper()}_API_KEY")
            if not api_key:
                print(f"  {provider}: no {provider.upper()}_API_KEY set, skipping")
                continue
            summary["providers"][provider] = fetch_provider(provider, films, api_key, limit, sleep)

    # Replay the cache, which is newer than the table and so wins where both
    # carry a value.
    summary["applied"] = {}
    for provider in ("tmdb", "omdb"):
        written, skipped = apply_cache(films, provider)
        summary["applied"][provider] = {"values_written": written, "records_skipped": skipped}

    # Estimate the revenue the providers could not supply. This runs after the
    # fetch so the newest measurements feed the group medians, and it only
    # ever writes the separate estimate column - measured revenue is never
    # overwritten (see pipeline.boxoffice).
    films = boxoffice.estimate(films)
    summary["box_office_estimated"] = int(films.attrs.get("n_estimated", 0))

    films.to_parquet(SEED_DIR / "films.parquet", index=False)
    summary["enrichment_rows"] = save_enrichment_table(films)
    _recompute_contender_metrics(films)

    summary["coverage"] = coverage(films)
    summary["problems"] = validate(films)
    return summary


def _recompute_contender_metrics(films: pd.DataFrame) -> None:
    """Re-derive the within-year percentiles now that box office has changed.

    The contender table carries its own copy of the raw measurements, because
    the five-metric scorer reads them straight off the record. So both the
    derived metrics *and* those raw columns have to be cleared before the fresh
    values are joined on. Merging onto a column that is already present does
    not overwrite it: pandas keeps both and suffixes them `_x` and `_y`, the
    plain name stops existing, and the percentile step fails looking for
    `imdb_votes`. That is what broke the scheduled refresh for three days.

    Dropping by intersection rather than by a fixed list also makes this safe
    to run against a table written before those columns existed.
    """
    contenders = pd.read_parquet(SEED_DIR / "contenders.parquet")
    join_cols = ["film_id", "imdb_rating", "imdb_votes", "box_office_usd"]

    stale = [c for c in (*METRIC_SOURCES, *join_cols[1:]) if c in contenders.columns]
    merged = contenders.drop(columns=stale).merge(films[join_cols], on="film_id", how="left")

    # The joined measurements stay on the table. They are what the scorer reads
    # at request time, and this is the step that keeps them current.
    add_percentile_metrics(merged).to_parquet(
        SEED_DIR / "contenders.parquet", index=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tmdb", action="store_true")
    parser.add_argument("--omdb", action="store_true")
    parser.add_argument(
        "--from-cache-only",
        action="store_true",
        help="re-apply cached responses to the seed without making any request",
    )
    parser.add_argument("--limit", type=int, default=None, help="cap films per provider this run")
    parser.add_argument("--sleep", type=float, default=0.05, help="seconds between requests")
    args = parser.parse_args(argv)

    if not (args.tmdb or args.omdb or args.from_cache_only):
        parser.error("pass --tmdb and/or --omdb, or --from-cache-only")

    summary = run(args.tmdb, args.omdb, args.limit, args.sleep, cache_only=args.from_cache_only)

    print("\ncoverage:")
    for column, fraction in summary["coverage"].items():
        print(f"  {column:16s} {fraction:6.1%}")
    if summary["problems"]:
        print("\nvalidation problems:")
        for problem in summary["problems"]:
            print(f"  ! {problem}")
        return 1
    print("\nvalidation: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
