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
} from "./types";

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
    getCandidates: (id, query: CandidatesQuery = {}) =>
      get<Contender[]>(
        `/api/games/${encodeURIComponent(id)}/candidates${qs({ sort: query.sort, q: query.q })}`,
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
    health: () => get<HealthResponse>("/health"),
  };
}
