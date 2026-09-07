# Clean Sweep

An Oscar-ballot drafting game in the spirit of [82-0](https://www.82-0.com).
A slot machine deals you a film year, you draft a contender for each of six
Academy Award categories, and an awards-season simulation tells you how many
of the 30 stops on the circuit your ballot would have won. Win all thirty and
you have a **clean sweep**.

The interesting part is what decides it: not opinion, but 98 years of Academy
records joined to IMDb ratings, vote counts and billing, plus a gradient
boosting model that learns what an Oscar winner looks like and a clustering
model that sorts every film into an archetype.

```
┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────┐
│ IMDb bulk   │   │ Oscar CSV    │   │ TMDB / OMDb │   │              │
│ 1.4 GB TSV  │──▶│ 1927-2025    │──▶│ (optional)  │──▶│  pipeline/   │
└─────────────┘   └──────────────┘   └─────────────┘   └──────┬───────┘
                                                              │ parquet
                        ┌─────────────────────────────────────┴──────┐
                        ▼                                            ▼
                 ┌─────────────┐                            ┌────────────────┐
                 │    ml/      │  prestige + archetype ───▶ │  FastAPI app   │
                 │ ranker,     │                            │  pure engine   │
                 │ clustering  │                            └───────┬────────┘
                 └─────────────┘                                    │ JSON
                                                            ┌───────▼────────┐
                                                            │ React + TS UI  │
                                                            └────────────────┘
```

## Quick start

The processed seed tables and trained models are committed, so a fresh clone
plays immediately — no downloads, no API keys.

```bash
git clone https://github.com/Tlappas-23/clean-sweep.git
cd clean-sweep

# Backend  →  http://localhost:8000  (docs at /docs)
python -m venv .venv && .venv/bin/pip install -e "backend[dev]"
cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend →  http://localhost:5173
cd frontend && npm install && npm run dev
```

The frontend also runs standalone against an in-memory fake catalog, which is
handy for UI work with no Python running:

```bash
cd frontend && VITE_API_MOCK=true npm run dev
```

## What is in here

| Path | What it is |
|------|-----------|
| `backend/pipeline/` | Offline build: streams the IMDb TSVs and the Oscar CSV through DuckDB into small parquet seed tables |
| `backend/ml/` | The two scikit-learn models and their evaluation |
| `backend/app/engine/` | Pure game logic — slot machine, scoring, the 30-ceremony season. No I/O, no framework |
| `backend/app/` | FastAPI service over an in-memory catalog and SQLite |
| `frontend/` | React 19 + TypeScript + Vite client |
| `data/seed/` | Committed parquet: 4,546 films, 68,319 contenders, 16,727 nominations |
| `data/models/` | Committed model artifacts and their metrics |
| `docs/` | Design, architecture, data, ML and the HTTP contract |

## The data

| Source | What it gives | Access |
|--------|---------------|--------|
| [IMDb non-commercial datasets](https://datasets.imdbws.com/) | titles, ratings, vote counts, cast billing, directors | free, no key |
| [DLu/oscar_data](https://github.com/DLu/oscar_data) | every nomination 1927–2025 with IMDb ids for film and nominee | public CSV |
| TMDB / OMDb | box office, Rotten Tomatoes, Metascore | optional free keys |

Candidate pools are the top 40 films of each year by vote count, unioned with
every film nominated in one of the six categories that year, then expanded
into per-category pools from billing and directing credits. So the pool is
full of plausible contenders who were never nominated, and knowing who
actually was nominated is a genuine edge.

Everything works without the optional keys. Enrichment only adds the box
office metric; the scorer renormalises its weights over whichever metrics are
present, so scores stay on the same 0–100 scale either way.

Rebuilding from scratch (~20 seconds after the 1.4 GB download):

```bash
cd backend
python -m pipeline.download
python -m pipeline.build_seed
python -m pipeline.enrich --tmdb --omdb   # optional, needs keys in .env
python -m ml.train_ranker && python -m ml.cluster && python -m ml.evaluate
```

## The models

**Prestige ranker** — a `HistGradientBoostingClassifier` that predicts, from
features available before the envelope is opened (billing, IMDb rating and
votes, runtime, genre, the person's prior nominations and wins), whether a
contender won its category. Split temporally: trained on 1927–2018, tested on
2019–2025.

| Task | ROC-AUC | Avg precision | MRR | hit@1 | hit@5 |
|------|---------|---------------|-----|-------|-------|
| Winner | 0.876 | 0.151 | 0.379 | 0.262 | 0.476 |
| Nominee | 0.945 | 0.554 | 0.746 | 0.595 | 0.929 |

Pools hold 40 to 330 candidates, so identifying the actual winner first try a
quarter of the time is well above the 1–2% a random pick would manage. Scores
written back into the seed are out-of-fold (grouped by year) so the model
never grades contenders it memorised.

**Film archetypes** — KMeans over rating, votes, runtime and genre, with `k`
chosen by silhouette. Release year is deliberately excluded: with it the
clusters just rediscover the calendar. Without it the silhouette rises from
0.172 to 0.188 and the groups describe the kind of film — *Prestige Drama*,
*Modern Classic*, *Blockbuster*, *Character Drama*.

## How a ballot is scored

Each pick gets five 0–100 metrics, all percentiles computed **within the
contender's own film year** so a 1940 performance is judged against 1940:

| Metric | Weight | Source |
|--------|--------|--------|
| Academy | 0.50 | 100 won, 60 nominated, 0 otherwise |
| Prestige | 0.17 | ranker probability, percentile in pool |
| Acclaim | 0.13 | IMDb rating |
| Box Office | 0.12 | revenue (needs enrichment) |
| Popularity | 0.08 | IMDb vote count |

The season is 30 ceremonies with thresholds on a convex curve, so each extra
win is harder than the last. Six of them are *specialists* that put 85% of
their weight on a single category. That is what reproduces 82-0's rule that a
deficiency in one category sinks the season: five perfect slots and one
un-nominated pick tops out at 29-1, and the ceremony you lose is exactly the
one that cared about your weak slot.

The weights and thresholds are calibrated, not guessed. Over 20,000 simulated
six-year draws (`python -m app.engine.calibrate`):

| Ballot | Sweeps the season |
|--------|-------------------|
| Six actual winners | 100% |
| Five winners, one un-nominated pick | 0% |
| Six nominees who all lost | 0% |

That separation is exactly why the Academy metric carries 0.50 rather than
0.40. At the lower weight the three populations overlap and no threshold
satisfies all three rows at once.

## Development

```bash
cd backend && ruff check app ml pipeline tests && python -m pytest -q
cd frontend && npm run typecheck && npm run lint && npm run test -- --run && npm run build
```

Both suites run on every push and pull request (`.github/workflows/ci.yml`).

## Documentation

* [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — rules, metrics, modes, the circuit
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, boundaries, branching model
* [`docs/DATA.md`](docs/DATA.md) — sources, seed schema, pool construction
* [`docs/ML.md`](docs/ML.md) — both models, features, leakage guards, results
* [`docs/API.md`](docs/API.md) — the HTTP contract both sides mirror

## Licence

MIT. IMDb data is used under its non-commercial licence.
