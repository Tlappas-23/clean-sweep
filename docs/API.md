# Clean Sweep: HTTP API contract

Base path: `/api`. All bodies are JSON. Errors use FastAPI's default
`{"detail": "..."}` shape with 4xx status codes.

## Shared types

```ts
type Category =
  | "picture" | "director" | "actor" | "actress"
  | "supporting_actor" | "supporting_actress"
  // Not Academy Awards: judged against a genre crown derived from the data.
  | "horror" | "comedy";

type Mode = "classic" | "cinephile";
type GameStatus = "spinning" | "picking" | "complete";

/**
 * Accepted values of `?sort=` on the candidate and catalog endpoints. The
 * candidates endpoint defaults to "audience". The first five are metric
 * sorts: they reveal ranking information, so cinephile mode refuses them
 * with a 400.
 */
type CandidateSort =
  | "audience" | "critics" | "popularity" | "box_office" | "prestige"
  | "title" | "person";

/** One entry in a candidate pool. Person fields are null for Best Picture. */
interface Contender {
  contender_id: string;      // "picture:tt0111161" or "actor:nm0000209:tt0111161"
  category: Category;
  year: number;              // film year (Oscar eligibility year)
  film_id: string;           // IMDb tconst
  film_title: string;
  person_id: string | null;  // IMDb nconst
  person_name: string | null;
  character: string | null;  // role played (acting categories)
  genres: string[];
  runtime_minutes: number | null;
  archetype: string | null;  // cluster label, e.g. "Prestige Drama"
  /**
   * Fully-qualified TMDB poster (w342), or null if the film has none.
   * Present in BOTH modes: the poster is identity, not a metric, and
   * recognising a film by it is exactly what cinephile mode tests.
   */
  poster_url: string | null;
  /** Metrics are null when hidden by the game mode (cinephile) */
  metrics: {
    audience: number | null;     // 0-100, scored; IMDb rating percentile
    /**
     * 0-100, scored. Rotten Tomatoes critic score and Metascore averaged,
     * then percentiled within the film year. Coverage is 45% of the whole
     * catalogue and about 90% of the films players actually see, because
     * enrichment works most-viewed-first. Null where neither source has a
     * figure, and the scorer renormalises around it.
     */
    critics: number | null;
    popularity: number | null;   // 0-100, scored
    box_office: number | null;   // 0-100, scored; from MEASURED revenue only
    /**
     * 0-100. The ranker's estimate that this contender won. NOT scored - a
     * player's record must not depend on a model's guess. Present as an
     * informational hint, visually separate from the scored metrics.
     */
    prestige: number | null;
  };
  /** Raw stats shown on the card in classic mode; null in cinephile mode */
  stats: {
    imdb_rating: number | null;
    imdb_votes: number | null;
    /** MEASURED revenue, or null. Never an estimate. */
    box_office_usd: number | null;
    /**
     * ESTIMATED revenue, present only where no measurement exists. Show it
     * marked as an estimate; it is deliberately not scored, because it
     * carries no information beyond Popularity (see docs/ML.md §4).
     */
    box_office_est_usd: number | null;
    budget_usd: number | null;
    rt_critic: number | null;
    /** Always null: no source exposes it. See docs/DATA.md. */
    rt_audience: number | null;
    metascore: number | null;
  };
  /**
   * The person's record *before* this film year, so it never leaks the round's
   * outcome. Zeroed in cinephile mode and for film categories.
   */
  career: {
    prior_nominations: number;
    prior_wins: number;
    /** Cast billing, 1 = top billed. Null for directors and film categories. */
    billing: number | null;
  };
}

interface YearOption { year: number; decade: string; /* "1990s" */ }

/** What is on the board this round. */
interface Spin {
  category: Category;
  /** The years dealt this round; a pick may come from any of them. */
  year_options: YearOption[];
  /** True once the reroll was spent: the single remaining year must be used. */
  locked: boolean;
  /** Whether this round can still trade its years for one fresh one. */
  reroll_available: boolean;
}

interface Pick {
  round: number;             // 1-8
  category: Category;
  year: number;              // the year actually drafted from
  contender: Contender;      // as it was shown when picked (still masked)
}

interface GameState {
  id: string;
  mode: Mode;
  seed: string | null;       // e.g. "2026-09-06" for daily
  status: GameStatus;
  round: number;             // 1-8, stays 8 when complete
  category_order: Category[];// current order (the category skip rotates it)
  current_spin: Spin | null; // null while status === "spinning"
  skips_remaining: { category: number };  // the year skip is now the per-round reroll
  picks: Pick[];
  created_at: string;        // ISO-8601
}

interface CeremonyResult {
  name: string;              // "New York Film Critics Circle"
  index: number;             // 1-30, ascending difficulty
  threshold: number;
  weighted_strength: number; // ballot strength under this ceremony's emphasis
  emphasis: Record<Category, number>;
  won: boolean;
}

interface PickResult {
  pick: Pick;                            // contender now fully unmasked
  /**
   * The `ceremony` metric, 0-100. Still 100 for winning the category played
   * and 60 for a nomination in it, but no longer only those three values: an
   * un-nominated pick now carries its film's standing across every Academy
   * category, which is capped below 60 so it can never overtake a nomination.
   * For "horror" and "comedy" the 100 / 60 read the derived genre crown
   * rather than an Academy Award, so 100 means "took the crown" and 60 means
   * "a runner-up". The field is named `academy` for backwards compatibility;
   * the key in `metric_breakdown` is `ceremony`. UI copy should say "crown"
   * for those two slots.
   */
  academy: number;
  nominated: boolean;                    // or a crown runner-up
  won_oscar: boolean;                    // or took the crown
  actual_winner: Contender | null;       // who really won / was crowned
  /** The five SCORED metrics: ceremony, critics, audience, box_office, popularity */
  metric_breakdown: Record<string, number | null>;
  pick_score: number;                    // 0-100
}

interface GameResults {
  game: GameState;                       // status "complete"
  ballot_strength: number;               // 0-800 (eight slots)
  wins: number;                          // 0-30
  losses: number;
  clean_sweep: boolean;                  // wins === 30
  ceremonies: CeremonyResult[];
  picks: PickResult[];
  weakest_category: Category | null;
}
```

