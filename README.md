# Clean Sweep

**[Play the demo](https://tlappas-23.github.io/clean-sweep/)**

Four film games on one dataset: 76 years of Academy records joined to IMDb
ratings, vote counts, billing and the co-star graph.

> The site is a static build on GitHub Pages talking to the API on Render, so
> it plays the whole catalogue: 4,180 films and 49,826 contenders. It installs
> to a phone's home screen as well, from the browser's share menu.
>
> The API sleeps when nobody is playing, so the first move of the day takes a
> few seconds while it wakes. The page says so rather than showing a spinner.
> See [docs/DEPLOY.md](docs/DEPLOY.md) for how the two halves fit together.

| Mode | The question | Round |
|------|--------------|-------|
| **The Oscars** | How good a ballot can you draft? | 8 rounds |
| **Recast** | Who else could have played this part? | 3-5 roles |
| **Six Degrees** | Who connects these two actors? | 3 minutes |
| **The Chain** | Can you get from this film to that one? | Against the clock |

## The Oscars

A slot machine deals three film years. You draft one contender for each of
eight categories, and every pick is rated 0 to 100 on how good the film
actually is: its Academy record, critics, audience, box office and reach.
Eight picks make a ballot out of 800, and that score is the game. Beat your
last one.

The Academy result is the heaviest single input at 35 per cent, because it is
the only one of the five that is a verdict rather than a measurement. It is
not the whole score, which is the point: a film that lost every award and is
still loved scores like a good film, because it is one.

The ballot then runs a thirty-stop awards circuit, from the regional critics'
circles through the guilds to the Academy itself, which tells you how it would
have fared rather than what it was worth. Taking all thirty is a clean sweep,
an achievement on top of a score rather than the only outcome that counts.

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

## The Chain

Two films are dealt, a start and a target. You move by naming a film that
shares a cast member with the one you are standing on, and the game tells you
which actor made the link. Keep stepping until you arrive.

It is the same co-star graph as Six Degrees, walked from the other side. There
the answer is one name; here it is a route, and there is usually more than one
way through. Every pair is searched for until the shortest route between them
is exactly three films, so three is always the number to beat.

A stopwatch runs the whole way, but it is a tiebreak rather than a threat.
Chains are ranked on arriving first, then on fewest films, and only then on
time, kept as three columns rather than blended into one score: a fast bad
route and a slow good one are not the same achievement. Stop whenever you like
and a shortest route is revealed either way.

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
| `docs/` | Design, architecture, data, ML, deployment and the HTTP contract |

## The data

| Source | What it gives | Access |
|--------|---------------|--------|
| [IMDb non-commercial datasets](https://datasets.imdbws.com/) | titles, ratings, vote counts, cast billing, directors | free, no key |
| [DLu/oscar_data](https://github.com/DLu/oscar_data) | every nomination from 1927 to 2025, with IMDb ids for film and nominee | public CSV |
| TMDB and OMDb | box office, the Rotten Tomatoes critic score, Metascore | optional free keys |

Candidate pools start as the top 40 films of each year by vote count, unioned
with every film nominated in one of the six categories that year, then
expanded into per-category pools from billing and directing credits. The pool
is therefore full of plausible contenders who were never nominated, which is
what makes knowing the real nominees a genuine edge.

Everything works without the optional keys, but they are worth adding. TMDB
supplies a poster for every film in the catalogue, so the card grid reads as a
wall of artwork rather than a table, plus box office for 77% of films. That
coverage is uneven because the source is, not because the pipeline is: 95% for
films since 2000, 40% before 1970. OMDb adds the Rotten Tomatoes critic score
and Metascore under a 1,000-a-day quota, so the pipeline works through the
catalogue most-viewed-first and each day's allowance lands on the films players
actually see. Those two cover 45% of the whole catalogue but about 90% of the
films that come up in play. The scorer renormalises its weights over whichever
metrics are present, so scores stay on the same 0-100 scale either way.

Rotten Tomatoes' *audience* score is not available from either source: OMDb
returns the critic Tomatometer under the name "Rotten Tomatoes" and exposes no
audience figure at all. The audience side of a pick's score is the IMDb rating.

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
python -m pipeline.rescore                # award standing + the percentile metrics
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
| Held-out ROC-AUC | **0.927**, 95% CI [0.894, 0.954] |
| Leakage audit | clean, strongest single feature 0.81 |
| Permutation test | beats all 199 shuffled-label retrains, **p = 0.005** |
| Best human baseline | the IMDb rating percentile at 0.792, so the model clears it by 0.135 |

| Group | ROC-AUC | Avg precision | hit@1 | hit@5 |
|-------|---------|---------------|-------|-------|
| Academy categories | 0.929 | 0.229 | 0.262 | 0.571 |
| Genre crowns | 0.967 | 0.704 | 0.500 | 1.000 |

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

Each pick gets five 0-100 metrics. The last four are percentiles computed
within the contender's own film year, so a 1950 performance is judged against
1950 rather than against 2024.

| Metric | Weight | Source |
|--------|--------|--------|
| Ceremony | 0.35 | 100 won this category, 60 nominated in it, otherwise the film's standing across every Academy category. Or the genre crown |
| Box office | 0.15 | measured revenue only. Estimates are shown but never scored |
| Critics | 0.22 | Rotten Tomatoes critic score and Metascore, averaged |
| Audience | 0.18 | IMDb rating |
| Popularity | 0.10 | IMDb vote count |

No model prediction enters the score. Every point comes from an observable
fact plus the actual outcome.

Ceremony takes the better of two readings, and that is a deliberate change.
Scoring an un-nominated pick as a flat zero says something about the film when
it only says something about one category. Jurassic Park won three Oscars, took
$1.06bn and sits at 8.2 on IMDb, and scored zero on the biggest component of
the score because none of those wins was in a category the game plays. Its
Best Picture pick score went from 39.4 to 44.1, The Dark Knight's from 40.0 to
56.1, Toy Story's from 38.5 to 49.5. Winners barely moved: Schindler's List
went from 99.0 to 99.2. Standing is capped below the 60 a nominee scores, so it
can never overtake a real nomination.

The season is 30 ceremonies with thresholds on a convex curve, so each extra
win is harder than the last. Eight of them are specialists that put 92% of
their weight on a single category, and the ceremony you lose is exactly the one
that cared about your weak slot.

That is 82-0's rule that a deficiency in one category sinks the season, with
one relaxation. The season now discriminates on quality rather than on
nomination. Over 6,000 simulated draws with `python -m ml.calibrate`:

| Ballot | Sweeps the season |
|--------|-------------------|
| Perfect ballot | 1.000 |
| One great un-nominated pick | 0.179 |
| One weak un-nominated pick | 0.000 |
| Six losing nominees | 0.000 |

A weak pick still sinks a season every time. A landmark film the Academy
overlooked no longer does, automatically. That separation is why Ceremony
carries 0.60: dropping the weight was tried and measured, and it lets a great
un-nominated ballot sweep far too often. [`docs/BALANCE.md`](docs/BALANCE.md)
has the full derivation.

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
