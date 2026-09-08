# Clean Sweep: Data

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
python -m pipeline.rescore           # recompute the metric columns in place
```

`build_seed` is idempotent and the only step that reads the 1.4 GB raw
TSVs; it streams them through DuckDB so memory stays flat.

`rescore` exists because the metric columns are derived entirely from tables
that are already committed: `films`, `contenders` and `nominations`. When the
*definition* of a metric changes, rebuilding the whole seed to apply it would
mean re-downloading 1.4 GB and re-deriving everything else for no reason, and
would risk the tables drifting out of step with one another. It recomputes
`award_points` and `award_standing` on films, then the joined `award_standing`
and the four percentile metrics on contenders, and writes both tables back in
one pass at the end. A failure part-way through leaves the seed as it was
rather than half-migrated.

## The two critic sources

`critics` is the mean of whichever of Rotten Tomatoes and Metascore is
present, percentiled within the film year. Both are 0-100 critic aggregates
measuring much the same thing, and each is missing for a different set of
films, so averaging whichever exist covers more of the catalogue than either
alone. Films with neither stay null and the scorer renormalises around them,
exactly as it does for missing box office.

Coverage is 45% of the whole catalogue, but roughly 90% of the films players
actually see. That gap is not an accident: enrichment works most-viewed-first,
so a day's quota lands on the films that come up in play rather than on 1931
shorts.

**Rotten Tomatoes' audience score is not available.** OMDb returns the critic
Tomatometer under the name "Rotten Tomatoes" and exposes no audience figure at
all, which is why the `rt_audience` column is empty for every film in the seed.
The audience side of a pick's score is the IMDb rating instead, which is what
the `audience` metric reads. The column is kept in the schema in case a source
for it ever appears.

## Academy standing across every category

`backend/pipeline/awards.py` turns a film's whole Academy record into one
number, `award_standing`, which the scorer uses as the floor under the
`ceremony` metric (see `docs/GAME_DESIGN.md` §3). The seed already held every
nomination in all 55 categories; the old scorer used six of them.

| Step | What it does |
|------|--------------|
| Deduplicate | `nominations.parquet` stores one row per nominee, so a category with four credited producers appears four times. Rows are deduplicated on `(film_id, ceremony, category_raw)` before anything is counted |
| Band the category | Best Picture is not Sound Mixing. Picture, Directing, the four acting awards and Writing are worth 4.0; the senior craft awards (cinematography, editing, original score, art direction, international feature, animated feature) 2.0; everything else 1.5; shorts and documentaries 0, since they are their own films rather than credits on a feature |
| Discount a loss | A losing nomination scores 0.4 of what the win in the same category would |
| Saturate | Points map to a standing through `50 * p / (p + 8)`, so the first Oscar moves a film far more than the ninth. Without it, Ben-Hur would tower over everything else on the board |

The 50 is a ceiling chosen by measurement, not by taste, and it sits below the
60 a nominee scores so standing can never overtake a real nomination. See
[`docs/BALANCE.md`](BALANCE.md) for the grid that fixed it.

One trap worth naming: `nominations.parquet` records `won` as a nullable
boolean holding only `True` and null. A *loss* is null, not `False`. Reading
the column without `fillna(False)` silently drops every losing nomination,
which makes a film like The Shawshank Redemption (seven nominations, no wins)
look as though the Academy ignored it completely.

## The scheduled refresh

Enrichment is not a one-off. OMDb's free tier caps at 1,000 requests a day and
the catalog holds ~5,700 films, so it is a job that runs a little every day.
`.github/workflows/refresh-data.yml` runs `python -m pipeline.refresh` at
06:20 UTC daily, and the whole pass is:

```
(Mondays only)  download  →  build_seed        picks up new releases + the
                                 │                latest ceremony's results
                rescore          │              award standing, then the
                                 │                percentile metrics
                replay the cache ┘               restores every past fetch,
                                                 zero requests
                spend today's budget             newest films first
                retrain the models               only if the catalog moved
                validate  →  test  →  commit
