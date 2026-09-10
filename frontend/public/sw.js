/*
 * Service worker for Clean Sweep.
 *
 * Two jobs, and the second is the reason this exists at all.
 *
 * 1. Make the installed app open instantly. Once added to a home screen the
 *    shell is served from cache, so tapping the icon paints a real interface
 *    in a frame rather than after a network round trip. Routing is hash-based
 *    (see src/App.tsx), so every navigation resolves to the same cached
 *    document and the route is read from the fragment, which the server never
 *    sees.
 *
 * 2. Cover the cold start. The API sleeps after fifteen minutes idle and takes
 *    the better part of a minute to wake. Without this, opening the app during
 *    that minute is a white screen. With it, the interface is up immediately
 *    and only the data is waiting, which the app says out loud (see
 *    WakeBanner). The difference between "broken" and "starting" is mostly
 *    whether anything is on screen.
 *
 * What is deliberately NOT cached
 * -------------------------------
 * Anything that is a game. A cached board is a wrong board: the round has a
 * clock, the server is authoritative about when it ends, and serving a stale
 * copy would show a player a position they are no longer in. The API sets
 * `Cache-Control: no-store` on live game routes for the same reason, and this
 * worker never second-guesses it.
 *
 * Reference data is different. `/api/meta`, `/api/modes`, the catalogue and
 * the analytics artifacts only change when the pipeline runs, so they are
 * served stale-while-revalidate: instantly from cache, refreshed in the
 * background. That is most of what makes a second visit feel immediate.
 *
 * Versioning, and the one file that has no hash
 * ---------------------------------------------
 * CACHE_VERSION is bumped by hand when the caching strategy changes. Asset
 * filenames are content-hashed by the build, so a new deploy naturally fetches
 * new files rather than needing an invalidation; the version is only there to
 * evict the whole thing when the *rules* below change.
 *
 * The shell is the exception, and it is the one that bit. index.html has no
 * hash in its name, so a cached copy is indistinguishable from a current one
 * and serves a document pointing at a bundle that no longer exists on the
 * server. The navigate handler therefore fetches it with `cache: "no-store"`;
 * see the comment there for what was observed in production.
 */

// Bumped to v2 when the navigate handler started bypassing the HTTP cache.
// The version exists to evict everything when the *rules* change, which they
// just did: a v1 cache holds a shell fetched under the old rules, and keeping
// it would leave the exact staleness this was raised to fix.
const CACHE_VERSION = "v2";
const SHELL_CACHE = `clean-sweep-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `clean-sweep-assets-${CACHE_VERSION}`;
const DATA_CACHE = `clean-sweep-data-${CACHE_VERSION}`;

/** Scope root, e.g. "/clean-sweep/" on Pages or "/" on a custom domain. */
const ROOT = new URL("./", self.registration.scope).pathname;

/**
 * API paths whose answers are reference data rather than a game in progress.
 * Everything else under /api goes straight to the network, always.
 */
const CACHEABLE_API = ["/api/meta", "/api/modes", "/api/catalog/", "/api/analytics/"];

/** How long a cached reference response may be served before it is refetched. */
const DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Only the shell is precached. The hashed JS and CSS are picked up on
      // first use instead, which avoids shipping a build manifest into this
      // file and keeps it honest: the first visit is a normal network load,
      // and every visit after it is instant.
      const cache = await caches.open(SHELL_CACHE);
      // redirect.js is on the critical path for any legacy path-style link,
      // so it is precached with the shell rather than fetched at the moment
      // it is needed.
      await cache.addAll([
        ROOT,
        `${ROOT}manifest.webmanifest`,
        `${ROOT}favicon.svg`,
        `${ROOT}redirect.js`,
      ]);
      // Take over as soon as installed rather than waiting for every tab to
      // close. Safe here because the worker holds no cross-version state.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Serve from cache, refresh in the background. */
async function staleWhileRevalidate(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        // Stamp the time so age can be judged without trusting the server's
        // clock or its headers.
        const stamped = new Response(response.clone().body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
        stamped.headers.set("x-cached-at", String(Date.now()));
        cache.put(request, stamped);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    const age = Date.now() - Number(cached.headers.get("x-cached-at") ?? 0);
    if (Number.isFinite(age) && age < maxAgeMs) return cached;
    // Too old to serve blindly, but still better than nothing if the network
    // cannot answer, which on this deployment means the server is asleep.
    return (await network) ?? cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error("offline and nothing cached");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never interfere with a move

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1. Navigations. The app is a single page with client-side routing, so
  //    every route resolves to the same shell. Serving it from cache is what
  //    makes the installed app open in a frame, and it also means a deep link
  //    opens offline instead of erroring.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // `cache: "no-store"` is load-bearing, not belt and braces.
          //
          // Network-first is not enough on its own: `fetch` may still be
          // answered from the browser's own HTTP cache, and this document is
          // the one file whose name never changes. Every other asset is
          // content-hashed, so a stale hit is impossible; the shell has no
          // hash, so a stale hit serves an old document pointing at a bundle
          // that is no longer current. Observed in production: a deploy went
          // out, the server had index-ChZiUF4f.js, and a returning visitor
          // was still being handed index-D8eK-oB4.js by this handler.
          //
          // Going to the network for one small HTML file per navigation is
          // the right trade. The expensive things stay cached, and the app is
          // never a version behind for someone who has visited before.
          const fresh = await fetch(request, { cache: "no-store" });
          if (fresh.ok) {
            // Keep the offline copy current while we have a good one.
            const cache = await caches.open(SHELL_CACHE);
            cache.put(ROOT, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(ROOT)) ??
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })(),
    );
    return;
  }

  // 2. The API. Reference data may be cached; a live game never may.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health")) {
    const cacheable = CACHEABLE_API.some((p) => url.pathname.startsWith(p));
    if (cacheable) {
      event.respondWith(
        staleWhileRevalidate(request, DATA_CACHE, DATA_MAX_AGE_MS).catch(() => fetch(request)),
      );
    }
    // Not cacheable: fall through untouched. A board must always come from
    // the server, because the server owns the clock.
    return;
  }

  // 3. Our own static assets. Content-hashed by the build, so a cache hit can
  //    never be stale: a changed file has a different name.
  if (sameOrigin && url.pathname.startsWith(ROOT)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      })(),
    );
  }

  // 4. Anything else (Google Fonts, TMDB posters) goes to the network under
  //    the browser's own HTTP cache, which already handles them well and
  //    knows more about their freshness than this file does.
});