## Endpoints

| Method | Path                               | Body / query                         | Returns            |
|--------|------------------------------------|--------------------------------------|--------------------|
| GET    | `/api/meta`                        |                                      | `Meta`             |
| POST   | `/api/games`                       | `{ mode: Mode, seed?: string }`      | `GameState`        |
| GET    | `/api/games/{id}`                  |                                      | `GameState`        |
| POST   | `/api/games/{id}/spin`             |                                      | `GameState`        |
| POST   | `/api/games/{id}/skip`             | `{ kind: "category" }`               | `GameState`        |
| POST   | `/api/games/{id}/reroll`           |                                      | `GameState`        |
| GET    | `/api/games/{id}/candidates`       | `?year=1994&sort=audience&q=han`     | `Contender[]`      |
| POST   | `/api/games/{id}/pick`             | `{ contender_id: string }`           | `GameState`        |
| GET    | `/api/games/{id}/results`          |                                      | `GameResults`      |
| POST   | `/api/games/{id}/submit`           | `{ player_name: string }`            | `LeaderboardEntry` |
| GET    | `/api/leaderboard`                 | `?seed=2026-09-06&limit=50`          | `LeaderboardEntry[]` |
| GET    | `/api/catalog/years/{year}`        | `?category=actor&sort=prestige&q=`   | `BrowseContender[]` |
| GET    | `/api/analytics/clusters`          |                                      | `ClusterSummary`   |
| GET    | `/api/analytics/ranker`            |                                      | `RankerSummary`    |
| GET    | `/api/analytics/validation`        |                                      | `ValidationReport` |
| GET    | `/health`                          |                                      | `{status:"ok"}`    |

### Game modes

`GET /api/modes` returns the menu. Both side modes depend on seed tables the
core pipeline does not build, so a checkout that has only run `build_seed`
sees them listed with `available: false` rather than having them fail on
click.

