"""
Rate limiting (``app.core.limits``).

Why this exists at all
----------------------
Every endpoint here is anonymous. There is no sign-up, no key and no session,
which is right for a game nobody should have to register to play, but it means
the only thing standing between the database and a script is this module.
Two things are actually at risk:

* **Storage.** Creating a game writes a row. The free Postgres tier is half a
  gigabyte, and a loop doing ``POST /api/games`` fills it in an afternoon.
* **The one instance.** Board generation for Six Degrees and the Chain is
  rejection sampling over a graph. It is milliseconds, but it is not free, and
  the free tier is a single small container serving everybody.

In-process, on purpose
----------------------
A token bucket in a dict, not Redis. The deployment is one instance, so an
in-process counter *is* the global counter, and adding a second service to
count requests for a single container would be architecture for its own sake.

The honest limitation, written down so it is a decision rather than an
oversight: this resets when the process restarts, and if the app is ever
scaled to two instances each gets its own allowance. Both are acceptable at
this size and neither is silent, since :func:`snapshot` reports what the
limiter is holding. The day it scales out, this module is the one place that
has to change.

Writes and reads are limited differently because they cost different things.
A read is served from memory and hurts nobody; a write is a row that stays.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

#: Requests per window for endpoints that create or mutate a game. Deliberately
#: generous against real play: a fast Six Degrees round is nine answers and a
#: couple of hints inside three minutes, so a human never comes close.
WRITE_LIMIT = 60
WRITE_WINDOW = 60.0

#: Reads are cheap and idempotent, so the ceiling is only there to stop a
#: runaway client from monopolising a single-instance box.
READ_LIMIT = 300
READ_WINDOW = 60.0

#: Creating a *game* is the expensive write: it is a permanent row and, for the
#: side modes, a graph search. Held down hard and over a long window, because
#: no person starts more than a handful of rounds in ten minutes.
CREATE_LIMIT = 40
CREATE_WINDOW = 600.0

#: Stop the bucket table itself becoming the leak. Entries idle for longer than
#: this are dropped on the next sweep.
IDLE_EVICTION_SECONDS = 1800.0

#: How many callers may be tracked at once. A flood from many addresses would
#: otherwise grow the dict without bound, which is the same denial of service
#: by another route. Past this the limiter sheds its oldest entries.
MAX_TRACKED = 20_000


@dataclass
class _Bucket:
    """One caller's allowance for one class of request."""

    count: int = 0
    window_started: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)


class RateLimiter:
    """
    Fixed-window counters keyed by ``(caller, bucket name)``.

    Fixed window rather than a sliding log: a sliding window means storing a
    timestamp per request, and the precision buys nothing at these limits. The
    known cost is that a caller can spend one window's allowance at the end of
    one window and the next at the start of the following one. At 60 writes a
    minute that burst is 120 writes, which is still nothing.
    """

    def __init__(self) -> None:
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        # Every request touches this, and uvicorn serves them on a thread pool
        # for sync endpoints, so the dict needs a lock. It is held for a few
        # microseconds around counter arithmetic and nothing else.
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def check(self, caller: str, bucket: str, limit: int, window: float) -> tuple[bool, int, int]:
        """
        Count one request.

        Returns ``(allowed, remaining, retry_after_seconds)``. The caller gets
        the numbers rather than an exception so the route can put them in
        response headers, which is what makes a limit debuggable from outside.
        """
        now = time.monotonic()
        key = (caller, bucket)
        with self._lock:
            self._maybe_sweep(now)
            entry = self._buckets.get(key)
            if entry is None or now - entry.window_started >= window:
                entry = _Bucket(count=0, window_started=now, last_seen=now)
                self._buckets[key] = entry

            entry.last_seen = now
            entry.count += 1
            remaining = max(0, limit - entry.count)
            if entry.count > limit:
                retry_after = max(1, int(window - (now - entry.window_started)) + 1)
                return False, 0, retry_after
            return True, remaining, 0

    def _maybe_sweep(self, now: float) -> None:
        """Drop idle entries. Called under the lock, at most once a minute."""
        if now - self._last_sweep < 60.0 and len(self._buckets) < MAX_TRACKED:
            return
        self._last_sweep = now
        stale = [k for k, b in self._buckets.items() if now - b.last_seen > IDLE_EVICTION_SECONDS]
        for key in stale:
            del self._buckets[key]
        # Still oversized after evicting the idle: shed the least recently
        # seen. Dropping an entry only ever *grants* someone a fresh
        # allowance, so the failure mode of this table filling is a lenient
        # limiter rather than a locked-out one, which is the right way round.
        if len(self._buckets) > MAX_TRACKED:
            ordered = sorted(self._buckets.items(), key=lambda kv: kv[1].last_seen)
            for key, _ in ordered[: len(self._buckets) - MAX_TRACKED]:
                del self._buckets[key]

    def snapshot(self) -> dict[str, int]:
        """What the limiter is currently holding, for the health endpoint."""
        with self._lock:
            return {"tracked": len(self._buckets)}

    def reset(self) -> None:
        """Drop every counter. Used by the tests."""
        with self._lock:
            self._buckets.clear()
            self._last_sweep = time.monotonic()


#: Process-wide limiter. One instance, one counter.
limiter = RateLimiter()


def client_key(forwarded_for: str | None, direct: str | None) -> str:
    """
    Which caller a request came from.

    Behind Render (and every other managed host) the socket address is the
    platform's proxy, so limiting on it would put every visitor in one bucket
    and the first busy client would lock out the rest. The real address is the
    *first* entry of ``X-Forwarded-For``: the proxy appends each hop, so the
    leftmost is the original client.

    That header is client-controlled and therefore forgeable, which is worth
    being clear-eyed about: someone determined to evade this limit can, by
    sending a different value each time. It is not an authentication boundary
    and is not doing the work of one. It stops accidents, loops and casual
    abuse, and the eviction policy above bounds what forging one buys.
    """
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    return direct or "unknown"
