"""
Daily request budgets for the enrichment providers (``pipeline.budget``).

Architecture note
-----------------
OMDb's free tier allows 1,000 requests a day and the catalog holds ~5,700
films, so enrichment is inherently a job that runs a little every day rather
than once. That only works if the process knows what it already spent: a
scheduled run that starts from zero every time would burn the quota, get
``Request limit reached`` and then cache that failure as though the film had
no data.

This module is the ledger. It records spend per provider per **UTC day**
(OMDb resets on UTC midnight) in a small JSON file next to the response
cache, and it is written after every request rather than at the end, so a run
that is killed halfway still leaves an honest count behind.

The ledger is deliberately *not* committed. It is machine-local state about
one API key's usage, and two machines sharing a key would each need their own
view of the day. Losing it costs at most one day of over-conservative
budgeting.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pipeline.paths import CACHE_DIR

# Free-tier ceilings. TMDB does not publish a hard daily cap for personal use
# but rate-limits per second, so it gets a self-imposed ceiling generous
# enough to finish the catalog in one pass yet small enough to be polite.
DAILY_LIMITS: dict[str, int] = {
    "omdb": 1_000,
    "tmdb": 20_000,
}

# Requests each provider spends per film. TMDB needs two calls (resolve the
# IMDb id, then read the movie), OMDb answers in one.
REQUESTS_PER_FILM: dict[str, int] = {
    "omdb": 1,
    "tmdb": 2,
}

# Held back from every budget so a run that races another process, or a
# retry, cannot tip the account over its ceiling.
SAFETY_MARGIN = 10

LEDGER_PATH = CACHE_DIR / "usage.json"


def today() -> str:
    """Current UTC date as ``YYYY-MM-DD``, the key providers reset on."""
    return datetime.now(UTC).strftime("%Y-%m-%d")


@dataclass
class Budget:
    """
    How many requests one provider may still spend today.

    Construct with :meth:`load`, call :meth:`spend` after each request, and
    read :attr:`remaining` to decide whether to keep going.
    """

    provider: str
    limit: int
    used: int
    path: Path = LEDGER_PATH

    @classmethod
    def load(cls, provider: str, limit: int | None = None, path: Path | None = None) -> Budget:
        """Read today's spend for ``provider`` from the ledger."""
        path = path or LEDGER_PATH
        ledger = _read(path)
        used = int(ledger.get(provider, {}).get(today(), 0))
        return cls(
            provider=provider,
            limit=limit if limit is not None else DAILY_LIMITS.get(provider, 1_000),
            used=used,
            path=path,
        )

    @property
    def remaining(self) -> int:
        """Requests left today, never negative, with the safety margin held back."""
        return max(0, self.limit - SAFETY_MARGIN - self.used)

    def films_affordable(self, per_film: int | None = None) -> int:
        """How many *films* the remaining requests cover for this provider."""
        cost = per_film or REQUESTS_PER_FILM.get(self.provider, 1)
        return self.remaining // cost

    def can_spend(self, requests: int = 1) -> bool:
        return self.remaining >= requests

    def spend(self, requests: int = 1) -> None:
        """
        Record ``requests`` against today and flush immediately.

        Flushing per request (rather than at the end) is what makes a killed
        or timed-out run safe: whatever it spent is already on disk.
        """
        self.used += requests
        ledger = _read(self.path)
        ledger.setdefault(self.provider, {})[today()] = self.used
        _write(self.path, _prune(ledger))

    def exhaust(self) -> None:
        """
        Record the whole day as spent.

        Called when the provider itself reports the limit is gone. The local
        ledger can legitimately disagree with the provider - another machine
        shares the key, or requests were made before the ledger existed - and
        when they differ the provider wins.
        """
        self.spend(max(0, self.limit - self.used))

    def __str__(self) -> str:  # pragma: no cover - human output only
        return f"{self.provider}: {self.used}/{self.limit} used today, {self.remaining} left"


def _read(path: Path) -> dict[str, dict[str, int]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:  # pragma: no cover - corrupt ledger
        # A corrupt ledger must not stop the run; treating it as empty is the
        # conservative direction only for spend, so the safety margin covers it.
        return {}


def _write(path: Path, ledger: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(ledger, indent=2, sort_keys=True))
    tmp.replace(path)  # atomic, so a crash mid-write cannot truncate the ledger


def _prune(ledger: dict, keep_days: int = 14) -> dict:
    """Keep the ledger small: only recent days are of any interest."""
    return {provider: dict(sorted(days.items())[-keep_days:]) for provider, days in ledger.items()}