```ts
interface ModeCard {
  id: "oscars" | "recast" | "grid";
  label: string;
  tagline: string;
  description: string;
  available: boolean;
  path: string;              // client route that starts the mode
}
```

### Six Degrees

Three actors down the side, three across the top, and **no pair on the board has
ever worked together**. Every cell wants a third actor with a film alongside the
row actor and another alongside the column actor. Boards are searched for, not
sampled and checked: every cell is guaranteed at least three connectors, and the
nine *rarest* connectors are guaranteed to be nine different people, so a
perfect 900 is always reachable despite the no-repeat rule. Three minutes, or
hand in early.

**The rarer the link, the more it is worth.** The connection most people would
reach for scores the floor of 60; the most obscure actor who genuinely bridges
the pair scores 100. Everyone who can name the pair can find the obvious route,
so paying the same for it would make the scale say nothing.

| Method | Path | Body / query | Returns |
|--------|------|--------------|---------|
| POST | `/api/grid/games` | `?seed=2026-09-07` | `GridState` |
| GET | `/api/grid/games/{id}` | | `GridState` |
| POST | `/api/grid/games/{id}/answer` | `{ row, column, name }` | `GridState` |
| POST | `/api/grid/games/{id}/hint` | `{ row, column, side }` | `GridState` |
| POST | `/api/grid/games/{id}/complete` | | `GridResults` |
| GET | `/api/grid/games/{id}/results` | | `GridResults` |
| GET | `/api/grid/leaderboard` | `?limit=20` | rows |

```ts
interface ActorCard {
  person_id: string; name: string; n_films: number;
  first_year: number; last_year: number;
  lead_share: number;          // 0-1, share of credits that are leads
  top_genres: string[];
  casting_type: string | null; // cluster label, e.g. "Marquee Lead"
}

interface FilmCard {
  film_id: string; title: string; year: number;
  poster_url: string | null; genres: string[];
}

/** One route through a cell: who, the proof, and what it is worth. */
interface GridLink {
  actor: ActorCard;
  /** Exactly two: [the film with the row actor, the film with the column actor]. */
  films: [FilmCard, FilmCard];
  score: number;               // 0-100; the rarer the connector, the higher
}

/** One side of a cell, opened up in exchange for points. */
interface GridHint {
  side: "row" | "column";
  actor: string;               // the header actor that side links to
  film: FilmCard;
}

interface GridCell {
  row: number; column: number;
  /** What the player put here, with its proof. Present as soon as it is answered. */
  link: GridLink | null;
  /** Hints bought on this cell, in the order taken. */
  hints: GridHint[];
  /** What those hints will cost this cell when it is answered. */
  hint_penalty: number;
}

interface GridState {
  id: string; seed: string | null;
  status: "playing" | "complete";
  rows: ActorCard[]; columns: ActorCard[];
  cells: GridCell[];           // 9, row-major
  seconds_remaining: number;   // clamped at 0; the board locks itself there
  round_seconds: number;
  created_at: string;
}

interface GridCellResult {
  row: number; column: number;
  row_actor: string; column_actor: string;
  played: GridLink | null;     // what the player put here, if anything
  n_possible: number;          // how many actors actually connect that pair
  obvious: GridLink;           // the best-known link, worth the floor
  rarest: GridLink;            // the most obscure link, worth 100
  found_rarest: boolean;
}

interface GridResults {
  game: GridState;
  filled: number; total: number;
  score: number;               // 0-900
  perfect: boolean;            // every cell answered with its rarest connector
  /** Why the round stopped. */
  ended: "filled" | "handed_in" | "time";
  cells: GridCellResult[];
}
```

Rules the server enforces:

* A name is resolved to an actor first; an unknown name is 400 with `"no actor
  in the catalog goes by that name"`, and an ambiguous one is 400 with
  `"several actors share that name; type it in full"`.
* The resolved actor must have a film alongside **both**. If not, it is a 400
  with `"that actor does not connect those two"`.
* Neither of the two actors heading a cell can be the answer to it; they are
  excluded from the answer key when the board is built.
* One connector per board: reusing one is 409.
* A cell cannot be answered twice (409), and a finished board takes no more
  answers (409).
