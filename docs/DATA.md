# Clean Sweep — Data

## Sources

| Source | What we take | Licence / access |
|--------|--------------|------------------|
| [IMDb non-commercial datasets](https://datasets.imdbws.com/) | `title.basics`, `title.ratings`, `title.crew`, `title.principals`, `name.basics` | free, non-commercial, no key |
| [DLu/oscar_data](https://github.com/DLu/oscar_data) | every Academy Award nomination 1927–2025 with IMDb film + nominee IDs | public GitHub CSV |
| TMDB API *(optional)* | poster path (99.9% coverage), revenue (63%), budget (65%) | free key, [Settings → API](https://www.themoviedb.org/settings/api) |
| OMDb API *(optional)* | Rotten Tomatoes critic %, Metascore, US box office | free key (1,000/day), [apikey.aspx](https://www.omdbapi.com/apikey.aspx) |

## Pipeline

```
python -m pipeline.download          # → data/raw/*.tsv.gz + oscars.csv
python -m pipeline.build_seed        # → data/seed/*.parquet   (DuckDB, ~1 min)
python -m pipeline.enrich --tmdb     # optional, fills box_office/budget/poster
python -m pipeline.enrich --omdb     # optional, fills rt_critic/metascore
```

`build_seed` is idempotent and the only step that reads the 1.4 GB raw
TSVs; it streams them through DuckDB so memory stays flat.

## The scheduled refresh

Enrichment is not a one-off. OMDb's free tier caps at 1,000 requests a day and
the catalog holds ~5,700 films, so it is a job that runs a little every day.
`.github/workflows/refresh-data.yml` runs `python -m pipeline.refresh` at
06:20 UTC daily, and the whole pass is:

```
(Mondays only)  download  →  build_seed        picks up new releases + the
                                 │                latest ceremony's results
                replay the cache ┘               restores every past fetch,
                                                 zero requests
                spend today's budget             newest films first
                retrain the models               only if the catalog moved
                validate  →  test  →  commit
```

**Staying inside the quota.** `pipeline.budget` keeps a per-UTC-day ledger of
requests, flushed after every single call, so a second run the same day picks
up the remaining allowance instead of starting from zero. A safety margin is
held back, and if the provider itself reports the limit is gone that answer
outranks the ledger and the day is marked spent. OMDb signals an exhausted
quota with HTTP 401 *and* a JSON body, so the body is parsed before the status
is raised — read as a plain HTTP error it would be cached as "this film has no
data" for films that are perfectly fine.

**Newest first.** The queue is ordered by film year descending. Those are the
films a rebuilt catalog just added, the ones whose box office is still moving,
and the ones players recognise; a day's quota spent on 1931 shorts is a day
wasted.

**Accuracy.** Three mechanisms:

| Risk | Mechanism |
|------|-----------|
| A network blip cached as "no data" | Entries carry a status. A transient error is retried the next day; a confirmed absence is trusted for 90 days |
| Figures going stale | Films from the last 3 years are refreshed weekly, the back catalogue every 180 days |
| An id resolving to the wrong film | The provider's release year is checked against ours (±2 years, since nominees are filed under their Oscar year). A mismatch is flagged and the figures are never written |

Every pass also runs a validator — scores inside 0–100, no negative or
implausible grosses, poster paths well-formed, no poster shared across
different years — and the test suite runs against the refreshed data *before*
anything is committed. A bad refresh fails the job rather than shipping.

The response cache is gitignored (thousands of small files) and carried
between CI runs by `actions/cache`. If it is ever cold, the queue falls back
to the committed seed: a film whose poster or critic score is already in
`films.parquet` is skipped, so a fresh runner does not burn a day re-fetching
what the repository already holds.

Running it by hand:

```bash
cd backend
python -m pipeline.refresh                  # today's budget
python -m pipeline.refresh --rebuild        # + re-download IMDb first
python -m pipeline.enrich --from-cache-only # re-apply cached data, 0 requests
```

## Seed tables (`data/seed/`)

### `films.parquet` — one row per film in any candidate pool
| column | type | notes |
|--------|------|-------|
| film_id | str | IMDb tconst |
| title | str | primaryTitle |
| year | int | Oscar eligibility year for nominees, else IMDb startYear |
| runtime_minutes | int? | |
| genres | list[str] | |
| imdb_rating | float? | |
| imdb_votes | int? | |
| nominations | int | total Oscar nominations (all categories) |
| wins | int | total Oscar wins |
| box_office_usd | float? | TMDB revenue (enrichment) |
| budget_usd | float? | enrichment |
| rt_critic | int? | enrichment |
| rt_audience | int? | enrichment (not in OMDb; reserved) |
| metascore | int? | enrichment |
| poster_path | str? | enrichment |
| main_pool | bool | true if the film is in the year's top-40/nominee pool. Films added only to stock a genre category are false, so they never widen Best Picture or the acting rounds |

### `contenders.parquet` — one row per (category, film[, person])
| column | type | notes |
|--------|------|-------|
| contender_id | str | `<category>:<tconst>` or `<category>:<nconst>:<tconst>` (unique) |
| category | str | picture / director / actor / actress / supporting_actor / supporting_actress / horror / comedy |
| year | int | |
| film_id | str | |
| person_id | str? | |
| person_name | str? | |
| character | str? | from principals `characters` |
| billing | int? | rank among credited cast in the film (1 = top billed) |
| nominated | bool | nominated in **this** category (or a genre-crown runner-up) |
| won | bool | won **this** category (or took the genre crown) |
| prior_nominations | int | person's nominations in any category before this year |
| prior_wins | int | person's wins before this year |
| acclaim | float | 0–100 percentile of imdb_rating within (year, category) pool |
| popularity | float | 0–100 percentile of log(imdb_votes) within (year, category) pool |
| box_office | float? | 0–100 percentile of revenue within pool; null if unknown |

`prestige` and `archetype` live in `ml_scores.parquet` so the ML step can
be re-run without rebuilding the seed.

### `nominations.parquet` — normalised Oscar history (all categories)
`ceremony, year, category_raw, category, film_id, person_id, won`

### `people.parquet`
`person_id, name, birth_year, death_year, professions`

### `ml_scores.parquet` (written by `backend/ml`)
`contender_id, prestige (0–100), archetype (str), cluster_id (int)`

## Candidate pool construction

For each film year 1927–2025:

1. **Films**: `titleType = 'movie'`, not adult, top **40** by `numVotes`,
   plus every film nominated in one of the six Oscar categories that year.
   These are the `main_pool` films.
2. **Picture pool**: those films.
3. **Director pool**: `title.crew.directors` of pool films (∪ nominees).
4. **Lead acting pools**: cast from `title.principals` with
   `category ∈ {actor, actress}` and billing ≤ 4 (∪ nominees).
   `actor` → Best Actor pool, `actress` → Best Actress pool.
5. **Supporting pools**: billing 2–10 (∪ nominees).

6. **Genre pools**: the top **14** films of each year tagged `Horror` and
   `Comedy` respectively, by vote count. These are pulled separately because
   the top-40 pool leaves horror far too thin — 11 years contain no horror
   film at all and 25 contain fewer than three. Genre-only additions are
   marked `main_pool = false` and appear in no other category.

A performance nominated as Lead appears in the Supporting pool with
`nominated = false` — picking it there scores as un-nominated, exactly as it
would have on a real ballot.

## The genre crown

The Academy has no horror or comedy award, so Best Horror and Best Comedy get
a derived answer key (`backend/pipeline/crowns.py`). Within each (year, genre)
pool films are ranked by the Bayesian weighted rating IMDb uses for its Top
250:

    WR = (v / (v + m)) * R + (m / (v + m)) * C

`R` and `v` are the film's rating and vote count, `C` is the pool's mean
rating and `m` its median vote count (floored at 1,000). That stops a 7.9 from
900 votes outranking a 7.8 from 900,000 while still rewarding quality over
sheer volume. The top film is written as `won`, the next four as `nominated`,
into the same columns the Oscar rows use — so every consumer downstream
treats all eight categories identically.

## Year semantics

The Oscar `Year` column is the *film* year (the 98th ceremony, held in 2026,
honours 2025 films). Early ceremonies use split years ("1927/28"); we take the
first year. Where a nominee's IMDb `startYear` differs from the Oscar year
(late-December releases, festival premieres) the **Oscar year wins** so the
nomination lands in the pool the game shows.
