# Clean Sweep — frontend

The web client for **Clean Sweep**, an Oscar-ballot drafting game: spin a slot
machine for three years and a category, draft eight contenders — six Academy
Awards plus Best Horror and Best Comedy, which are judged against a genre crown
derived from the data — then run the ballot through a thirty-stop awards season.
A perfect run is 30–0 — the clean sweep.

React 19 · TypeScript · Vite 7 · Tailwind v4 · React Router 7 · Recharts ·
Vitest + Testing Library.

The rules live in [`docs/GAME_DESIGN.md`](../docs/GAME_DESIGN.md); the HTTP
contract this client mirrors lives in [`docs/API.md`](../docs/API.md).

---

## Quick start

```bash
npm install

# 1. With the backend running on :8000 (Vite proxies /api and /health to it)
npm run dev

# 2. Without a backend at all — the in-memory mock adapter serves everything
VITE_API_MOCK=true npm run dev
```

Then open http://localhost:5173.

## Scripts

| Script                   | What it does                                              |
|--------------------------|-----------------------------------------------------------|
| `npm run dev`            | Vite dev server on :5173, proxying `/api` + `/health` to `localhost:8000` |
| `npm run build`          | `tsc -b` then a production build into `dist/`             |
| `npm run preview`        | Serve the built `dist/` locally                            |
| `npm run typecheck`      | `tsc -b --noEmit` across both project references           |
| `npm run lint`           | ESLint (flat config, TypeScript + React Hooks rules)       |
| `npm run test`           | Vitest in watch mode                                       |
| `npm run test -- --run`  | Vitest once — what CI runs                                 |

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on every
push, so those four commands are the contract for "is the frontend green".

## Environment variables

Copy `.env.example` to `.env.local` to override. Both are optional.

| Variable         | Default | Meaning                                                        |
|------------------|---------|----------------------------------------------------------------|
| `VITE_API_MOCK`  | `false` | `true` swaps in the in-memory mock adapter — no backend needed. |
| `VITE_API_BASE`  | `""`    | Absolute API base URL. Empty means same origin (dev proxy).     |

Only `VITE_`-prefixed variables reach the browser; they are declared in
`src/vite-env.d.ts` and read in exactly one place, `src/api/index.ts`.

## Mock mode

`VITE_API_MOCK=true` selects `src/api/mock.ts` instead of the fetch adapter.
The mock is not a stub — it is a small in-memory server that:

* holds a hand-written catalog (`src/api/mockCatalog.ts`) of six film years —
  1939, 1960, 1975, 1986, 1994 and 2008, one per decade so a round can always
  deal three distinct years — with real titles, horror and comedy crowns, and
  plausible invented numbers (including self-contained SVG stand-ins for the
  TMDB posters the real API returns);
* enforces the same rules as the backend (spin only while `spinning`, skip only
  while `picking` with an allowance left, one reroll per round, picks and
  candidate queries confined to the years on the board, results only once
  complete) and rejects violations with the same `{"detail": "..."}` envelope,
  raised as an `ApiError`;
* masks metrics and stats in cinephile mode exactly as the server does;
* reproduces the two honesty rules the real catalog imposes: box office arrives
  in two columns (measured and estimated, never both), with the estimate left
  out of the scored `box_office` metric, and prestige never appears in a pick's
  `metric_breakdown` or in `/api/meta`'s metric list;
* serves the ranker's validation report (and 404s for it, and for the two model
  summaries, when constructed with `analyticsTrained: false`);
* runs its own simplified thirty-ceremony season so the Results page has real
  data to render;
* seeds its PRNG from the game's `seed`, so the daily challenge is repeatable.

Latency is configurable (`createMockApi({ latencyMs: 0 })`), which is how the
tests get a deterministic server with no waiting. Mock mode is announced in the
footer so a demo is never mistaken for live data.

## Folder structure