* The clock is authoritative: once `seconds_remaining` hits 0 the board is
  `complete` whether or not the client said so, and it takes no further
  answers or hints. Nothing has to hand it in, so a client that was closed or
  asleep cannot keep playing a round that finished. Whatever was solved before
  the clock went still scores.
* Clients should hold `seconds_remaining` as a **deadline**, not a countdown.
  A timer decremented once a second drifts behind real time whenever the
  browser throttles it, which it does in a background tab, so a player who
  switches away returns to a clock showing time left on a board the server
  finished minutes ago. Re-sync on `visibilitychange` for the same reason.
* `results` before the board is finished is 409.
* Only **two** of a cell's connectors are revealed, never the list between
  them: the obvious route and the rarest. Each carries the two films that
  prove it, so the reveal shows a chain rather than asserting a name.
* An answered cell carries its own proof immediately, in `GridCell.link`.
  Naming someone correctly shows *why* they count while the board is still in
  play, not only at the reveal.
**Hints.** A cell has two sides, so it has two hints. Each names a film that
the cell's *best-known* connector shares with one header actor. It is
deliberately the obvious route rather than the rare one: paying for a hint
should open the door, not hand over the answer the scoring exists to reward.

| Hints taken | The cell is docked |
|-------------|--------------------|
| 0 | 0 |
| 1 | 15 |
| 2 | 35 |

The deduction applies when the cell is answered, and a cell never goes below
zero, so a hinted right answer still beats an empty square. Asking again for a
hint already bought is free and returns the same film. A hint is refused on a
cell that is already answered (409), off the board (400), or for a side other
than `row` or `column` (400).

* **There is no search endpoint, by design.** A list of actors matching what
  the player is typing is a list of the cell's answers, so the mode has no
  autocomplete. An answer is the name as typed, and the server resolves it.

Name resolution (`resolve_actor`) forgives, strictest first:

| Typed | Resolves to | Because |
|-------|-------------|---------|
| `samuel l jackson` | Samuel L. Jackson | case, accents and punctuation normalised |
| `SAMUEL JACKSON` | Samuel L. Jackson | every word typed is one of theirs |
| `leonardo dicapro` | Leonardo DiCaprio | close enough on the whole string |
| `Meryl Strep` | Meryl Streep | one word misspelt, the rest exact |
| `jackson` | *400* | several actors share it; it will not guess |
| `Zxqv Nonsuch` | *400* | nobody by that name |

The two 400s are worded differently on purpose: "type it in full" and "no
actor in the catalog goes by that name" ask the player for different things.

### Recast

| Method | Path | Body / query | Returns |
|--------|------|--------------|---------|
| POST | `/api/recast/games` | `?seed=2026-09-07` | `RecastState` |
| GET | `/api/recast/games/{id}` | | `RecastState` |
| GET | `/api/recast/games/{id}/shortlist` | | `ActorCard[]` |
| POST | `/api/recast/games/{id}/cast` | `{ person_id }` | `RecastState` |
| GET | `/api/recast/games/{id}/results` | | `RecastResults` |

```ts
interface RoleCard {
  billing: number;             // 1 = top billed
  character: string | null;
  original: ActorCard;
  is_lead: boolean;
}

interface CastingPick {
  billing: number; character: string | null;
  original: ActorCard; replacement: ActorCard;
}

interface RecastState {
  id: string; seed: string | null;
  status: "casting" | "complete";
  film: FilmCard;
  roles: RoleCard[];           // 3-5, billing order
  current_role: number;        // index into roles; == roles.length when done
  picks: CastingPick[];
  created_at: string;
}

/** Each component 0-100. See docs/GAME_DESIGN.md for what they mean. */
interface FitBreakdown {
  stature: number; role_fit: number; genre: number; era: number;
}

interface CastingResult {
  billing: number; character: string | null;
  original: ActorCard; replacement: ActorCard;
  fit: number;                 // 0-100
  breakdown: FitBreakdown;
  best_available: ActorCard | null;  // strongest casting on that shortlist
  best_fit: number | null;
}

interface RecastResults {
  game: RecastState;
  score: number;               // mean fit across the roles, 0-100
  castings: CastingResult[];
  strongest: number | null;    // billing of the best-fitting choice
  weakest: number | null;
}
```

