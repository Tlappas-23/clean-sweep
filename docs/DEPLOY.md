# Deploying Clean Sweep

Two pieces, deployed separately, on free tiers.

| Piece | Where | What it costs |
|-------|-------|---------------|
| Frontend | GitHub Pages, from `.github/workflows/pages.yml` | nothing |
| API | Render, from `render.yaml` | nothing, but it sleeps |
| Database | Neon Postgres | nothing under 0.5 GB |

They are on different origins, which is why the API keeps a CORS allow-list.

---

## What makes this fit in a free tier

Worth reading before deploying, because most of it is load-bearing.

**The server never imports pandas.** The pipeline writes parquet, and
`pipeline/pack.py` converts it offline into gzipped JSON Lines that the
standard library reads (`app/data/seedfile.py`). pandas, pyarrow, numpy,
scikit-learn and duckdb are ~230 MB of wheel and ~96 MB of resident memory,
and the request path uses none of them.

**The seed is streamed, not loaded.** One row at a time. The first version of
the packed format was columnar, which is smaller on disk and had to be parsed
whole: 1.1 million Python objects alive before a single record existed, 84 MB
that glibc never returns to the OS, and 402 MB of peak RSS on a 512 MB
instance. Streaming holds one row, costs 8% on disk, and is faster.

| | Before | After |
|---|--------|-------|
| Installed dependencies | 530 MB | **77 MB** |
| Peak memory at boot | 402 MB (Linux) | **365 MB** (Linux), 140 MB (macOS) |
| Boot | 1.2 s | **0.5 s** |
| Seed on disk | 4.5 MB parquet | **3.0 MB packed** |

`backend/tests/test_footprint.py` asserts all of this, including that none of
those five libraries is importable from the request path. A convenience
import in a data module would give the whole saving back, and that test is
the only thing that would notice.

**One worker.** The catalogue is ~150 MB of the 512 MB allowed. A second
worker is a second copy of it, and the instance is killed rather than
throttled when it runs out.

**`MALLOC_ARENA_MAX=2`.** glibc opens a memory arena per thread and does not
give the space back, so in a container the process reads as larger than is
actually live. Peak is the number that matters here, not steady state: it is
reached at boot and it is what an OOM killer sees.

Memory measures very differently by platform, by more than any of the work
above changed it: the same load is ~140 MB on macOS and ~365 MB on Linux.
`tests/test_footprint.py` sets its budget from the CI figure for that reason.
A budget that only holds on a laptop would pass while production sat 200 MB
higher.

**The instance sleeps** after 15 minutes idle and takes the better part of a
minute to wake. Three things make that livable rather than a white screen:

* the frontend is a PWA, so the interface paints from cache immediately;
* reference endpoints are served `stale-while-revalidate`, so a returning
  player sees content before the server is even up;
* `src/api/http.ts` retries reads with backoff and announces it, and
  `WakeBanner` says "waking the server" rather than showing an error for
  something that is about to work.

---

## 1. Database (Neon)

1. Create a project at [neon.com](https://neon.com). **The region has to match
   `region:` in `render.yaml`** (currently `ohio`, which is AWS `us-east-2`).
   Every query pays the round trip between them, and putting the two on
   opposite coasts is the easiest performance mistake available here: the test
   suite takes 10 seconds against a local Postgres and 85 across the country.
2. Copy the connection string. Use the **direct** one, not the pooled one:
   the pooled endpoint has `-pooler` in its hostname and runs PgBouncer in
   transaction mode, and Neon's own guidance is that an application keeping
   its own pool (which this one does, see `app/core/db.py`) should connect
   directly.

   The CLI is the quicker route than the dashboard:

   ```bash
   npm i -g neon@latest && neon login
   neon link --project-id <your-project-id> --branch production
   ```

   That writes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct)
   into `.env`, which is gitignored. The unpooled one is what to paste into
   Render.

Paste it exactly as given. `app/core/db.py` rewrites the scheme to the driver
SQLAlchemy 2 needs, so `postgres://` and `postgresql://` both work and the
`?sslmode=require` Neon requires is preserved.

Tables are created on first boot. There is no migration step yet: the schema
is three tables and `create_all` is honest at this size. If it grows, that is
the point to add Alembic.

**Retention.** Every visitor is anonymous and creates a row by pressing Play,
so the tables only grow. `Database.sweep()` runs at startup and deletes games
older than 14 days. Submitted leaderboard scores are never swept.

## 2. API (Render)

1. New > Blueprint, point it at this repository. `render.yaml` supplies
   everything except the secret.
2. Set one environment variable in the dashboard:

   | Key | Value |
   |-----|-------|
   | `CLEAN_SWEEP_DB_URL` | the Neon connection string |

   It is marked `sync: false` in the blueprint, which is what keeps it out of
   the repository.