```
frontend/
├── index.html                 document shell + font links
├── vite.config.ts             plugins, dev proxy, vitest config
├── eslint.config.js           flat ESLint config
├── tsconfig*.json             project references (app + node)
└── src/
    ├── main.tsx               mounts <App /> into #root
    ├── App.tsx                providers + route table
    ├── index.css              Tailwind v4 @theme tokens, backdrop, keyframes
    ├── api/                   the only layer that knows about transport
    │   ├── types.ts           TypeScript mirror of docs/API.md
    │   ├── client.ts          the `Api` interface + `ApiError`
    │   ├── http.ts            fetch implementation
    │   ├── mock.ts            in-memory implementation
    │   ├── mockCatalog.ts     fixture films, people and Academy outcomes
    │   └── index.ts           picks an adapter from VITE_API_MOCK
    ├── state/
    │   ├── GameContext.tsx    the game store: reducer + async actions
    │   ├── gameReducer.ts     pure UI state for the Play screen
    │   └── ToastContext.tsx   global toast queue for API `detail` strings
    ├── lib/                   framework-light helpers
    │   ├── format.ts          record, seed, votes, money, null-safe metrics
    │   ├── labels.ts          category / mode / metric labels
    │   ├── useAsync.ts        loading-error-data for one-shot fetches
    │   └── useReducedMotion.ts
    ├── components/
    │   ├── layout/AppShell.tsx  nav, cinematic backdrop, footer, toasts
    │   ├── ui/                  Button, Chip, EmptyState, ErrorBanner,
    │   │                        PageHeader, Spinner, Toaster
    │   └── play/                SlotMachine, SpinBanner, SkipButtons,
    │                            RerollButton, CandidateToolbar,
    │                            ContenderCard, ContenderGrid, MetricBar,
    │                            BallotSidebar
    ├── pages/                 one file per route
    │   ├── Home.tsx           hero, how to play, three ways to start
    │   ├── Play.tsx           orchestrates the play components
    │   ├── Results.tsx        record, season, unmasked picks, submit
    │   ├── Leaderboard.tsx    daily vs all-time table
    │   ├── Analytics.tsx      archetype scatter + ranker report card
    │   ├── Browse.tsx         the unmasked catalog by year and category
    │   └── NotFound.tsx
    └── test/setup.ts          jest-dom matchers, cleanup, jsdom stubs
```

### Routes

| Path               | Page        |
|--------------------|-------------|
| `/`                | Home        |
| `/play/:gameId`    | Play        |
| `/results/:gameId` | Results     |
| `/leaderboard`     | Leaderboard |
| `/analytics`       | Analytics   |
| `/browse`          | Browse      |
| `*`                | NotFound    |

## How the layers fit

* **Pages never call `fetch`.** They depend on the `Api` interface, and
  `src/api/index.ts` decides which implementation backs it. Swapping the mock
  in is a one-line environment change, and the tests inject it directly.
* **The server owns game state.** `GameContext` POSTs an action and stores
  whatever `GameState` comes back; the reducer only tracks UI concerns (which
  request is in flight, the candidate pool, the highlighted card, the last
  error). That keeps the client honest about a contract where the backend
  enforces every rule.
* **Errors surface verbatim.** Every adapter throws `ApiError` carrying the
  API's `detail` string. Transient action failures become toasts; page-level
  failures become an `ErrorBanner` with a retry.
* **Masking is a server concern.** Cinephile mode arrives with metrics, stats
  and archetype already null; the UI just renders "—" instead of a number and
  hides metric sorts (sorting by a hidden metric is a 400 from the backend).
* **Estimates are never dressed as measurements.** A film with no measured
  revenue carries `box_office_est_usd` instead, which the card renders as
  "≈$12M est." with a tooltip saying where the number came from. The scored
  `box_office` bar stays empty for it on purpose — the metric is a percentile
  of measured revenue — and says so, so the pairing does not read as a bug.
  The single decision lives in `boxOfficeFigure` (`src/lib/format.ts`).