Rules the server enforces:

* `cast` only accepts someone on the current role's shortlist (400 otherwise).
* A shortlist never offers the original actor or anyone already cast.
* `shortlist` and `cast` are 409 once every role is filled; `results` is 409
  until then.
* Shortlists are stable: the same round reloaded shows the same names.
* Either mode returns **503** when the side-mode seed tables have not been
  built, with the commands to run.

```ts
interface Meta {
  categories: { id: Category; label: string }[];
  modes: { id: Mode; label: string; description: string }[];
  years: { min: number; max: number };
  decades: string[];
  ceremonies: { index: number; name: string; threshold: number }[];
  metrics: { id: string; label: string; description: string }[];
}

interface LeaderboardEntry {
  id: string; player_name: string; mode: Mode; seed: string | null;
  wins: number; ballot_strength: number; clean_sweep: boolean; created_at: string;
}

interface ClusterSummary {
  archetypes: { label: string; size: number; centroid: Record<string, number>; examples: string[] }[];
  /** 2-D PCA projection of a sample of films for a scatter plot */
  points: { film_id: string; title: string; year: number; x: number; y: number; archetype: string }[];
  features: string[];
}

/** The evidence that the ranker is not an artefact. See docs/ML.md §3. */
interface ValidationReport {
  scope: string;                 // Academy categories only; genre crowns excluded
  n_rows: number; n_winners: number;
  split: { train_below: number; n_train: number; n_test: number };
  leakage_audit: {
    threshold: number; n_features: number; clean: boolean;
    strongest: { feature: string; auc: number }[];
    suspected_leaks: { feature: string; auc: number }[];
  };
  held_out_auc: { point: number; ci95: [number, number]; resamples: number; n_positives: number };
  permutation_test: {
    observed_auc: number; null_mean_auc: number; null_max_auc: number;
    null_sd: number; rounds: number; p_value: number; beats_null: boolean;
  };
  baselines: Record<string, { roc_auc: number; average_precision: number; n: number }>;
  beats_best_baseline_by: number;
  verdict: string;
}

interface RankerSummary {
  model: string;
  metrics: { roc_auc: number; average_precision: number; brier: number; n_train: number; n_test: number };
  feature_importances: { feature: string; importance: number }[];
  calibration: { bin_mean_pred: number; bin_frac_pos: number; count: number }[];
}
```

## Rules enforced by the server

* `spin` is only valid when `status === "spinning"`. It deals three distinct
  years, all of which are winnable in the dealt category.
* `reroll` is only valid when `status === "picking"` and
  `current_spin.reroll_available` is true. It replaces every year on the board
  with a single fresh one and sets `locked`, so that year must be used. The
  new year is guaranteed **not** to be one of the years it discarded. Once per
  round; a new round restores it.
* `skip` is only valid when `status === "picking"` and the category skip is
  unspent. It moves the current category to the end of `category_order` and
  deals a fresh set of years for the next category, keeping the round's
  reroll.
* `pick` requires the contender to be in the dealt category and in one of the
  years on the board. After the last pick the status becomes `complete` and
  results are computed.
* `candidates` and `pick` are only valid while `status === "picking"`.
  `?year=` must name a year on the board; omitting it returns every year on
  the board in one list.
* `results` is only valid when `status === "complete"`.
* Masking: in `cinephile` mode `metrics.*`, `stats.*` and `archetype` are
  null on candidate responses, and `?sort=` by a metric returns 400. The
  Academy outcome is never included in a `Contender` at all. The model has no
  field for it, so it cannot leak during play.
* `submit` requires a completed game and accepts one entry per game (a second
  submission is a 409).

### `BrowseContender`

The catalog-browse endpoint sits outside a game and has nothing to hide, so
it returns a `Contender` with the answer key attached. It is the only place
this shape appears.

```ts
interface BrowseContender extends Contender {
  academy: { nominated: boolean; won: boolean } | null;
}
```
