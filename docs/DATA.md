# Clean Sweep — Data

## Sources

| Source | What we take | Licence / access |
|--------|--------------|------------------|
| [IMDb non-commercial datasets](https://datasets.imdbws.com/) | `title.basics`, `title.ratings`, `title.crew`, `title.principals`, `name.basics` | free, non-commercial, no key |
| [DLu/oscar_data](https://github.com/DLu/oscar_data) | every Academy Award nomination 1927–2025 with IMDb film + nominee IDs | public GitHub CSV |
| TMDB API *(optional)* | revenue, budget, poster path | free key |
| OMDb API *(optional)* | Rotten Tomatoes critic %, Metascore, box office | free key (1000/day) |

## Pipeline

```
python -m pipeline.download          # → data/raw/*.tsv.gz + oscars.csv
python -m pipeline.build_seed        # → data/seed/*.parquet   (DuckDB, ~1 min)
python -m pipeline.enrich --tmdb     # optional, fills box_office/budget/poster
python -m pipeline.enrich --omdb     # optional, fills rt_critic/metascore
```

`build_seed` is idempotent and the only step that reads the 1.4 GB raw
TSVs; it streams them through DuckDB so memory stays flat.

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
| in_pool | bool | true if the film is in a year pool (not only a nominee lookup) |

### `contenders.parquet` — one row per (category, film[, person])
| column | type | notes |
|--------|------|-------|
| contender_id | str | `<category>:<tconst>` or `<category>:<nconst>:<tconst>` (unique) |
| category | str | picture / director / actor / actress / supporting_actor / supporting_actress |
| year | int | |
| film_id | str | |
| person_id | str? | |
| person_name | str? | |
| character | str? | from principals `characters` |
| billing | int? | rank among credited cast in the film (1 = top billed) |
| nominated | bool | nominated in **this** category for this film |
| won | bool | won **this** category |
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
   plus every film nominated in one of the six game categories that year.
2. **Picture pool**: those films.
3. **Director pool**: `title.crew.directors` of pool films (∪ nominees).
4. **Lead acting pools**: cast from `title.principals` with
   `category ∈ {actor, actress}` and billing ≤ 4 (∪ nominees).
   `actor` → Best Actor pool, `actress` → Best Actress pool.
5. **Supporting pools**: billing 2–10 (∪ nominees).

A performance nominated as Lead appears in the Supporting pool with
`nominated = false` — picking it there scores as un-nominated, exactly as it
would have on a real ballot.

## Year semantics

The Oscar `Year` column is the *film* year (the 98th ceremony, held in 2026,
honours 2025 films). Early ceremonies use split years ("1927/28"); we take the
first year. Where a nominee's IMDb `startYear` differs from the Oscar year
(late-December releases, festival premieres) the **Oscar year wins** so the
nomination lands in the pool the game shows.
