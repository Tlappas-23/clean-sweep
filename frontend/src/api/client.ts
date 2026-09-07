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
} from "./types";

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
  /** GET /health */
  health(): Promise<HealthResponse>;
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