```

`rescore` runs before anything is scored, and before enrichment, because
standing is derived from `nominations.parquet`. A rebuild that picked up a new
ceremony changes it, and a film added today would otherwise carry a standing of
zero and be scored as though the Academy had ignored it.

**Staying inside the quota.** `pipeline.budget` keeps a per-UTC-day ledger of
requests, flushed after every single call, so a second run the same day picks
up the remaining allowance instead of starting from zero. A safety margin is
held back, and if the provider itself reports the limit is gone that answer
outranks the ledger and the day is marked spent. OMDb signals an exhausted
quota with HTTP 401 *and* a JSON body, so the body is parsed before the status
is raised. Read as a plain HTTP error, it would be cached as "this film has no
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

Every pass also runs a validator: scores inside 0–100, no negative or
implausible grosses, poster paths well-formed, no poster shared across
different years. The test suite then runs against the refreshed data *before*
anything is committed. A bad refresh fails the job rather than shipping.

**Where enrichment actually lives.** `build_seed` rewrites `films.parquet`
from the IMDb dumps with blank enrichment columns, so the weekly rebuild would
wipe months of API calls unless something durable holds them. That something
is `data/seed/enrichment.parquet`, which holds one small committed row per
enriched film. It is restored into the freshly built catalog before any
request is made, so a rebuild costs nothing and works on any machine.

This was learnt the hard way: the first scheduled run happened to fall on a
rebuild day, the CI response cache was cold, and the job published a catalog
with 0.1% poster coverage. Two changes came out of it. The enrichment table
removes the cause, and the refresh now treats a *drop* in coverage as fatal.
Enrichment only ever adds data, so a column that shrank means something
destroyed it, and the run refuses to publish rather than committing the
damage.

The response cache is a second, faster layer: gitignored (thousands of small
files) and carried between CI runs by `actions/cache`. Where both have a value
the cache wins, being newer. If it is cold, the queue also falls back to the
seed itself, so a fresh runner does not burn a day re-fetching what the
repository already holds.

Running it by hand:

```bash
cd backend
python -m pipeline.refresh                  # today's budget
python -m pipeline.refresh --rebuild        # + re-download IMDb first
python -m pipeline.enrich --from-cache-only # re-apply cached data, 0 requests
```

## Seed tables (`data/seed/`)

### `films.parquet`: one row per film in any candidate pool
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
| award_points | float | weighted Academy points, banded by category and discounted for a loss (`pipeline/awards.py`). 0 for a film with no Academy record, which is the truth about it rather than missing data |
| award_standing | float | `award_points` mapped onto 0-50 through the saturating curve. This is the floor under the `ceremony` metric |
| box_office_usd | float? | TMDB revenue (enrichment) |
| budget_usd | float? | enrichment |
| rt_critic | int? | enrichment, the Tomatometer |
| rt_audience | int? | always empty: no source exposes it (see [The two critic sources](#the-two-critic-sources)) |
| metascore | int? | enrichment |
| poster_path | str? | enrichment |
| main_pool | bool | true if the film is in the year's top-40/nominee pool. Films added only to stock a genre category are false, so they never widen Best Picture or the acting rounds |

### `contenders.parquet`: one row per (category, film[, person])
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
| audience | float | 0–100 percentile of imdb_rating within (year, category) pool |
| critics | float? | 0–100 percentile of the Rotten Tomatoes / Metascore mean within pool; null if neither is known |
| popularity | float | 0–100 percentile of log(imdb_votes) within (year, category) pool |
| box_office | float? | 0–100 percentile of revenue within pool; null if unknown |
| award_standing | float | joined from the film; the floor under the `ceremony` metric |

`prestige` and `archetype` live in `ml_scores.parquet` so the ML step can
be re-run without rebuilding the seed.

### `nominations.parquet`: normalised Oscar history (all categories)
`ceremony, year, category_raw, category, film_id, person_id, won`

### `people.parquet`
`person_id, name, birth_year, death_year, professions`

### `ml_scores.parquet` (written by `backend/ml`)
`contender_id, prestige (0–100), archetype (str), cluster_id (int)`

## Candidate pool construction

For each film year 1950–2025:

1. **Films**: `titleType = 'movie'`, not adult, top **40** by `numVotes`,
   plus every film nominated in one of the six Oscar categories that year.
   These are the `main_pool` films.

   The catalog starts at **1950**. Awards records go back to 1927, but the
   top-40 rule takes a fixed depth per year regardless of how many notable
   films that year actually had, and before 1950 the remainder is padding:

   | Decade | Films | Under 10k votes |
   |--------|-------|-----------------|
   | 1920s | 174 | 91% |
   | 1930s | 524 | 82% |
   | 1940s | 573 | 71% |
   | 1950s | 594 | 57% |
   | 1970s | 568 | 24% |
   | 1990s | 582 | 6% |

   Dropping pre-1950 lifts the median pool film from ~32k votes to ~70k and
   removes the rounds that felt unplayable. `--min-votes N` trims the same
   padding inside the remaining years (nominees and genre-crown contenders are
   always kept, whatever their vote count, since they are the answer key); it
   is off by default.
2. **Picture pool**: those films.
3. **Director pool**: `title.crew.directors` of pool films (∪ nominees).
4. **Lead acting pools**: cast from `title.principals` with
   `category ∈ {actor, actress}` and billing ≤ 4 (∪ nominees).
   `actor` → Best Actor pool, `actress` → Best Actress pool.
5. **Supporting pools**: billing 2–10 (∪ nominees).

6. **Genre pools**: the top **14** films of each year tagged `Horror` and
   `Comedy` respectively, by vote count. These are pulled separately because
   the top-40 pool leaves horror far too thin: 11 years contain no horror
   film at all and 25 contain fewer than three. Genre-only additions are
   marked `main_pool = false` and appear in no other category.

A performance nominated as Lead appears in the Supporting pool with
`nominated = false`. Picking it there scores as un-nominated, exactly as it
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
into the same columns the Oscar rows use. Every consumer downstream therefore
treats all eight categories identically.

## Year semantics

The Oscar `Year` column is the *film* year (the 98th ceremony, held in 2026,
honours 2025 films). Early ceremonies use split years ("1927/28"); we take the
first year. Where a nominee's IMDb `startYear` differs from the Oscar year
(late-December releases, festival premieres) the **Oscar year wins** so the
nomination lands in the pool the game shows.