* **Prestige is shown, not scored.** Four metrics make a pick score (Academy
  0.60, Acclaim 0.16, Box Office 0.14, Popularity 0.10, in `SCORED_METRICS`).
  The ranker's estimate rides along below a divider in a muted treatment,
  captioned "Model estimate · not scored", on both the card and the results
  reveal; the argument that it is worth showing at all is the validation
  section of `/analytics`.

## Design and accessibility notes

* Palette, fonts and keyframes are Tailwind v4 `@theme` tokens in
  `src/index.css`: near-black ground, warm gold accent, ivory text, a serif
  display face for headings.
* Every animation — the slot reels, the results reveal stagger, the toast rise
  — is guarded twice: a CSS `prefers-reduced-motion` block collapses the
  animations, and the `useReducedMotion` hook skips the JS timing that depends
  on them.
* Layouts are mobile-first; the ballot sidebar becomes a collapsible drawer and
  wide content (the leaderboard table) scrolls inside its own container.
* Interactive cards are real buttons with `aria-pressed`, metric bars are
  `role="meter"` with `aria-valuetext` for the hidden case, and the toast stack
  uses `role="alert"` for errors.

## Tests

```bash
npm run test -- --run
```

| File                                       | Covers                                                              |
|--------------------------------------------|---------------------------------------------------------------------|
| `src/App.test.tsx`                          | Smoke: the real router and providers over the mock adapter — the lobby, a full eight-round playthrough to the results page, and the three read-only pages |
| `src/state/game.test.tsx`                   | The store's create → spin → pick flow, drafting from the third dealt year, the reroll locking a round to one year, the off-board year 400, a genre round, skip accounting and error `detail` passthrough, plus the pure reducer |
| `src/components/play/SlotMachine.test.tsx`  | One reel per dealt year, the all-years option, and neither once a reroll has locked the board |
| `src/components/play/SpinBanner.test.tsx`   | The round statement: every dealt year, the genre-crown caveat, and the reroll's stake before and after it is spent |
| `src/api/mock.test.ts`                      | The mock against the current contract: four scored metrics on `/api/meta` and in every `metric_breakdown`, measured-vs-estimated box office in the fixture catalog, and the validation report (served, and 404 when untrained) |
| `src/components/play/ContenderCard.test.tsx`| Poster, poster fallbacks (null and load failure), career line, box office measured / estimated / absent, prestige rendered outside the scored bars, and the cinephile mask |
| `src/components/play/MetricBar.test.tsx`    | Null metrics render an em dash and no fill (hidden ≠ zero)          |
| `src/pages/Results.test.tsx`                | The record header, including the 30–0 clean-sweep treatment, and the pick reveal: four scored bars plus the unscored prestige estimate read off the contender |
| `src/pages/Analytics.test.tsx`              | The validation section: verdict and interval, permutation p-value and null distribution, leakage pass/fail, the baseline ranking, and the 404 empty state |
| `src/lib/format.test.ts`                    | Record en dash, local-time daily seed, null-safe formatters, and the measured / estimated / absent box-office rule |

Vitest runs in jsdom with `globals: false`, so tests import `describe`/`it`/
`expect` explicitly. `src/test/setup.ts` registers the jest-dom matchers, wires
up Testing Library's cleanup, and stubs the two browser APIs jsdom lacks
(`matchMedia`, `scrollTo`).

## Notes

* **Code splitting.** Recharts is only needed on `/analytics`, so that route is
  loaded with `React.lazy` behind a `Suspense` fallback. That keeps the entry
  chunk at ~283 kB (89 kB gzipped) instead of ~690 kB, and the 407 kB charting
  chunk is fetched only when someone opens the analytics page.
* **The Academy outcome never rides along with a `Contender`.** The wire type
  has no field for it, which is the structural reason a candidate list cannot
  leak the answer during a game. The one endpoint outside a game,
  `GET /api/catalog/years/{year}`, returns `BrowseContender` instead — the same
  object with an `academy: { nominated, won }` attached — and that is what
  Browse reads for its Winner / Nominated badges.
