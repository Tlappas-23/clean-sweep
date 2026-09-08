# Clean Sweep

**[Play the demo](https://tlappas-23.github.io/clean-sweep/)**

Three film games on one dataset: 76 years of Academy records joined to IMDb
ratings, vote counts, billing and the co-star graph.

> The demo is a static build on GitHub Pages. It has no backend, so it runs on
> the fixture catalogue in `frontend/src/api/mock.ts`, which holds a few dozen
> films. The rules and the scoring are the real ones, computed in the browser.
> For all 4,180 films and 49,826 contenders, clone it and run it locally. See
> [Quick start](#quick-start).

| Mode | The question | Round |
|------|--------------|-------|
| **The Oscars** | Can you build a ballot that sweeps the season? | 8 rounds |
| **Recast** | Who else could have played this part? | 3-5 roles |
| **Six Degrees** | Who connects these two actors? | 3 minutes |

## The Oscars

An Oscar-ballot drafting game, in the spirit of [82-0](https://www.82-0.com).
A slot machine deals three film years. You draft one contender for each of
eight categories. Then an awards-season simulation tells you how many of the
30 stops on the circuit your ballot would have won. Win all thirty and you
have a clean sweep.

Each round offers three years to choose between. You can gamble your one
reroll for a fourth year, but then you are stuck with it.

Six of the eight categories are real Academy Awards. The other two, Best
Horror and Best Comedy, are awards the Academy never created. Those are judged
against a "genre crown" computed from the data instead.

What decides it is the record, not opinion. Three models sit underneath the
game: a gradient-boosted ranker that learns what an Oscar winner looks like, a
clustering that sorts films into archetypes, and a second clustering that
sorts actors into casting types. None of them scores your ballot. That comes
from observable facts plus the actual outcome.

## Recast

A film arrives with its principal roles. You replace each one from a shortlist
drawn from the original actor's casting type, and the round scores how
defensible your casting is on four things: stature, role size, era and genre.

The cluster is the game. Offering the whole catalogue would make each round a
search box, and a random sample would put a 1950s character player up for a
modern franchise lead. Drawing from the cluster means everyone on the
shortlist plausibly does this kind of work, so the decision is which of them
fits this particular part.

## Six Degrees

Three actors down the side, three across the top, and nobody on one axis has
ever worked with anybody on the other. Every cell wants a third actor who made
a film with the row actor and a different film with the column actor.

The rarer the link, the more it scores. Anyone who can name the two header
actors can find the obvious route between them, so the obvious route is worth
the floor of 60, and the most obscure actor who still bridges the pair is
worth 100. There is no autocomplete, because a list of matching actors would
be the answer key. You type the whole name and the server forgives the
spelling.

Boards are searched for rather than sampled and checked, so every cell has at
least three valid answers, and the nine rarest links are always nine different
people, which is what makes a perfect board reachable.

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

The processed seed tables and the trained models are committed, so a fresh
clone plays straight away. No downloads and no API keys.

```bash
git clone https://github.com/Tlappas-23/clean-sweep.git
cd clean-sweep
./scripts/dev.sh          # installs what is missing, then serves on :5173
```

That starts the API on :8000, with its docs at `/docs`, and the client on
http://localhost:5173.

To work on the UI with no Python running, `./scripts/dev.sh --mock` serves the
frontend alone against the in-memory fixture catalogue.

## What is in here

| Path | What it is |
|------|-----------|
| `backend/pipeline/` | Offline build. Streams the IMDb TSVs and the Oscar CSV through DuckDB into small parquet seed tables |
| `backend/ml/` | The three scikit-learn models and their evaluation |
| `backend/app/engine/` | Pure game logic: slot machine, scoring, the 30-ceremony season. No I/O and no framework imports |
| `backend/app/` | FastAPI service over an in-memory catalogue and SQLite |
| `frontend/` | React 19, TypeScript and Vite client |
| `data/seed/` | Committed parquet. 4,180 films from 1950 to 2025, and 49,826 contenders |
| `data/models/` | Committed model artifacts and their metrics |
| `docs/` | Design, architecture, data, ML and the HTTP contract |

## The data

| Source | What it gives | Access |
|--------|---------------|--------|
| [IMDb non-commercial datasets](https://datasets.imdbws.com/) | titles, ratings, vote counts, cast billing, directors | free, no key |
| [DLu/oscar_data](https://github.com/DLu/oscar_data) | every nomination from 1927 to 2025, with IMDb ids for film and nominee | public CSV |
| TMDB and OMDb | box office, Rotten Tomatoes, Metascore | optional free keys |

Candidate pools start as the top 40 films of each year by vote count, unioned
with every film nominated in one of the six categories that year, then
expanded into per-category pools from billing and directing credits. The pool
is therefore full of plausible contenders who were never nominated, which is
what makes knowing the real nominees a genuine edge.

Everything works without the optional keys, but they are worth adding. TMDB
supplies a poster for every film in the catalogue, so the card grid reads as a
wall of artwork rather than a table, plus box office for 77% of films. That
coverage is uneven because the source is, not because the pipeline is: 95% for
films since 2000, 40% before 1970. OMDb adds Rotten Tomatoes and Metascore
under a 1,000-a-day quota, so the pipeline works through the catalogue
most-viewed-first and each day's allowance lands on the films players actually
see. The scorer renormalises its weights over whichever metrics are present,
so scores stay on the same 0-100 scale either way.

The data keeps itself current. A GitHub Actions job runs daily, spends that
day's API allowance on the newest films missing data, refits the models if the
catalogue moved, validates the result, runs the test suite, and only then
commits. [`docs/DATA.md`](docs/DATA.md#the-scheduled-refresh) covers how it
stays inside the quota, and how it avoids caching a network blip as a fact.

Rebuilding from scratch takes about 20 seconds, after the 1.4 GB download:

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

### Prestige ranker

A `HistGradientBoostingClassifier` that predicts whether a contender won its
category, using only features available before the envelope is opened:
billing, IMDb rating and votes, runtime, genre, and the person's prior
nominations and wins. The split is temporal, trained on 1927 to 2018 and
tested on 2019 to 2025.

It is validated adversarially with `python -m ml.validate`, and only on the
six real Academy categories. The genre crowns are computed from model
features, so predicting those would be circular.

| Check | Result |
|-------|--------|
| Held-out ROC-AUC | **0.890**, 95% CI [0.836, 0.938] |
| Leakage audit | clean, strongest single feature 0.81 |
| Permutation test | beats all 199 shuffled-label retrains, **p = 0.005** |
| Best human baseline | acclaim at 0.792, so the model clears it by 0.098 |

| Group | ROC-AUC | Avg precision | hit@1 | hit@5 |
|-------|---------|---------------|-------|-------|
| Academy categories | 0.930 | 0.219 | 0.262 | 0.548 |
| Genre crowns | 0.976 | 0.770 | 0.643 | 1.000 |

Those figures come from the current fit. The daily refresh retrains and
rewrites them, and the Analytics page always shows the latest.

Those two rows are reported separately on purpose. A genre crown is computed
from rating and vote count, both of which are model features, so the model
nearly always gets those right and would otherwise flatter the headline. The
Academy row is the honest one.

A pool holds 51 candidates at the median, and over 300 in a crowded modern
year, so naming the actual winner first try 26% of the time is well clear of
the 2% a random pick would manage. Scores written back into the seed are
out-of-fold, grouped by year, so the model never grades contenders it
memorised.

### Film archetypes

KMeans over rating, votes, runtime and genre, with `k` chosen by silhouette.
Release year is deliberately excluded: with it, the clusters just rediscover
the calendar. Without it they describe the kind of film instead.

Because `k` is chosen by silhouette rather than fixed, the set moves when the
catalogue does. The current fit gives Genre Picture, Blockbuster, Prestige
Drama, Modern Classic, Character Drama and Guilty Pleasure. The Analytics page
renders whatever the latest fit produced, so it is the authority rather than
this list.

### Casting types

A second KMeans, over reach, lead share, era, filmography size and genre. This
is what draws the Recast shortlists.

## How a ballot is scored

Each pick gets four 0-100 metrics. All of them are percentiles computed within
the contender's own film year, so a 1950 performance is judged against 1950
rather than against 2024.

| Metric | Weight | Source |
|--------|--------|--------|
| Academy | 0.60 | 100 won, 60 nominated, 0 otherwise, or the genre crown |
| Acclaim | 0.16 | IMDb rating |
| Box office | 0.14 | measured revenue only. Estimates are shown but never scored |
| Popularity | 0.10 | IMDb vote count |

No model prediction enters the score. Every point comes from an observable
fact plus the actual outcome.

The season is 30 ceremonies with thresholds on a convex curve, so each extra
win is harder than the last. Eight of them are specialists that put 92% of
their weight on a single category. That is what reproduces 82-0's rule that a
deficiency in one category sinks the season. Five perfect slots and one
un-nominated pick tops out at 29-1, and the ceremony you lose is exactly the
one that cared about your weak slot.

The weights and thresholds are calibrated rather than guessed. Over 20,000
simulated draws with `python -m app.engine.calibrate`:

| Ballot | Sweeps the season |
|--------|-------------------|
| Every actual winner and crown | 100% |
| One un-nominated pick among them | 0% |
| Nominees and runners-up only | 0% |

That separation is why the Academy metric carries 0.60. At a lower weight the
three populations overlap and no single threshold satisfies all three rows at
once. [`docs/BALANCE.md`](docs/BALANCE.md) has the full derivation.

## Development

```bash
cd backend && ruff check app ml pipeline tests && python -m pytest -q
cd frontend && npm run typecheck && npm run lint && npm run test -- --run && npm run build
```

Both suites run on every push and pull request, in
`.github/workflows/ci.yml`. `.github/workflows/refresh-data.yml` refreshes the
data on a daily schedule, and `.github/workflows/pages.yml` publishes the
demo.

## Documentation

* [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md), rules, metrics, modes and the circuit
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), layers, boundaries and the branching model
* [`docs/DATA.md`](docs/DATA.md), sources, seed schema and pool construction
* [`docs/BALANCE.md`](docs/BALANCE.md), why every scoring constant is what it is
* [`docs/ML.md`](docs/ML.md), the ranker and both clusterings, with features, leakage guards and results
* [`docs/API.md`](docs/API.md), the HTTP contract both sides mirror

## Licence

MIT. IMDb data is used under its non-commercial licence.
