// TypeScript mirror of the HTTP contract in docs/API.md.
//
// This file is the frontend half of the "one contract" principle in
// docs/ARCHITECTURE.md: the backend's Pydantic models and these interfaces
// describe the same JSON. Keep field names and nullability identical to the
// doc; do not add UI-only fields here (put those in src/lib or components).

/**
 * The eight ballot slots, in default draft order.
 *
 * The first six are real Academy Awards. `horror` and `comedy` are categories
 * the Academy never created: they are judged against a "genre crown" derived
 * from the data (top film of the year in that genre scores 100, the next four
 * score 60), which is why the game can demand a *winnable* horror slot in a
 * year the Academy ignored entirely. See docs/GAME_DESIGN.md §1.
 */
export type Category =
  | "picture"
  | "director"
  | "actor"
  | "actress"
  | "supporting_actor"
  | "supporting_actress"
  | "horror"
  | "comedy";

export type Mode = "classic" | "cinephile";
export type GameStatus = "spinning" | "picking" | "complete";

/** The five 0-100 strength metrics minus Academy, as shown on a card. */
export interface ContenderMetrics {
  acclaim: number | null;
  popularity: number | null;
  box_office: number | null;
  prestige: number | null;
}

/**
 * Raw stats shown on the card in classic mode; null in cinephile mode.
 *
 * Nulls are normal here even in classic mode: box office is about 63% covered
 * across the catalog (97% in the 2000s, 17% in the 1920s), budget about 65%,
 * and the Rotten Tomatoes / Metacritic columns are backfilled against a daily
 * API quota, so they are usually absent. The UI has to make a missing number
 * look deliberate rather than broken.
 */
export interface ContenderStats {
  imdb_rating: number | null;
  imdb_votes: number | null;
  box_office_usd: number | null;
  budget_usd: number | null;
  rt_critic: number | null;
  rt_audience: number | null;
  metascore: number | null;
}

/**
 * A person's Oscar record strictly *before* this film year, plus their billing.
 *
 * "Before" is what makes it safe to show while drafting: Tom Hanks going into
 * 1994 reads 2 prior nominations and 1 prior win, which is a real hint without
 * being the answer. Zeroed in cinephile mode and for the film categories
 * (picture / horror / comedy), which have no person at all.
 */
export interface ContenderCareer {
  prior_nominations: number;
  prior_wins: number;
  billing: number | null; // 1 = top billed
}

/** One entry in a candidate pool. Person fields are null for Best Picture. */
export interface Contender {
  contender_id: string; // "picture:tt0111161" or "actor:nm0000209:tt0111161"
  category: Category;
  year: number; // film year (Oscar eligibility year)
  film_id: string; // IMDb tconst
  film_title: string;
  person_id: string | null; // IMDb nconst
  person_name: string | null;
  character: string | null; // role played (acting categories)
  genres: string[];
  runtime_minutes: number | null;
  archetype: string | null; // cluster label, e.g. "Critical Darling"
  /**
   * Fully-qualified TMDB poster (w342), or null if the film has none.
   *
   * Present in BOTH modes on purpose: the poster is identity, not a metric,
   * and recognising a film from its poster is exactly what cinephile mode is
   * testing. Never mask it.
   */
  poster_url: string | null;
  /** Metrics are null when hidden by the game mode (cinephile). */
  metrics: ContenderMetrics;
  stats: ContenderStats;
  career: ContenderCareer;
}

/**
 * A catalog row: `Contender` plus the answer key.
 *
 * `GET /api/catalog/years/{year}` is the one endpoint outside a game, so it
 * has nothing to hide and attaches the Academy outcome (docs/API.md,
 * "BrowseContender"). No in-game response uses this shape: `Contender` itself
 * has no field for the outcome, which is the structural reason a candidate
 * list cannot leak the answer.
 */
export interface BrowseContender extends Contender {
  academy: { nominated: boolean; won: boolean } | null;
}

/** One of the years dealt this round, with the decade the reel landed on. */
export interface YearOption {
  year: number;
  decade: string; // "1990s"
}

/**
 * What is on the board this round.
 *
 * A spin deals three years at once and the pick may come from any of them.
 * Spending the round's reroll throws all three away for one fresh year, which
 * arrives as a single `year_options` entry with `locked: true` — that year now
 * has to be used (docs/GAME_DESIGN.md §2).
 */
