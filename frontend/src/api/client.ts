// The `Api` interface: one method per endpoint in docs/API.md.
//
// Everything above this layer (state, pages, components) depends only on
// this interface, never on fetch. Two implementations exist:
//   - src/api/http.ts  → real backend over fetch
//   - src/api/mock.ts  → in-memory fake with the same state rules
// src/api/index.ts picks one from VITE_API_MOCK.

import type {
  BrowseContender,
  CandidatesQuery,
  Category,
  ClusterSummary,
  Contender,
  CreateGameBody,
  GameResults,
  GameState,
  HealthResponse,
  LeaderboardEntry,
  LeaderboardQuery,
  Meta,
  RankerSummary,
  SkipKind,
  ValidationReport,
} from "./types";

/* ---- Game-mode menu + Six Degrees ------------------------------------- *
 * A second `import type` rather than more names on the block above: these
 * shapes belong to the side modes, and keeping their imports, their methods
 * and their docs in their own contiguous blocks means the Oscars contract is
 * never reshuffled to make room for them.                                   */
import type {
  GridAnswerBody,
  GridResults,
  GridState,
  ModeCard,
} from "./types";

/* ---- Recast ----------------------------------------------------------- *
 * Its own import block for the same reason as the one above: the Recast
 * contract arrived after the Grid one and appends rather than reshuffles.
 * `ActorCard` is imported here because Recast reads it too — it is a shared
 * side-mode shape declared once in ./types, never per mode.                */
import type { ActorCard, RecastResults, RecastState } from "./types";

export interface Api {
  /** GET /api/meta */
  getMeta(): Promise<Meta>;
  /** POST /api/games */
  createGame(body: CreateGameBody): Promise<GameState>;
  /** GET /api/games/{id} */
  getGame(id: string): Promise<GameState>;
  /** POST /api/games/{id}/spin */
  spin(id: string): Promise<GameState>;
  /** POST /api/games/{id}/skip — the category skip is the only kind left. */
  skip(id: string, kind: SkipKind): Promise<GameState>;
  /**
   * POST /api/games/{id}/reroll — trade every year on the board for one fresh
   * year that then has to be used. No body; once per round.
   */
  reroll(id: string): Promise<GameState>;
  /** GET /api/games/{id}/candidates — `query.year` narrows to one board year. */
  getCandidates(id: string, query?: CandidatesQuery): Promise<Contender[]>;
  /** POST /api/games/{id}/pick */
  pick(id: string, contenderId: string): Promise<GameState>;
  /** GET /api/games/{id}/results */
  getResults(id: string): Promise<GameResults>;
  /** POST /api/games/{id}/submit */
  submit(id: string, playerName: string): Promise<LeaderboardEntry>;
  /** GET /api/leaderboard */
  getLeaderboard(query?: LeaderboardQuery): Promise<LeaderboardEntry[]>;
  /** GET /api/catalog/years/{year} */
  getCatalogYear(year: number, category?: Category): Promise<BrowseContender[]>;
  /** GET /api/analytics/clusters */
  getClusters(): Promise<ClusterSummary>;
  /** GET /api/analytics/ranker */
  getRanker(): Promise<RankerSummary>;
  /**
   * GET /api/analytics/validation — the adversarial checks behind the ranker
   * (leakage audit, permutation test, bootstrap interval, human baselines).
   * 404s wherever `data/models/validation.json` has never been built.
   */
  getValidation(): Promise<ValidationReport>;
  /** GET /health */
  health(): Promise<HealthResponse>;

  /* ---- Game-mode menu ------------------------------------------------- */

  /**
   * GET /api/modes — the three cards on the mode menu.
   *
   * The server decides which modes are playable, because only it knows
   * whether the side-mode seed tables have been built.
   */
  getModes(): Promise<ModeCard[]>;

  /* ---- Six Degrees ---------------------------------------------------- */

  /** POST /api/grid/games — `seed` (a date) gives everyone the same board. */
  createGridGame(seed?: string): Promise<GridState>;
  /** GET /api/grid/games/{id} — also the way to re-sync the clock. */
  getGridGame(id: string): Promise<GridState>;
  /**
   * POST /api/grid/games/{id}/answer — type a name for one cell.
   *
   * Rejections are the interesting path, and there are four of them: 400 for
   * a name nobody in the catalog has, 400 for a name several people share,
   * 400 for someone real who does not connect the two, and 409 for a cell
   * already answered, an actor already used on this board, or a board that is
   * finished. Each message is worth showing verbatim — they ask the player
   * for different things.
   */
  answerGrid(id: string, body: GridAnswerBody): Promise<GridState>;
  /** POST /api/grid/games/{id}/complete — hand the board in early. */
  completeGrid(id: string): Promise<GridResults>;
  /** GET /api/grid/games/{id}/results — 409 while the board is still in play. */
  getGridResults(id: string): Promise<GridResults>;

  /* ---- Recast --------------------------------------------------------- */

  /**
   * POST /api/recast/games — `seed` (a date) gives everyone the same film.
   *
   * 503 where the side-mode seed tables have never been built; the message
   * carries the commands to run, so it is worth showing verbatim.
   */
  createRecastGame(seed?: string): Promise<RecastState>;
  /** GET /api/recast/games/{id} — the way a shared or reloaded round hydrates. */
  getRecastGame(id: string): Promise<RecastState>;
  /**
   * GET /api/recast/games/{id}/shortlist — the actors offered for the role
   * currently being cast.
   *
   * Drawn from the original actor's casting type and never including the
   * original or anyone already cast, so it changes with every pick. Stable
   * across reloads (the server reseeds a per-role stream), and 409 once every
   * role is filled.
   */
  getRecastShortlist(id: string): Promise<ActorCard[]>;
  /**
   * POST /api/recast/games/{id}/cast — cast the current role.
   *
   * 400 with "that actor is not on this role's shortlist" for anyone else,
   * which is the rejection the UI has to surface verbatim.
   */
  castRecast(id: string, personId: string): Promise<RecastState>;
  /** GET /api/recast/games/{id}/results — 409 until every role is cast. */
  getRecastResults(id: string): Promise<RecastResults>;
}

/**
 * Error thrown by any adapter when the server (or the mock) rejects a call.
 * `detail` carries FastAPI's `{"detail": "..."}` message so the UI can show
 * it verbatim in a toast.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Narrowing helper used by the UI to decide what message to display. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Turn any thrown value into a user-facing string. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.detail;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