3. Deploy. First build takes a couple of minutes; after that the health check
   at `/health` should return:

   ```json
   {"status":"ok","contenders":49826,"actors":1238,"side_modes":true,
    "database":"postgresql","durable":true}
   ```

   Every field there is load-bearing. The counts catch an instance that
   started without its data, which would answer every request with a 503 and
   look healthy doing it.

   **`"durable": true` is the one to check after a deploy.** If the connection
   string never reached the service, the app falls back to a SQLite file on
   the instance's own disk and reports `"database":"sqlite","durable":false`.
   It then serves every request perfectly and loses every game on the next
   deploy or the next wake from sleep. There is no error to watch for; the
   only way to see it is to ask.
4. Copy the service URL, e.g. `https://clean-sweep-api.onrender.com`.

If `CLEAN_SWEEP_CORS_ORIGINS` in `render.yaml` does not match where the
frontend is served from, every request will fail in the browser and succeed in
curl. That is the first thing to check if the site loads but nothing plays.

## 3. Frontend (GitHub Pages)

Set a repository **variable** (not a secret):

Settings > Secrets and variables > Actions > Variables > New:

| Name | Value |
|------|-------|
| `CLEAN_SWEEP_API_URL` | the Render URL from step 2 |

Then re-run the Pages workflow. It is a variable rather than a secret because
the URL is public the moment a browser makes a request to it; hiding it would
only make it harder to change.

**If that variable is unset** the workflow builds with `VITE_API_MOCK=true`
instead, which swaps in the fixture adapter in `src/api/mock.ts`: every rule
and score is the real one, computed in the browser, but over a few dozen
fixture films rather than 4,180. The run log says which of the two it built.
The fallback exists so a fork with no backend still deploys something playable.

---

## Why the URLs have a `#`

GitHub Pages serves static files and has no rewrite rules, so a path-style
deep link is a file that does not exist. Pages falls back to `404.html`, and
because that file is a copy of `index.html` the app renders correctly while
the response carries a **404 status**. It works and it is wrong, which is the
worst combination: a crawler, a link checker or a preview-card fetcher reads
the status rather than the body and sees a broken page.

Hash routing keeps the route on the client. The server is only ever asked for
`/clean-sweep/`, which exists, so every URL is a 200 and no fallback file is
doing load-bearing work.

| | status |
|---|---|
| `/clean-sweep/` | 200 |
| `/clean-sweep/#/chain` | 200 |
| `/clean-sweep/chain` (old shape) | 404, then `redirect.js` rewrites it to the hash |

Links shared before the change still work: `public/redirect.js` runs on the
404 fallback and translates the path, query string included, before the app
mounts. `frontend/src/lib/legacyRedirect.test.ts` pins that against the file
that actually ships.

**If this ever moves to a host with rewrites** (Netlify, Cloudflare Pages, or
behind the API), `BrowserRouter` becomes the better choice again and
`frontend/src/App.tsx` is the one line to change back.

## Installing it on a phone

The site is a PWA. On the deployed URL:

* **iOS** Share > Add to Home Screen
* **Android** the browser offers "Install app", or Menu > Add to Home screen

It then opens fullscreen with no browser chrome, keeps clear of the notch and
the home indicator, and paints its cached shell instantly. The manifest also
declares shortcuts, so long-pressing the icon jumps straight into a mode.

The service worker (`frontend/public/sw.js`) never caches a game. A cached
board is a wrong board: the round has a clock and the server owns it. Only the
shell, the static assets and the reference endpoints are cached.

---

## Security

| | |
|---|---|
| CORS | An allow-list, never `*`. A wildcard would let any site drive this API from a visitor's browser. |
| Credentials | `allow_credentials=False`. There is no auth, so there is nothing for a browser to attach. |
| Rate limiting | `app/core/limits.py`. Three tiers: reads 300/min, writes 60/min, creating a game 40 per 10 min. |
| Headers | `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| Caching | `no-store` on every live game; only reference data is cacheable. |
| Secrets | Only `CLEAN_SWEEP_DB_URL`, set in the dashboard. `.env` is gitignored and `.dockerignore`d. |
| Container | Runs as a non-root user with no write access it does not need. |

The rate limiter is in-process, which is correct for a single instance and is
written down as a decision rather than an oversight in that module. It keys on
`X-Forwarded-For`, which is client-controlled and therefore forgeable: it stops
loops, accidents and casual abuse, and is not doing the work of authentication.

---

## Running the pipeline

The offline halves are not installed on the server and are not meant to be:

```bash
pip install -e "backend[dev]"     # pipeline + ml + test tools
python -m pipeline.refresh        # daily: enrich, rescore, retrain, pack
python -m pipeline.refresh --rebuild   # full rebuild from the IMDb dumps
```

`pack` is the last step, after everything that can rewrite parquet.
`tests/test_pack.py` fails if the committed packed seed is stale against the
parquet it came from, which is what stops the server quietly serving a build
behind its own data.

## Alternatives

`Dockerfile` in the repository root builds the same service and works on any
host that takes a container. It is not what `render.yaml` uses, so it is the
less-travelled path of the two.
