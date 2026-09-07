# Clean Sweep — HTTP API contract

Base path: `/api`. All bodies are JSON. Errors use FastAPI's default
`{"detail": "..."}` shape with 4xx status codes.

## Shared types

```ts
type Category =
  | "picture" | "director" | "actor" | "actress"
  | "supporting_actor" | "supporting_actress";

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
  archetype: string | null;  // cluster label, e.g. "Critical Darling"
  /** Metrics are null when hidden by the game mode (cinephile) */
  metrics: {
    acclaim: number | null;      // 0-100
    popularity: number | null;   // 0-100
    box_office: number | null;   // 0-100
    prestige: number | null;     // 0-100
  };
  /** Raw stats shown on the card in classic mode; null in cinephile mode */
  stats: {
    imdb_rating: number | null;
    imdb_votes: number | null;
    box_office_usd: number | null;
    rt_critic: number | null;
    rt_audience: number | null;
    metascore: number | null;
  };
}

interface Spin { year: number; category: Category; decade: string; /* "1990s" */ }

interface Pick {
  round: number;             // 1-6
  category: Category;
  year: number;
  contender: Contender;      // as it was shown when picked (still masked)
}

interface GameState {
  id: string;
  mode: Mode;
  seed: string | null;       // e.g. "2026-09-06" for daily
  status: GameStatus;
  round: number;             // 1-6, or 6 when complete
  category_order: Category[];// current order (skips rotate it)
  current_spin: Spin | null; // null while status === "spinning"
  skips_remaining: { year: number; category: number };
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
  academy: number;                       // 0 / 60 / 100
  nominated: boolean;
  won_oscar: boolean;
  actual_winner: Contender | null;       // who really won that year/category
  metric_breakdown: Record<string, number | null>; // all five metrics
  pick_score: number;                    // 0-100
}

interface GameResults {
  game: GameState;                       // status "complete"
  ballot_strength: number;               // 0-600
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
| POST   | `/api/games/{id}/skip`             | `{ kind: "year" \| "category" }`     | `GameState`        |
| GET    | `/api/games/{id}/candidates`       | `?sort=acclaim&q=han`                | `Contender[]`      |
| POST   | `/api/games/{id}/pick`             | `{ contender_id: string }`           | `GameState`        |
| GET    | `/api/games/{id}/results`          |                                      | `GameResults`      |
| POST   | `/api/games/{id}/submit`           | `{ player_name: string }`            | `LeaderboardEntry` |
| GET    | `/api/leaderboard`                 | `?seed=2026-09-06&limit=50`          | `LeaderboardEntry[]` |
| GET    | `/api/catalog/years/{year}`        | `?category=actor`                    | `Contender[]` (unmasked, for browsing) |
| GET    | `/api/analytics/clusters`          |                                      | `ClusterSummary`   |
| GET    | `/api/analytics/ranker`            |                                      | `RankerSummary`    |
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

interface RankerSummary {
  model: string;
  metrics: { roc_auc: number; average_precision: number; brier: number; n_train: number; n_test: number };
  feature_importances: { feature: string; importance: number }[];
  calibration: { bin_mean_pred: number; bin_frac_pos: number; count: number }[];
}
```

## Rules enforced by the server

* `spin` is only valid when `status === "spinning"`.
* `skip` is only valid when `status === "picking"` and the corresponding
  skip count is > 0. A year skip re-spins the year only. A category skip
  moves the current category to the end of `category_order` and spins a new
  category with the same year.
* `pick` requires the contender to be in the current `(year, category)` pool.
  After the 6th pick the status becomes `complete` and results are computed.
* `candidates` and `pick` are only valid while `status === "picking"`.
* `results` is only valid when `status === "complete"`.
* Masking: in `cinephile` mode `metrics.*` and `stats.*` are null on
  candidate responses; Academy outcome is never included until results.
