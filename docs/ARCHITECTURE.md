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
│   pages/   Home · Play · Results · Grid · Recast · Leaderboard ·       │
│            Analytics · Browse                                          │
│   api/     typed client, with an in-memory mock adapter                │
│   state/   per-mode stores (context + reducer)                         │
└────────────────────────────────────────────────────────────────────────┘
```

## The four rules the layout enforces

**Engine is pure.** `backend/app/engine/` has no I/O and no framework imports.
Given a round and a catalog it returns a new round or a result. That is what
makes the rules unit-testable against a hand-built fake catalog and what makes
every seeded mode reproducible.

If a router is deciding what something scores or whether a move is legal, the
rule is in the wrong place. Each mode's module owns the whole of its rules:

| Mode | Engine | Router |
|------|--------|--------|
| The Oscars | `engine/game.py` | `api/games.py` |
| Six Degrees | `engine/grid.py` | `api/grid.py` |
| Recast | `engine/recast.py` | `api/recast.py` |

**Data is a build artifact.** Raw sources are never read at request time. The
pipeline produces small columnar seed tables; the backend loads them once into
`app/data/` catalogs and indexes them for the queries each mode makes.

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
  (the Oscars mode) and `SideGameRepository` (Recast and the Grid). They are
  the only code that knows a round is a JSON blob in SQLite.

## Derived, not stored

The two side modes store only a seed and the player's decisions. The grid's
board and the recast's shortlists are pure functions of the seed, rebuilt on
demand. That is what makes a daily board identical for everyone, and it makes
it impossible for stored state to disagree with the generator.

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
│   ├── pipeline/       download → build_seed → people_graph → enrich → refresh
│   ├── ml/             train_ranker · cluster · actors · validate · evaluate
│   ├── tests/          pytest: engine units, API integration, artifacts
│   └── pyproject.toml
├── frontend/           Vite + React + TS
├── data/
│   ├── raw/            (gitignored) bulk downloads
│   ├── seed/           (committed) films, contenders, actors, costars, …
│   └── models/         (committed) joblib artifacts + metrics json
├── docs/               design, data, ML, balance, API contract
└── .github/workflows/  ci.yml · refresh-data.yml
```

## Branching model

* `main` is releasable. It receives merges from `develop`, plus data-only
  commits from the scheduled refresh.
* `develop` is the integration branch.
* `feature/<area>` is one branch per area, merged with `--no-ff` so the history
  shows each feature as a unit.
