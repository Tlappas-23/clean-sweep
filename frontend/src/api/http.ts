// Fetch-based implementation of the `Api` interface (src/api/client.ts).
//
// Talks to the FastAPI backend described in docs/API.md. In development the
// Vite proxy forwards `/api` and `/health` to localhost:8000, so the base
// URL is empty (same origin) unless VITE_API_BASE overrides it.

import type { Api } from "./client";
import { ApiError } from "./client";
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
/* ---- Game-mode menu + Six Degrees types (own block, see client.ts) ----- */
import type {
  GridAnswerBody,
  GridResults,
  GridState,
  ModeCard,
} from "./types";
/* ---- Recast types (own block, see client.ts) --------------------------- */
import type { ActorCard, RecastResults, RecastState } from "./types";

/** Build a query string, dropping undefined / empty values. */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/**
 * Shared request helper. Parses the FastAPI error envelope so callers
 * always get an `ApiError` with a human-readable `detail`.
 */
async function request<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    });
  } catch {
    // Network failure (backend down, offline). Status 0 signals "no response".
    throw new ApiError(0, "Could not reach the server.");
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      // FastAPI validation errors return `detail` as an array of objects.
      else if (Array.isArray(body.detail)) detail = "Invalid request.";
    } catch {
      /* non-JSON error body; keep the status text */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export function createHttpApi(base = ""): Api {
  const get = <T>(path: string) => request<T>(base, path);
  const post = <T>(path: string, body?: unknown) =>
    request<T>(base, path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    getMeta: () => get<Meta>("/api/meta"),
    createGame: (body: CreateGameBody) => post<GameState>("/api/games", body),
    getGame: (id) => get<GameState>(`/api/games/${encodeURIComponent(id)}`),
    spin: (id) => post<GameState>(`/api/games/${encodeURIComponent(id)}/spin`),
    skip: (id, kind: SkipKind) =>
      post<GameState>(`/api/games/${encodeURIComponent(id)}/skip`, { kind }),
    // The reroll takes no body: which years it throws away is entirely
    // server-side state, so there is nothing for the client to name.
    reroll: (id) => post<GameState>(`/api/games/${encodeURIComponent(id)}/reroll`),
    getCandidates: (id, query: CandidatesQuery = {}) =>
      get<Contender[]>(
        // `year` is omitted for the "all years on the board" view, which is
        // exactly what the endpoint does with no year param.
        `/api/games/${encodeURIComponent(id)}/candidates${qs({ year: query.year, sort: query.sort, q: query.q })}`,
      ),
    pick: (id, contenderId) =>
      post<GameState>(`/api/games/${encodeURIComponent(id)}/pick`, {
        contender_id: contenderId,
      }),
    getResults: (id) =>
      get<GameResults>(`/api/games/${encodeURIComponent(id)}/results`),
    submit: (id, playerName) =>
      post<LeaderboardEntry>(`/api/games/${encodeURIComponent(id)}/submit`, {
        player_name: playerName,
      }),
    getLeaderboard: (query: LeaderboardQuery = {}) =>
      get<LeaderboardEntry[]>(
        `/api/leaderboard${qs({ seed: query.seed, limit: query.limit })}`,
      ),
    getCatalogYear: (year: number, category?: Category) =>
      get<BrowseContender[]>(`/api/catalog/years/${year}${qs({ category })}`),
    getClusters: () => get<ClusterSummary>("/api/analytics/clusters"),
    getRanker: () => get<RankerSummary>("/api/analytics/ranker"),
    getValidation: () => get<ValidationReport>("/api/analytics/validation"),
    health: () => get<HealthResponse>("/health"),

    /* ---- Game-mode menu ----------------------------------------------- */
    getModes: () => get<ModeCard[]>("/api/modes"),

    /* ---- Six Degrees --------------------------------------------------- *
     * `seed` is a query param here rather than a body: the backend declares
     * it as one (`POST /api/grid/games?seed=2026-09-07`), so the daily board
     * is a URL you can paste into curl.                                     */
    createGridGame: (seed?: string) =>
      post<GridState>(`/api/grid/games${qs({ seed })}`),
    getGridGame: (id) => get<GridState>(`/api/grid/games/${encodeURIComponent(id)}`),
    answerGrid: (id, body: GridAnswerBody) =>
      post<GridState>(`/api/grid/games/${encodeURIComponent(id)}/answer`, body),
    completeGrid: (id) =>
      post<GridResults>(`/api/grid/games/${encodeURIComponent(id)}/complete`),
    getGridResults: (id) =>
      get<GridResults>(`/api/grid/games/${encodeURIComponent(id)}/results`),

    /* ---- Recast --------------------------------------------------------- *
     * `seed` is a query param, as it is for the grid, because the backend
     * declares it as one (`POST /api/recast/games?seed=2026-09-07`) — so the
     * daily film is a URL you can paste into curl.
     *
     * There is no shortlist parameter: which role is being cast is server
     * state (`RecastState.current_role`), so a client cannot ask for the
     * shortlist of a role it is not on.                                      */
    createRecastGame: (seed?: string) =>
      post<RecastState>(`/api/recast/games${qs({ seed })}`),
    getRecastGame: (id) => get<RecastState>(`/api/recast/games/${encodeURIComponent(id)}`),
    getRecastShortlist: (id) =>
      get<ActorCard[]>(`/api/recast/games/${encodeURIComponent(id)}/shortlist`),
    castRecast: (id, personId) =>
      post<RecastState>(`/api/recast/games/${encodeURIComponent(id)}/cast`, {
        person_id: personId,
      }),
    getRecastResults: (id) =>
      get<RecastResults>(`/api/recast/games/${encodeURIComponent(id)}/results`),
  };
}
