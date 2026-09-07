# Clean Sweep — HTTP API contract

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
    acclaim: number | null;      // 0-100, scored
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
   * 100 / 60 / 0. For "horror" and "comedy" this reads the derived genre
   * crown rather than an Academy Award, so 100 means "took the crown" and 60
   * means "a runner-up". The key in `metric_breakdown` stays `academy` for
   * every category; only the meaning changes. UI copy should say "crown" for
   * those two slots.
   */
  academy: number;
  nominated: boolean;                    // or a crown runner-up
  won_oscar: boolean;                    // or took the crown
  actual_winner: Contender | null;       // who really won / was crowned
  metric_breakdown: Record<string, number | null>; // the four SCORED metrics
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
| GET    | `/api/games/{id}/candidates`       | `?year=1994&sort=acclaim&q=han`      | `Contender[]`      |
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
board as a whole is guaranteed to admit nine *distinct* ones, so a full board is
always reachable despite the no-repeat rule. Three minutes, or hand in early.

| Method | Path | Body / query | Returns |
|--------|------|--------------|---------|
| POST | `/api/grid/games` | `?seed=2026-09-07` | `GridState` |
| GET | `/api/grid/games/{id}` | | `GridState` |
| GET | `/api/grid/games/{id}/search` | `?q=hanks&limit=12` | `ActorCard[]` |
| POST | `/api/grid/games/{id}/answer` | `{ row, column, person_id }` | `GridState` |
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

interface GridCell {
  row: number; column: number;
  actor: ActorCard | null;     // the connector the player named, if any
  score: number | null;        // 0-100 once answered
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
  actor: ActorCard | null; score: number | null;
  n_possible: number;          // how many actors actually connect that pair
  best_answer: ActorCard;      // the best-known connector
  /** The proof: [film with the row actor, film with the column actor] */
  best_link_films: [FilmCard, FilmCard];
  found_best: boolean;
}

interface GridResults {
  game: GridState;
  filled: number; total: number;
  score: number;               // 0-900
  perfect: boolean;            // every cell answered with its best connector
  cells: GridCellResult[];
}
```

Rules the server enforces:

* An answer must be someone with a film alongside **both** actors — otherwise
  400 with `"that actor does not connect those two"`.
* Neither of the two actors heading a cell can be the answer to it; they are
  excluded from the answer key when the board is built.
* One connector per board: reusing one is 409.
* A cell cannot be answered twice (409), and a finished board takes no more
  answers (409).
* The clock is authoritative: once `seconds_remaining` hits 0 the board is
  `complete` whether or not the client said so.
* `results` before the board is finished is 409.
* Only each cell's **best** connector is revealed, never the full list — with
  the two films that prove the link.
* `search` matches the whole roster, not just a cell's valid connectors, so a
  wrong name comes back as a rejected answer rather than an empty search.

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
  Academy outcome is never included in a `Contender` at all — the model has
  no field for it — so it cannot leak during play.
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
