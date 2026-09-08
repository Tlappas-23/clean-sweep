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

/**
 * The 0-100 strength metrics carried on a card (ceremony is results-only).
 *
 * Four of these are *scored*: `audience`, `critics`, `popularity` and
 * `box_office` feed the pick score alongside the hidden ceremony metric.
 * `prestige` does not. It is the ranker's estimated probability that a
 * contender won, and a player's record should not depend on what a model
 * guessed, so it travels as an informational hint only: shown on the card,
 * clearly labelled, and absent from `PickResult.metric_breakdown` and from
 * `/api/meta`'s `metrics` list. The evidence that it is worth showing at all
 * is the validation report (`GET /api/analytics/validation`,
 * `ValidationReport` below).
 *
 * `audience` and `critics` are two separate readings of the same question,
 * kept apart because they disagree often enough to be worth reading
 * separately: `audience` is the IMDb rating, `critics` is Rotten Tomatoes and
 * Metascore averaged. `critics` is null far more often than the rest, since
 * those columns are backfilled against a daily API quota.
 *
 * `box_office` is a percentile of *measured* revenue only: a film whose
 * revenue is estimated (see `ContenderStats.box_office_est_usd`) still has a
 * null here, on purpose.
 */
export interface ContenderMetrics {
  audience: number | null;
  critics: number | null;
  popularity: number | null;
  box_office: number | null;
  /** Model estimate. Shown, never scored. */
  prestige: number | null;
}

/**
 * Raw stats shown on the card in classic mode; null in cinephile mode.
 *
 * Nulls are normal here even in classic mode: measured box office covers
 * about three quarters of the catalog and that average hides the shape (98%
 * of the 2000s, a third of the 1950s), budget about 65%, and the Rotten
 * Tomatoes / Metacritic columns are backfilled against a daily API quota, so
 * they are usually absent. The UI has to make a missing number look
 * deliberate rather than broken.
 *
 * Box office arrives in two separate columns rather than one number plus a
 * flag, so "is this figure real?" cannot be answered wrongly by accident:
 * `box_office_usd` is measured, `box_office_est_usd` is estimated and only
 * ever present where no measurement exists. The two are never both set. The
 * UI must never present the estimate as a measurement.
 */
