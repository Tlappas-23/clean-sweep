// Fetch-based implementation of the `Api` interface (src/api/client.ts).
//
// Talks to the FastAPI backend described in docs/API.md. In development the
// Vite proxy forwards `/api` and `/health` to localhost:8000, so the base
// URL is empty (same origin) unless VITE_API_BASE overrides it. In production
// it is set to the deployed API, which is on a different origin, which is why
// that server has a CORS allow-list rather than a wildcard.
//
// The cold start
// --------------
// The API is on a tier that sleeps after fifteen minutes idle and takes the
// better part of a minute to wake. That is not an error state, but it is
// indistinguishable from one to a plain `fetch`: the first request just hangs
// and then fails.
//
// So this module treats a first failure as "probably asleep" rather than
// "broken". It retries with backoff, and while it is retrying it tells the
// rest of the app so, through `onWaking`. Screens use that to say "the server
// is waking up" instead of showing a spinner that means nothing, or worse an
// error for something that is about to work. Requests that are safe to repeat
// are the only ones retried, which is why the method matters below.

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
  GridHintBody,
  GridResults,
  GridState,
  ModeCard,
} from "./types";
/* ---- Recast types (own block, see client.ts) --------------------------- */
import type { ActorCard, RecastResults, RecastState } from "./types";
/* ---- The Chain types (own block, see client.ts) ------------------------ */
import type {
  ChainLeaderboardEntry,
  ChainMoveBody,
  ChainResults,
  ChainState,
  FilmCard,
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
 * How long a single attempt may take before it is abandoned.
 *
 * A sleeping instance accepts the connection and then holds it while it boots,
 * so without a deadline the first request can hang for a minute with nothing
 * on screen. Cutting it short and retrying is what turns that into visible
 * progress. Generous enough that a slow phone connection is never mistaken for
 * a sleeping server.
 */
const ATTEMPT_TIMEOUT_MS = 12_000;

/** Waits before each retry. Four attempts, spread across roughly a minute. */
const RETRY_BACKOFF_MS = [1_000, 3_000, 8_000] as const;

/**
 * Told the app when a request has failed once and is being retried, and again
 * when it finally settles. This is what a screen listens to in order to say
 * "waking the server" rather than showing an error for something that is
 * about to work.
 *
 * A module-level subscriber rather than a parameter threaded through every
 * call: waking is a property of the *connection*, not of any one request, and
 * every screen wants the same answer to it.
 */
export type WakeListener = (waking: boolean) => void;

let wakeListener: WakeListener | null = null;
let outstandingRetries = 0;

export function onWaking(listener: WakeListener | null): void {
  wakeListener = listener;
}

function setWaking(waking: boolean): void {
  // Counted, not a boolean: several requests can be in flight, and the last
  // one to recover is the one that should clear the notice.
  outstandingRetries = Math.max(0, outstandingRetries + (waking ? 1 : -1));
  wakeListener?.(outstandingRetries > 0);
}

/** Whether repeating this request is safe. */
function isReplayable(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  // GET is idempotent by definition. POST is not: retrying "create a game"
  // that actually succeeded but whose response was lost would deal a second
  // board, and retrying a move could play it twice. So a write gets exactly
  // one attempt, and its failure is reported honestly.
  return method === "GET" || method === "HEAD";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One attempt, with its own deadline. */
async function attempt(url: string, init?: RequestInit): Promise<Response> {
  // AbortSignal.timeout is not in every browser this may meet, so the
  // controller is driven by hand.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
      ...init,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared request helper. Parses the FastAPI error envelope so callers
 * always get an `ApiError` with a human-readable `detail`.
 *
 * Retries only reads, and only on a *transport* failure or a 502/503/504,
 * which is what a host in front of a sleeping instance returns. A 4xx is the
 * server answering, and repeating it would only ask the same wrong question
 * again.
 */
async function request<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = base + path;
  const replayable = isReplayable(init);
  let response: Response | null = null;
  let announced = false;

  try {
    for (let tries = 0; ; tries++) {
      try {
        response = await attempt(url, init);
        // A gateway error in front of a booting instance is the sleeping
        // case wearing a status code.
        if (![502, 503, 504].includes(response.status)) break;
      } catch {
        response = null; // transport failure: no reply at all
      }

      const canRetry = replayable && tries < RETRY_BACKOFF_MS.length;
      if (!canRetry) break;
      if (!announced) {
        announced = true;
        setWaking(true);
      }
      await wait(RETRY_BACKOFF_MS[tries]);
    }
  } finally {
    if (announced) setWaking(false);
  }

  if (response === null) {
    // Network failure (backend down, offline, or awake but unreachable).
    // Status 0 signals "no response".
    throw new ApiError(
      0,
      replayable
        ? "Could not reach the server. It may be waking up; try again in a moment."
        : "Could not reach the server.",
    );
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
    // A hint returns the whole board rather than the film alone, so a bought
    // hint lands on the cell the same way an answer does and the client never
    // has to merge one response into another.
    hintGrid: (id, body: GridHintBody) =>
      post<GridState>(`/api/grid/games/${encodeURIComponent(id)}/hint`, body),
    completeGrid: (id) =>
      post<GridResults>(`/api/grid/games/${encodeURIComponent(id)}/complete`),
    getGridResults: (id) =>
      get<GridResults>(`/api/grid/games/${encodeURIComponent(id)}/results`),

    /* ---- Recast --------------------------------------------------------- *
     * `seed` is a query param, as it is for the grid, because the backend
     * declares it as one (`POST /api/recast/games?seed=2026-09-07`), so the
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

    /* ---- The Chain ------------------------------------------------------ *
     * `seed` is a query param, as it is for the other two side modes,
     * because the backend declares it as one
     * (`POST /api/chain/games?seed=2026-09-08`), so the daily pair of films
     * is a URL you can paste into curl.                                      */
    createChainGame: (seed?: string) => post<ChainState>(`/api/chain/games${qs({ seed })}`),
    getChainGame: (id) => get<ChainState>(`/api/chain/games/${encodeURIComponent(id)}`),
    searchChainFilms: (id, q: string, limit?: number) =>
      get<FilmCard[]>(
        `/api/chain/games/${encodeURIComponent(id)}/search${qs({ q, limit })}`,
      ),
    moveChain: (id, body: ChainMoveBody) =>
      post<ChainState>(`/api/chain/games/${encodeURIComponent(id)}/move`, body),
    // Giving up returns the results rather than the board, because the reveal
    // is the whole point of stopping: the client never has to make a second
    // request to find out what the answer was.
    giveUpChain: (id) =>
      post<ChainResults>(`/api/chain/games/${encodeURIComponent(id)}/give-up`),
    getChainResults: (id) =>
      get<ChainResults>(`/api/chain/games/${encodeURIComponent(id)}/results`),
    getChainLeaderboard: (limit?: number) =>
      get<ChainLeaderboardEntry[]>(`/api/chain/leaderboard${qs({ limit })}`),
  };
}