export interface Spin {
  category: Category;
  /** The years dealt this round; three normally, one after a reroll. */
  year_options: YearOption[];
  /** True once the reroll was spent: the single remaining year must be used. */
  locked: boolean;
  /** Whether this round can still trade its years for one fresh one. */
  reroll_available: boolean;
}

export interface Pick {
  round: number; // 1-8
  category: Category;
  year: number; // the year actually drafted from
  contender: Contender; // as it was shown when picked (still masked)
}

/**
 * Per-game skip allowance. The old year skip became the per-round reroll,
 * which is tracked on the `Spin` rather than counted here.
 */
export interface SkipsRemaining {
  category: number;
}

export interface GameState {
  id: string;
  mode: Mode;
  seed: string | null; // e.g. "2026-09-06" for daily
  status: GameStatus;
  round: number; // 1-8, stays 8 when complete
  category_order: Category[]; // current order (the category skip rotates it)
  current_spin: Spin | null; // null while status === "spinning"
  skips_remaining: SkipsRemaining;
  picks: Pick[];
  created_at: string; // ISO-8601
}

export interface CeremonyResult {
  name: string; // "New York Film Critics Circle"
  index: number; // 1-30, ascending difficulty
  threshold: number;
  weighted_strength: number; // ballot strength under this ceremony's emphasis
  emphasis: Record<Category, number>;
  won: boolean;
}

export interface PickResult {
  pick: Pick; // contender now fully unmasked
  academy: number; // 0 / 60 / 100
  nominated: boolean;
  won_oscar: boolean;
  actual_winner: Contender | null; // who really won that year/category
  metric_breakdown: Record<string, number | null>; // all five metrics
  pick_score: number; // 0-100
}

export interface GameResults {
  game: GameState; // status "complete"
  ballot_strength: number; // 0-800 (eight slots)
  wins: number; // 0-30
  losses: number;
  clean_sweep: boolean; // wins === 30
  ceremonies: CeremonyResult[];
  picks: PickResult[];
  weakest_category: Category | null;
}

export interface Meta {
  categories: { id: Category; label: string }[];
  modes: { id: Mode; label: string; description: string }[];
  years: { min: number; max: number };
  decades: string[];
  ceremonies: { index: number; name: string; threshold: number }[];
  metrics: { id: string; label: string; description: string }[];
}

export interface LeaderboardEntry {
  id: string;
  player_name: string;
  mode: Mode;
  seed: string | null;
  wins: number;
  ballot_strength: number;
  clean_sweep: boolean;
  created_at: string;
}

export interface ClusterSummary {
  archetypes: {
    label: string;
    size: number;
    centroid: Record<string, number>;
    examples: string[];
  }[];
  /** 2-D PCA projection of a sample of films for a scatter plot. */
  points: {
    film_id: string;
    title: string;
    year: number;
    x: number;
    y: number;
    archetype: string;
  }[];
  features: string[];
}

export interface RankerSummary {
  model: string;
  metrics: {
    roc_auc: number;
    average_precision: number;
    brier: number;
    n_train: number;
    n_test: number;
  };
  feature_importances: { feature: string; importance: number }[];
  calibration: { bin_mean_pred: number; bin_frac_pos: number; count: number }[];
}

/* ---- Request bodies / query params ------------------------------------ */

/**
 * The only skip left. The year skip was replaced by the per-round reroll
 * (`POST /api/games/{id}/reroll`), which takes no body at all.
 */
export type SkipKind = "category";

/** Accepted values for `?sort=` on the candidates and catalog endpoints. */
export type CandidateSort =
  | "acclaim"
  | "popularity"
  | "box_office"
  | "prestige"
  | "title"
  | "person";

export interface CreateGameBody {
  mode: Mode;
  seed?: string;
}

export interface CandidatesQuery {
  /**
   * Which of the years on the board to list. Omitting it returns the pools of
   * every year on the board in one list; a year that is not on the board is a
   * 400.
   */
  year?: number;
  sort?: CandidateSort;
  q?: string;
}

export interface LeaderboardQuery {
  seed?: string;
  limit?: number;
}

export interface HealthResponse {
  status: "ok";
}
