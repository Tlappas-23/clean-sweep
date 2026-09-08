"""
HTTP middleware (``app.core.middleware``).

Three concerns, in the order a request meets them: how much bandwidth a
response costs, whether the caller is allowed to make it, and what a browser
is permitted to do with what comes back.

Bandwidth is not an afterthought here. The point of this deployment is that
the game is playable on a phone, often on mobile data, against a server on a
free tier that sleeps. Every kilobyte not sent is a kilobyte not waited for.

Ordering
--------
Starlette runs middleware in reverse registration order on the way in, so the
registration in ``app.main`` reads outermost-last. The limiter has to run
*before* a handler does any work, and compression has to be the outermost
thing on the way out so it wraps whatever the handlers produced.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.limits import (
    CREATE_LIMIT,
    CREATE_WINDOW,
    READ_LIMIT,
    READ_WINDOW,
    WRITE_LIMIT,
    WRITE_WINDOW,
    client_key,
    limiter,
)

log = logging.getLogger(__name__)

#: Paths that are never rate limited. The health check is polled by the
#: platform itself, and limiting it would eventually make the service look
#: down to its own supervisor.
EXEMPT_PATHS = frozenset({"/health", "/healthz"})

#: Reference data that changes only when the seed is rebuilt. A day of browser
#: caching turns the second visit, and every navigation within a session, into
#: no request at all. Chosen per prefix rather than globally because most of
#: this API is a live game and must never be cached.
CACHEABLE_PREFIXES: tuple[tuple[str, int], ...] = (
    ("/api/meta", 86_400),
    ("/api/modes", 3_600),
    ("/api/catalog/", 86_400),
    ("/api/analytics/", 86_400),
)


def _bucket_for(request: Request) -> tuple[str, int, float]:
    """
    Which allowance this request draws on.

    Three tiers, because the three cost different things: a read is served
    from memory, a write is a change to a round that already exists, and
    creating a game is a permanent row plus, for the side modes, a graph
    search. See ``app.core.limits`` for the numbers and why they are generous.
    """
    path = request.url.path
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return "read", READ_LIMIT, READ_WINDOW
    # "/games" exactly, not "/games/{id}/...": creating is the expensive one,
    # and a move inside an existing round is an ordinary write.
    if path.endswith("/games") or path == "/api/games":
        return "create", CREATE_LIMIT, CREATE_WINDOW
    return "write", WRITE_LIMIT, WRITE_WINDOW


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Refuse a caller who is asking for far more than a person could."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        caller = client_key(
            request.headers.get("x-forwarded-for"),
            request.client.host if request.client else None,
        )
        bucket, limit, window = _bucket_for(request)
        allowed, remaining, retry_after = limiter.check(caller, bucket, limit, window)

        if not allowed:
            log.warning("rate limit: %s exceeded the %s allowance", caller, bucket)
            # 429 with Retry-After, so a well-behaved client backs off rather
            # than hammering, and the message says what to do rather than
            # just refusing.
            return JSONResponse(
                status_code=429,
                content={"detail": f"Too many requests. Try again in {retry_after} seconds."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    The headers a browser needs to be told, and the caching policy.

    This API serves JSON to a separate origin, so the usual page-level
    protections (a content security policy, frame ancestors) belong on the
    frontend host rather than here. What is left is the short list that
    actually applies to an API: do not sniff the content type, do not leak the
    referring URL to third parties, and do not let a browser cache a live game.

    Caching is the other half of "efficient". By default every response is
    marked uncacheable, because almost everything here is a game in progress
    and a cached board is a wrong board. The handful of endpoints that serve
    reference data opt in through :data:`CACHEABLE_PREFIXES`.
    """

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # A JSON API cannot be sniffed into something executable, and the
        # referrer should not travel to another origin.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Nothing here needs a camera, a microphone or a location.
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()"
        )

        if "Cache-Control" not in response.headers:
            path = request.url.path
            ttl = next(
                (t for prefix, t in CACHEABLE_PREFIXES if path.startswith(prefix)),
                None,
            )
            if ttl is not None and request.method in ("GET", "HEAD"):
                # `public` because none of this is per-user, so a CDN or the
                # browser may hold it. `stale-while-revalidate` is what makes
                # a sleeping free-tier server tolerable: the phone paints from
                # cache instantly and refreshes in the background.
                response.headers["Cache-Control"] = f"public, max-age={ttl}, stale-while-revalidate={ttl}"
            else:
                response.headers["Cache-Control"] = "no-store"
        return response
