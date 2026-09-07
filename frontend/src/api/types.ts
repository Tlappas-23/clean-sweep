// TypeScript mirror of the HTTP contract in docs/API.md.
//
// This file is the frontend half of the "one contract" principle in
// docs/ARCHITECTURE.md: the backend's Pydantic models and these interfaces
// describe the same JSON. Keep field names and nullability identical to the
// doc; do not add UI-only fields here (put those in src/lib or components).

export type Category =
  | "picture"
  | "director"
  | "actor"
  | "actress"
  | "supporting_actor"
  | "supporting_actress";

export type Mode = "classic" | "cinephile";
export type GameStatus = "spinning" | "picking" | "complete";

/** The five 0-100 strength metrics minus Academy, as shown on a card. */
export interface ContenderMetrics {
  acclaim: number | null;
  popularity: number | null;
  box_office: number | null;
  prestige: number | null;
}

/** Raw stats shown on the card in classic mode; null in cinephile mode. */
export interface ContenderStats {
  imdb_rating: number | null;
  imdb_votes: number | null;
  box_office_usd: number | null;
  rt_critic: number | null;
  rt_audience: number | null;
  metascore: number | null;
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
  /** Metrics are null when hidden by the game mode (cinephile). */
  metrics: ContenderMetrics;
  stats: ContenderStats;
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

export interface Spin {
  year: number;
  category: Category;
  decade: string; // "1990s"
}

export interface Pick {
  round: number; // 1-6
  category: Category;
  year: number;
  contender: Contender; // as it was shown when picked (still masked)
}

export interface SkipsRemaining {
  year: number;
  category: number;
}

export interface GameState {
  id: string;
  mode: Mode;
  seed: string | null; // e.g. "2026-09-06" for daily
  status: GameStatus;
  round: number; // 1-6, or 6 when complete
  category_order: Category[]; // current order (skips rotate it)
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
  ballot_strength: number; // 0-600
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

export type SkipKind = "year" | "category";

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
