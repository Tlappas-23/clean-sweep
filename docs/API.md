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