export interface ContenderStats {
  imdb_rating: number | null;
  imdb_votes: number | null;
  /** Measured worldwide revenue, or null. */
  box_office_usd: number | null;
  /**
   * Estimated revenue, present only where no measurement exists.
   *
   * Estimated from comparable films of the same year and genre, adjusted for
   * how widely the film is known. Never scored: the `box_office` metric is a
   * percentile of measured revenue, so a film with only an estimate shows a
   * figure here and a dash on that bar.
   */
  box_office_est_usd: number | null;
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
 *
 * `academy` here is the outcome, not a metric. It kept its name when the
 * scored metric became `ceremony`, because the two are different things: this
 * one is a pair of flags about one category, and renaming it would suggest
 * the browse rows carry a score they do not.
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
 * arrives as a single `year_options` entry with `locked: true`, and that year
 * now has to be used (docs/GAME_DESIGN.md §2).
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
  /**
   * The ceremony metric, 0-100.
   *
   * Any number in that range, not one of three. A win in this category is
   * 100 and a nomination in it is at least 60, but a pick that was neither
   * now scores its film's standing across the whole Academy record rather
   * than a flat 0. Use `nominated` and `won_oscar` to say what happened;
   * this number is only the score.
   */
  academy: number;
  nominated: boolean;
  won_oscar: boolean;
  actual_winner: Contender | null; // who really won that year/category
  /**
   * The five *scored* metrics: `ceremony`, `box_office`, `critics`,
   * `audience`, `popularity`. Prestige is deliberately not a key here. It is
   * a model estimate and no part of the score. Read it from
   * `pick.contender.metrics.prestige` if you want to show it.
   */
  metric_breakdown: Record<string, number | null>;
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

/** One feature's single-variable AUC in the leakage audit. */
export interface FeatureAuc {
  feature: string;
  auc: number;
}

/**
 * `GET /api/analytics/validation`: the evidence that the prestige model is
 * worth reporting at all.
 *
 * `RankerSummary` is the model's report card; this is the argument that the
 * card is not an artefact. It answers three separate objections in order: is
 * a feature secretly carrying the answer (`leakage_audit`), could a chance
 * arrangement of a rare label produce this score (`permutation_test`), and
 * does the model beat what a person could do with one obvious number
 * (`baselines`). Written offline by `python -m ml.validate` into
 * `data/models/validation.json`; the endpoint 404s where that file has never
 * been built.
 */
export interface ValidationReport {
  /** What was measured, e.g. "six Academy categories only; genre crowns excluded as circular". */
  scope: string;
  n_rows: number;
  n_winners: number;
  split: { train_below: number; n_train: number; n_test: number };
  /** Single-feature AUCs: any one feature at or above `threshold` would be a leak. */
  leakage_audit: {
    threshold: number;
    n_features: number;
    clean: boolean;
    strongest: FeatureAuc[];
    suspected_leaks: FeatureAuc[];
  };
  /** Held-out ROC-AUC with a bootstrap interval; `n_positives` is why the interval is wide. */
  held_out_auc: {
    point: number;
    ci95: [number, number];
    resamples: number;
    n_positives: number;
  };
  /** The same model against shuffled labels: `p_value` is how often the null matched it. */
  permutation_test: {
    observed_auc: number;
    null_mean_auc: number;
    null_max_auc: number;
    null_sd: number;
    rounds: number;
    p_value: number;
    beats_null: boolean;
  };
  /** Named human-readable rules ("acclaim", "top billing") plus the model itself. */
  baselines: Record<string, { roc_auc: number; average_precision: number; n: number }>;
  /** Model AUC minus the strongest baseline's AUC. */
  beats_best_baseline_by: number;
  /** How long the harness took; informational, absent on older artifacts. */
  duration_seconds?: number;
  verdict: string; // "signal confirmed"
}

/* ---- Request bodies / query params ------------------------------------ */

/**
 * The only skip left. The year skip was replaced by the per-round reroll
 * (`POST /api/games/{id}/reroll`), which takes no body at all.
 */
export type SkipKind = "category";

/**
 * Accepted values for `?sort=` on the candidates and catalog endpoints.
 *
 * `prestige` survives here even though it is no longer scored: ordering a
 * pool by what the model thinks is a useful way to read it, which is a
 * different question from whether it should count towards a record.
 */
export type CandidateSort =
  | "audience"
  | "critics"
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

/* ======================================================================= *
 * Game-mode menu + Six Degrees                                            *
 *                                                                         *
 * Everything below mirrors the "Game modes" and "Six Degrees" sections of  *
 * docs/API.md. It is kept in one contiguous block at the end of the file   *
 * so the Oscars contract above it is never reshuffled.                     *
 *                                                                         *
 * `ActorCard` and `FilmCard` are deliberately *shared* shapes: the backend  *
 * puts them in `app/models/people.py` precisely so the two side modes       *
 * cannot drift apart on what an actor or a film looks like on the wire.     *
 * ======================================================================= */

/**
 * One entry in the game-mode menu (`GET /api/modes`).
 *
 * `available` is the whole reason this endpoint exists rather than a
 * hardcoded client-side list. The two side modes read seed tables that the
 * core pipeline does not build, so a checkout that has only run `build_seed`
 * should see them listed and visibly disabled rather than have them 503 on
 * click. The menu therefore comes from the server, which is the only thing
 * that knows whether those tables are there.
 */
export interface ModeCard {
  id: "oscars" | "recast" | "grid";
  label: string;
  tagline: string;
  description: string;
  /** False when the mode's tables have not been built. */
  available: boolean;
  /** Client route that starts the mode, e.g. "/grid". */
  path: string;
}

/**
 * An actor as the side modes show them.
 *
 * `casting_type` is a cluster label from the actor clustering (docs/ML.md):
 * "Marquee Lead", "Character Actor" and so on. It is flavour rather than
 * scoring: the grid shows it under the name because knowing that a column is
 * a jobbing character actor is a real hint about who might have crossed their
 * path.
 */
export interface ActorCard {
  person_id: string;
  name: string;
  n_films: number;
  first_year: number;
  last_year: number;
  /** Share of their credits that are leading parts, 0-1. */
  lead_share: number;
  top_genres: string[];
  /** Cluster label from the actor model, or null when it has not been run. */
  casting_type: string | null;
}

/** A film as the side modes show them. */
export interface FilmCard {
  film_id: string;
  title: string;
  year: number;
  /** Fully-qualified TMDB poster (w342), or null if the film has none. */
  poster_url: string | null;
  genres: string[];
}

/**
 * One route through a cell: who, the two films that prove it, and its score.
 *
 * `films` is always exactly two, ordered the way the chain reads: the film
 * shared with the row actor, then the film shared with the column actor. They
 * travel with the actor rather than alongside them because a name on its own
 * is an assertion; the pair of films is what makes it checkable.
 */
export interface GridLink {
  actor: ActorCard;
  films: FilmCard[];
  /** 0-100. The more obscure the connector, the higher. */
  score: number;
}

/**
 * One side of a cell, opened up in exchange for points.
 *
 * The film is the cell's *best-known* connector's, never the rarest one. That
 * is deliberate: the rare link is what the scoring exists to reward, so
 * selling it at a fixed price would make the hint the answer. A hint is meant
 * to open the door to the obvious route instead.
 *
 * `actor` is the header actor the revealed film links to, carried as a name
 * so the UI can say which side was bought without looking the header up.
 */
export interface GridHint {
  side: "row" | "column";
  /** The header actor that side links to, for context. */
  actor: string;
  film: FilmCard;
}

/**
 * One intersection of the board.
 *
 * A cell carries only what the player put in it, plus what they paid to see.
 * The answer key is absent by construction, since it appears in
 * `GridCellResult` and nowhere else. That is the structural reason a board in
 * play cannot leak its own answers, and it is why a hint has to be bought a
 * side at a time rather than being derivable from this shape.
 */
export interface GridCell {
  row: number;
  column: number;
  /**
   * What the player put here, if anything, with its proof.
   *
   * The link arrives with the answer rather than only in the reveal: naming
   * someone correctly should show you *why* they count while the board is
   * still in front of you.
   */
  link: GridLink | null;
  /** Hints bought on this cell, in the order taken. At most two. */
  hints: GridHint[];
  /**
   * What those hints will cost this cell when it is answered.
   *
   * Pending rather than spent: it is subtracted from whatever the answer
   * earns, with a floor of zero, so a hinted right answer still beats an
   * empty square. Once the cell is answered, `link.score` is already net of
   * it and this number is only history.
   */
  hint_penalty: number;
}

export interface GridState {
  id: string;
  seed: string | null; // e.g. "2026-09-07" for the daily board
  status: "playing" | "complete";
  /** Three actors down the side. */
  rows: ActorCard[];
  /** Three actors across the top. */
  columns: ActorCard[];
  /** Nine cells, row-major. */
  cells: GridCell[];
  /**
   * The authoritative clock, clamped at 0.
   *
   * The client may tick this down locally for display, but it must never let
   * the local number decide anything: the server locks the board at 0 whether
   * or not the client agreed, so every response is a re-sync.
   */
  seconds_remaining: number;
  round_seconds: number;
  created_at: string; // ISO-8601
}

/**
 * A cell after the reveal: what was played, and the two ends of the range.
 *
 * `n_possible` says how many actors bridge the pair, but only two of them are
 * ever sent. They answer different questions: `obvious` is the connection most
 * people would name, which is the one worth remembering and worth the fewest
 * points; `rarest` is the deepest cut that still works, and the one that was
 * worth 100. A wall of everyone in between would teach nothing.
 *
 * On a cell with a single connector the two are the same actor, and the view
 * is expected to notice rather than print them twice.
 */
export interface GridCellResult {
  row: number;
  column: number;
  row_actor: string;
  column_actor: string;
  /** What the player put here, if anything. */
  played: GridLink | null;
  /** How many actors actually connect that pair. */
  n_possible: number;
  /** The best-known actor who links them, worth the floor. */
  obvious: GridLink;
  /** The most obscure actor who links them, worth 100. */
  rarest: GridLink;
  found_rarest: boolean;
}

export interface GridResults {
  game: GridState;
  filled: number;
  total: number;
  /** Sum of the nine cell scores, 0-900. */
  score: number;
  /** Every cell answered with that pair's rarest connector. */
  perfect: boolean;
  cells: GridCellResult[];
}

/**
 * Body of `POST /api/grid/games/{id}/answer`.
 *
 * A typed name rather than an id, because the mode has no autocomplete: a
 * list of matching actors would be a list of the cell's answers. The server
 * resolves the name instead, forgiving case, accents, punctuation, a dropped
 * middle initial and a misspelling, but refusing to guess between two people
 * who share one, which comes back as its own 400.
 */
export interface GridAnswerBody {
  row: number;
  column: number;
  name: string;
}

/**
 * Body of `POST /api/grid/games/{id}/hint`.
 *
 * `side` says which of the cell's two headers the revealed film should link
 * to, so a cell has two hints and no more. Anything other than "row" or
 * "column" is a 400, as is a cell off the board; a cell already answered, or
 * a board already finished, is a 409. Asking again for a hint already bought
 * is not an error: it is free and returns the same film.
 */
export interface GridHintBody {
  row: number;
  column: number;
  side: "row" | "column";
}

/* ======================================================================= *
 * Recast                                                                  *
 *                                                                         *
 * Mirrors the "Recast" section of docs/API.md, appended as its own         *
 * contiguous block so nothing above it moves. The mode reuses `ActorCard`  *
 * and `FilmCard` from the block above rather than redeclaring them: the    *
 * backend serves both side modes from one `app/models/people.py`, and      *
 * duplicating the shapes here is exactly how the two would drift apart.    *
 *                                                                         *
 * What the mode is (docs/GAME_DESIGN.md §8): a film arrives with its       *
 * principal roles in billing order and you replace each one from a         *
 * shortlist drawn from the original actor's *casting type*: a k-means      *
 * cluster over reach, lead share, era, filmography size and genre. The     *
 * cluster is the game: everyone offered plausibly does this kind of work,  *
 * so the decision is which of them fits this particular part.              *
 * ======================================================================= */

/**
 * One part of the film, as it was originally cast.
 *
 * `is_lead` is the server's judgement (billing 1 or 2), not something the
 * client should recompute from `billing`. The threshold is an engine
 * constant and the UI must not hold a second opinion about it.
 */
export interface RoleCard {
  /** 1 = top billed. Roles arrive in billing order. */
  billing: number;
  /** The character's name, or null where the credit has none. */
  character: string | null;
  /** Who actually played it. */
  original: ActorCard;
  is_lead: boolean;
}

/** A role the player has already filled: who was in it, who is now. */
export interface CastingPick {
  billing: number;
  character: string | null;
  original: ActorCard;
  replacement: ActorCard;
}

export interface RecastState {
  id: string;
  seed: string | null; // e.g. "2026-09-07" for the daily film
  status: "casting" | "complete";
  /** The film being recast. */
  film: FilmCard;
  /** Three to five principal roles, billing order. */
  roles: RoleCard[];
  /**
   * Index into `roles` of the part being cast, and the count of filled roles.
   * They are the same number. It equals `roles.length` once every part is
   * cast, which is also when `status` becomes "complete".
   */
  current_role: number;
  picks: CastingPick[];
  created_at: string; // ISO-8601
}

/**
 * The four components of a casting's fit, each 0-100.
 *
 * Weighted 0.35 / 0.30 / 0.20 / 0.15 in the order below (docs/GAME_DESIGN.md
 * §8). Gender is deliberately absent: a gender-swapped recast is a creative
 * decision rather than an error, and the data cannot support scoring it as a
 * mismatch.
 */
export interface FitBreakdown {
  /** Can this name carry a part this size? Compared on reach. */
  stature: number;
  /** Do they play parts this size? From their lead share, scored against the role. */
  role_fit: number;
  /** Do they work in this kind of film? */
  genre: number;
  /** Are they plausible contemporaries? The lightest weight of the four. */
  era: number;
}

/**
 * One role after the reveal.
 *
 * `best_available` is the strongest casting *on the shortlist the player was
 * shown*, rebuilt from the round's state as it stood before that pick, not
 * the best actor in the catalog. That is what makes the comparison fair, and
 * it is why the field is nullable: an exhausted cluster can leave a role with
 * no alternatives at all.
 */
export interface CastingResult {
  billing: number;
  character: string | null;
  original: ActorCard;
  replacement: ActorCard;
  /** 0-100, the weighted blend of `breakdown`. */
  fit: number;
  breakdown: FitBreakdown;
  best_available: ActorCard | null;
  best_fit: number | null;
}

export interface RecastResults {
  game: RecastState; // status "complete"
  /** Mean fit across the roles, 0-100. */
  score: number;
  castings: CastingResult[];
  /** `billing` of the best-fitting choice, not an index into `castings`. */
  strongest: number | null;
  /** `billing` of the weakest. */
  weakest: number | null;
}

/** Body of `POST /api/recast/games/{id}/cast`. */
export interface RecastCastBody {
  person_id: string;
}
