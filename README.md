# Clean Sweep

An Oscar-ballot drafting game in the spirit of [82-0](https://www.82-0.com).
A slot machine deals you three film years, you draft a contender for each of
eight categories, and an awards-season simulation tells you how many of the 30
stops on the circuit your ballot would have won. Win all thirty and you have a
**clean sweep**.

Each round offers three years to choose between — or gamble your reroll for a
fourth year you are then stuck with. Six categories are real Academy Awards.
The other two, Best Horror and Best Comedy, are awards the Academy never
created, judged instead against a "genre crown" computed from the data.

The interesting part is what decides it: not opinion, but 76 years of Academy
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
| `data/seed/` | Committed parquet: 4,421 films (1950–2025), 55,297 contenders |
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

Everything works without the optional keys, but they are worth adding. TMDB
supplies a **poster for 99.9% of films** (the card grid reads as a wall of
posters) plus box office for 63% — sparse before 1970, 97% for the 2000s.
OMDb adds Rotten Tomatoes and Metascore under a 1,000/day quota, so the
pipeline works through the catalog most-viewed-first. The scorer renormalises
its weights over whichever metrics are present, so scores stay on the same
0–100 scale either way.

The data keeps itself current: a GitHub Actions job runs daily, spends that
day's API allowance on the newest films missing data, refits the models if the
catalog moved, validates the result, runs the test suite and only then commits.
See [`docs/DATA.md`](docs/DATA.md#the-scheduled-refresh) for how it stays
inside the quota and how it avoids caching a network blip as a fact.

Rebuilding from scratch (~20 seconds after the 1.4 GB download):

```bash
cd backend
python -m pipeline.download
python -m pipeline.build_seed
python -m pipeline.enrich --tmdb --omdb   # optional, needs keys in .env
python -m ml.train_ranker && python -m ml.cluster && python -m ml.evaluate
```

Or let the scheduled job do it:

```bash
python -m pipeline.refresh            # one unattended pass, budget-aware
python -m pipeline.refresh --rebuild  # weekly: re-download IMDb first
```

## The models

**Prestige ranker** — a `HistGradientBoostingClassifier` that predicts, from
features available before the envelope is opened (billing, IMDb rating and
votes, runtime, genre, the person's prior nominations and wins), whether a
contender won its category. Split temporally: trained on 1927–2018, tested on
2019–2025.

| Group | ROC-AUC | Avg precision | hit@1 | hit@5 |
|-------|---------|---------------|-------|-------|
| Academy categories | 0.904 | 0.195 | 0.286 | 0.548 |
| Genre crowns | 0.976 | 0.797 | 0.786 | 1.000 |

The two rows are reported separately on purpose. A genre crown is *computed*
from rating and vote count, both of which are model features, so the model
nearly always gets those right and would otherwise flatter the headline. The
Academy row is the honest one.

Pools hold 40 to 330 candidates, so identifying the actual Oscar winner first
try 29% of the time is well above the 1–2% a random pick would
manage. Scores written back into the seed are out-of-fold (grouped by year) so
the model never grades contenders it memorised.

**Film archetypes** — KMeans over rating, votes, runtime and genre, with `k`
chosen by silhouette. Release year is deliberately excluded: with it the
clusters just rediscover the calendar. Without it they describe the kind of
film — *Prestige Drama*, *Modern Classic*, *Blockbuster*, *Cult Favourite*,
*Character Drama*, *Crowd-Pleaser*, *Genre Picture*.

## How a ballot is scored

Each pick gets five 0–100 metrics, all percentiles computed **within the
contender's own film year** so a 1940 performance is judged against 1940:

| Metric | Weight | Source |
|--------|--------|--------|
| Academy | 0.50 | 100 won, 60 nominated, 0 otherwise (or the genre crown) |
| Prestige | 0.17 | ranker probability, percentile in pool |
| Acclaim | 0.13 | IMDb rating |
| Box Office | 0.12 | revenue (needs enrichment) |
| Popularity | 0.08 | IMDb vote count |

The season is 30 ceremonies with thresholds on a convex curve, so each extra
win is harder than the last. Eight of them are *specialists* that put 92% of
their weight on a single category. That is what reproduces 82-0's rule that a
deficiency in one category sinks the season: five perfect slots and one
un-nominated pick tops out at 29-1, and the ceremony you lose is exactly the
one that cared about your weak slot.

The weights and thresholds are calibrated, not guessed. Over 20,000 simulated
six-year draws (`python -m app.engine.calibrate`):

| Ballot | Sweeps the season |
|--------|-------------------|
| Every actual winner and crown | 100% |
| One un-nominated pick among them | 0% |
| Nominees and runners-up only | 0% |

That separation is exactly why the Academy metric carries 0.50 rather than
0.40. At the lower weight the three populations overlap and no threshold
satisfies all three rows at once. See [`docs/BALANCE.md`](docs/BALANCE.md) for
the full derivation.

## Development

```bash
cd backend && ruff check app ml pipeline tests && python -m pytest -q
cd frontend && npm run typecheck && npm run lint && npm run test -- --run && npm run build
```

Both suites run on every push and pull request (`.github/workflows/ci.yml`),
and `.github/workflows/refresh-data.yml` refreshes the data on a daily
schedule.

## Documentation

* [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — rules, metrics, modes, the circuit
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, boundaries, branching model
* [`docs/DATA.md`](docs/DATA.md) — sources, seed schema, pool construction
* [`docs/BALANCE.md`](docs/BALANCE.md) — why every scoring constant is what it is
* [`docs/ML.md`](docs/ML.md) — both models, features, leakage guards, results
* [`docs/API.md`](docs/API.md) — the HTTP contract both sides mirror

## Licence

MIT. IMDb data is used under its non-commercial licence.
