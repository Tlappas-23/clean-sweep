# Clean Sweep — Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Data pipeline (offline, Python + DuckDB)          backend/pipeline/   │
│                                                                        │
│   IMDb bulk TSVs ─┐                                                    │
│   Oscar CSV ──────┼─► build_seed.py ─► data/seed/*.parquet             │
│   TMDB / OMDb ────┘   (enrich.py, optional API keys)                   │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  parquet (committed, ~few MB)
┌──────────────▼─────────────────────────────────────────────────────────┐
│  ML (offline, scikit-learn)                          backend/ml/       │
│   train_ranker.py  → data/models/ranker.joblib  + data/seed/ml_scores  │
│   cluster.py       → data/models/archetypes.joblib (+ labels in seed)  │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  scores / labels joined at load time
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                   backend/app/      │
│   data/     Catalog: loads seed parquet into memory, indexes by        │
│             (year, category) → contender pool                          │
│   engine/   Pure game logic: slot machine, skips, scoring, season sim  │
│   api/      REST routers (games, catalog, leaderboard, analytics)      │
│   models/   Pydantic schemas shared by API + engine                    │
│   core/     Settings, DB session (SQLite via SQLAlchemy)               │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  JSON over HTTP  (contract: docs/API.md)
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Vite)                frontend/         │
│   pages/   Home · Play · Results · Leaderboard · Analytics             │
│   api/     typed client generated from docs/API.md                     │
│   state/   game store (React context + reducer)                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Design principles

* **Engine is pure.** `backend/app/engine/` has no I/O and no framework
  imports. Given a catalog and a game state it returns a new state. That is
  what makes it unit-testable and what makes the daily seeded mode
  deterministic.
* **Data is a build artifact.** Raw sources are never read at request time.
  The pipeline produces small columnar seed tables; the backend loads them
  once at startup into pandas frames and dict indexes.
* **ML is offline, inference is a lookup.** Models are trained in
  `backend/ml/`, and their *outputs* (a prestige score and an archetype label
  per contender) are written back into the seed. The API never runs
  scikit-learn on the request path. The model files are kept so the
  analytics page can show feature importances and cluster centroids.
* **One contract.** `docs/API.md` is the single source of truth for the
  HTTP surface; Pydantic models on the backend and TypeScript types on the
  frontend both mirror it.
* **Optional enrichment.** Everything works from IMDb + Oscar data alone.
  TMDB/OMDb keys add box office and critic scores; missing columns are
  handled by the scoring weights renormalising over available metrics.

## Repository layout

```
.
├── backend/
│   ├── app/            FastAPI application (see above)
│   ├── pipeline/       download → build_seed → enrich
│   ├── ml/             train_ranker.py, cluster.py, evaluate.py
│   ├── tests/          pytest (engine, api, pipeline units)
│   └── pyproject.toml
├── frontend/           Vite + React + TS
├── data/
│   ├── raw/            (gitignored) bulk downloads
│   ├── seed/           (committed) films, contenders, nominations, people, ml_scores
│   └── models/         (committed) joblib artifacts + metrics.json
├── docs/               this folder
└── .github/workflows/  CI: ruff + pytest + tsc + vite build
```

## Branching model

* `main` — releasable. Only receives merges from `develop`.
* `develop` — integration branch.
* `feature/<area>` — one branch per area (`data-pipeline`, `backend-api`,
  `ml-models`, `frontend`, ...), merged into `develop` with `--no-ff` so
  the history shows each feature as a unit.
