# Clean Sweep: Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Data pipeline (offline, Python + DuckDB)          backend/pipeline/   │
│                                                                        │
│   IMDb bulk TSVs ─┐                                                    │
│   Oscar CSV ──────┼─► build_seed ─► people_graph ─► data/seed/*.parquet│
│   TMDB / OMDb ────┘   enrich · boxoffice · budget · refresh            │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  parquet (committed, a few MB)
┌──────────────▼─────────────────────────────────────────────────────────┐
│  ML (offline, scikit-learn)                          backend/ml/       │
│   train_ranker → prestige     cluster  → film archetypes               │
│   actors       → casting types validate → the evidence it is real      │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  scores and labels joined at load time
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                   backend/app/      │
│   data/     catalogs loaded once: contenders+films, actors+co-stars    │
│   engine/   pure rules, one module per mode                            │
│   api/      thin routers, one per resource                             │
│   models/   Pydantic schemas shared by api + engine                    │
│   core/     settings, database                                         │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  JSON over HTTP  (contract: docs/API.md)
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Vite)                frontend/         │
│   pages/   Home · Play · Results · Grid · Recast · Chain ·             │
│            Leaderboard · Analytics · Browse                            │
│   api/     typed client, with an in-memory mock adapter                │
│   state/   per-mode stores (context + reducer)                         │
└────────────────────────────────────────────────────────────────────────┘
```

## The four rules the layout enforces

**Engine is pure.** `backend/app/engine/` has no I/O, no framework imports and
no settings. Given a round and a catalog it returns a new round or a result.
That is what makes the rules unit-testable against a hand-built fake catalog
and what makes every seeded mode reproducible.

This is enforced rather than asserted. `tests/test_architecture.py` parses
every module in `app/engine/` and fails on an import outside a small stdlib
allow-list, on any reach into `app.core` or `app.data`, and on any of the five
offline libraries anywhere under `app/`. A rule nobody checks is a comment;
these three were each one convenience import away from quietly becoming
false. The one module that used to break them, a calibration script that read
settings and printed a report, now lives in `ml/` where the constraint does
not apply and where `.dockerignore` keeps it out of the production image.

If a router is deciding what something scores or whether a move is legal, the
rule is in the wrong place. Each mode's module owns the whole of its rules:

| Mode | Engine | Router |
|------|--------|--------|
| The Oscars | `engine/game.py` | `api/games.py` |
| Six Degrees | `engine/grid.py` | `api/grid.py` |
| Recast | `engine/recast.py` | `api/recast.py` |
| The Chain | `engine/chain.py` | `api/chain.py` |

**Data is a build artifact.** Raw sources are never read at request time. The
pipeline produces small columnar seed tables; the backend loads them once into
`app/data/` catalogs and indexes them for the queries each mode makes.

The line is drawn at the *format*, not just the timing. The pipeline works in
parquet, and `pipeline/pack.py` converts it offline into gzipped JSON Lines
that `app/data/seedfile.py` streams with the standard library alone. So the
deployed server has no pandas, pyarrow, numpy, scikit-learn or duckdb in it:
77 MB of dependencies instead of 530.

Streamed rather than loaded, and that is the load-bearing word. The packed
format was columnar first, which is smaller but has to be parsed whole: 1.1
million objects alive before a single record existed, and 402 MB of peak RSS
on a 512 MB instance. Reading one row at a time holds one row.

Two copies of the seed can drift, so `tests/test_pack.py` asserts they have
not, and `tests/test_footprint.py` asserts both the memory budget and that
none of those five libraries is importable from the request path.

**ML is offline, inference is a lookup.** Models are trained in `backend/ml/`
and their *outputs* are written back into the seed. The API never runs
scikit-learn on the request path; it serves the artifacts and the joined
columns. The model files are kept so the analytics page can show how they were
validated.

**One contract.** `docs/API.md` is the single source of truth for the HTTP
surface. Pydantic models on the backend and TypeScript types on the frontend
both mirror it.

## Where a piece of behaviour lives

Adding a mode touches five places and no others:

1. `pipeline/`: any new seed table it needs
2. `ml/`: any model it draws on
3. `app/engine/<mode>.py`: the rules (state, legal moves, scoring)
4. `app/models/<mode>.py`: the wire shapes
5. `app/api/<mode>.py`: a thin router, plus an entry in the `/api/modes` menu

Two smaller conventions keep the seams clean:

* **Presentation lives with the data it describes.** `data/catalog.py` turns a
  contender into its wire shape; `data/people.py` turns an actor into an
  `ActorCard`. Routers never assemble a payload field by field.
* **Persistence lives in a repository.** `api/deps.py` holds `GameRepository`
  (the Oscars mode) and `SideGameRepository` (Recast, the Grid and the Chain).
  They are the only code that knows a round is a JSON blob in SQLite.

## Derived, not stored

The three side modes store only a seed and the player's decisions. The grid's
board, the recast's shortlists and the chain's pair of films are all pure
functions of the seed, rebuilt on demand. That is what makes a daily board
identical for everyone, and it makes it impossible for stored state to
disagree with the generator.

The chain is the case that shows why this is worth the rebuild cost. Its board
is *searched for* rather than looked up, so a stored copy would be a second
answer to a question the generator can already answer, and the two could drift.
Rebuilding also means the reveal's shortest route is recomputed rather than
remembered, which is why the search has to return the same route every time
(`docs/GAME_DESIGN.md` §10).

## Repository layout

```
.
├── backend/
│   ├── app/
│   │   ├── api/        thin routers + dependencies + repositories
│   │   ├── engine/     pure rules, one module per mode
│   │   ├── models/     Pydantic schemas
│   │   ├── data/       in-memory catalogs and their wire conversions
│   │   └── core/       settings, database
│   ├── pipeline/       download → build_seed → people_graph → rescore → enrich → pack
│   ├── ml/             train_ranker · cluster · actors · validate · rolling ·
│   │                   calibrate · evaluate
│   ├── tests/          pytest: engine units, API integration, artifacts
│   └── pyproject.toml
├── frontend/           Vite + React + TS
├── data/
│   ├── raw/            (gitignored) bulk downloads
│   ├── seed/           (committed) films, contenders, actors, costars, …
│   └── models/         (committed) joblib artifacts + metrics json
├── docs/               design, data, ML, balance, deployment, API contract
├── Dockerfile          production image (~200 MB; no pandas, no sklearn)
├── render.yaml         API deployment blueprint
└── .github/workflows/  ci.yml · refresh-data.yml · pages.yml
```

## Branching model

* `main` is releasable. It receives merges from `develop`, plus data-only
  commits from the scheduled refresh.
* `develop` is the integration branch.
* `feature/<area>` is one branch per area, merged with `--no-ff` so the history
  shows each feature as a unit.
