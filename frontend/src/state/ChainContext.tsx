// `ChainProvider` + `useChain`: the store for The Chain.
//
// Sits between src/pages/Chain.tsx (which only renders) and the `Api`
// interface (src/api/client.ts), the same way GridContext does for Six
// Degrees. The page and the components in src/components/chain/* never touch
// the API; they call the actions returned by `useChain()`. The provider takes
// an `api` prop so tests can inject a zero-latency mock.
//
// Three pieces are worth reading before the code:
//
// 1. The clock runs the other way. Six Degrees counts *down* and running out
//    is the ending; here the stopwatch counts *up* and is the tiebreak
//    between two routes of the same length. The anti-drift trick is the same
//    one and it matters for the same reason: we hold a START INSTANT rather
//    than a counter, and every tick recomputes the display from it. A counter
//    incremented once a second looks equivalent and is not, because the
//    interval is not guaranteed to fire. A browser throttles timers in a
//    background tab and stops them outright in a frozen one, so a counter
//    falls behind real time and a player who switches away comes back to a
//    stopwatch that has lost the minute they were gone. An instant cannot
//    drift: a missed tick corrects itself on the next one.
//
//    The local number still never decides anything. `max_seconds` is a real
//    ending, and when the display reaches it the provider asks the *server*
//    what the round's status is. Only a server response saying "complete"
//    causes the reveal to be fetched.
//
// 2. A refused move belongs to the move box, not to the page. "no one in that
//    film was in the one you are on" is the feedback the whole mode exists to
//    give, so it is held separately from `error` and rendered next to the
//    input the player is still typing in, rather than flashed in a toast that
//    vanishes. `error` is reserved for the page-level failures: the chain
//    could not be created or loaded.
//
// 3. There *is* a search, and unlike Six Degrees that is not a leak. There, a
//    list of matching actors would be a list of the cell's answers. Here the
//    puzzle is which films share a cast, and a list of titles matching what
//    you typed says nothing about that: it only saves a move lost to a
//    spelling. It is deliberately not part of the reducer, because a
//    suggestion list is transient view state that no other component reads;
//    the store exposes the call and the move box owns what it does with it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { api as defaultApi, errorMessage, type Api } from "../api";
import type {
  ChainLeaderboardEntry,
  ChainResults,
  ChainState,
  FilmCard,
} from "../api/types";

/** Which call is in flight, so only the control that started it shows a spinner. */
export type ChainPending = "creating" | "loading" | "moving" | "giving-up" | null;

export interface ChainUiState {
  game: ChainState | null;
  results: ChainResults | null;
  pending: ChainPending;
  /** Page-level failure: the chain could not be created or loaded. */
  error: string | null;
  /** The server's reason for refusing the last move, shown beside the input. */
  moveError: string | null;
  /**
   * The display stopwatch, in seconds. Recomputed from `startedAt` on every
   * tick rather than incremented, so a throttled or frozen tab cannot drift.
   */
  seconds: number;
  /**
   * When the round began, as an epoch milliseconds stamp, derived at each
   * sync from the server's `seconds`. Null before the first one.
   */
  startedAt: number | null;
}

const initialChainState: ChainUiState = {
  game: null,
  results: null,
  pending: null,
  error: null,
  moveError: null,
  seconds: 0,
  startedAt: null,
};

type Action =
  | { type: "reset" }
  | { type: "request"; pending: ChainPending }
  | { type: "game"; game: ChainState }
  | { type: "results"; results: ChainResults }
  | { type: "error"; message: string }
  | { type: "moveError"; message: string }
  | { type: "clearError" }
  | { type: "tick" };

function chainReducer(state: ChainUiState, action: Action): ChainUiState {
  switch (action.type) {
    case "reset":
      return initialChainState;

    case "request":
      // A new attempt clears the last refusal: the message under the input
      // describes the move that was just refused, not the one in flight.
      return { ...state, pending: action.pending, error: null, moveError: null };

    case "game":
      return {
        ...state,
        game: action.game,
        pending: null,
        error: null,
        // A reveal belongs to the chain it came from. Starting or loading a
        // different one must not leave the previous reveal on screen.
        results: state.results?.game.id === action.game.id ? state.results : null,
        // Every response re-syncs the stopwatch by moving the start instant,
        // which is the only assignment that may move it at all.
        seconds: action.game.seconds,
        startedAt: Date.now() - action.game.seconds * 1000,
      };

    case "results":
      return {
        ...state,
        results: action.results,
        game: action.results.game,
        pending: null,
        error: null,
        moveError: null,
        seconds: action.results.game.seconds,
        startedAt: Date.now() - action.results.game.seconds * 1000,
      };

    case "error":
      return { ...state, pending: null, error: action.message };

    case "moveError":
      return { ...state, pending: null, moveError: action.message };

    case "clearError":
      return { ...state, error: null, moveError: null };

    case "tick":
      // Recomputed from the start instant, never incremented, so a tick that
      // arrives late or not at all cannot leave the stopwatch behind reality.
      // Display only: what happens *at* the cap is decided by the server, in
      // the effect below.
      return {
        ...state,
        seconds:
          state.startedAt === null
            ? state.seconds
            : Math.min(
                state.game?.max_seconds ?? Infinity,
                Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)),
              ),
      };

    default:
      return state;
  }
}

export interface ChainActions {
  /** POST /api/chain/games; resolves with the new chain so the caller can route. */
  createGame(seed?: string): Promise<ChainState | null>;
  /** GET /api/chain/games/{id}; used when landing on /chain/:id directly. */
  loadGame(id: string): Promise<ChainState | null>;
  /**
   * Films whose title matches a fragment.
   *
   * Deliberately outside the reducer: a suggestion list is transient view
   * state nothing else reads. Resolves to an empty list on failure, because
   * a search that does not answer should quietly offer nothing rather than
   * put an error in front of someone mid-word.
   */
  search(q: string): Promise<FilmCard[]>;
  /**
   * Name a film to move to. Resolves true only if the server both recognised
   * the title and accepted the connection.
   */
  move(title: string): Promise<boolean>;
  /** POST /give-up: stop the round and reveal a shortest route. */
  giveUp(): Promise<ChainResults | null>;
  /**
   * GET /api/chain/leaderboard: finished chains, best first.
   *
   * Routed through the store rather than called from the page directly, for
   * the same reason every other request is: the provider's `api` is the one
   * a test injects, and a page reaching past it to the module singleton would
   * quietly read a different adapter's board.
   *
   * Resolves to an empty list on failure. A leaderboard that will not load is
   * worth an empty table, not an error over the reveal the player came for.
   */
  getLeaderboard(): Promise<ChainLeaderboardEntry[]>;
  clearError(): void;
}

export type ChainStore = ChainUiState & ChainActions;

const ChainContext = createContext<ChainStore | null>(null);

interface ProviderProps {
  children: ReactNode;
  api?: Api;
}

export function ChainProvider({ children, api = defaultApi }: ProviderProps) {
  const [state, dispatch] = useReducer(chainReducer, initialChainState);

  // A ref lets the async callbacks read the latest state without re-creating
  // themselves on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const createGame = useCallback<ChainActions["createGame"]>(
    async (seed) => {
      // A new chain starts from nothing: no stale reveal, no refusal left
      // over from the last one.
      dispatch({ type: "reset" });
      dispatch({ type: "request", pending: "creating" });
      try {
        const game = await api.createChainGame(seed);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        dispatch({ type: "error", message: errorMessage(err) });
        return null;
      }
    },
    [api],
  );

  const loadGame = useCallback<ChainActions["loadGame"]>(
    async (id) => {
      dispatch({ type: "request", pending: "loading" });
      try {
        const game = await api.getChainGame(id);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        dispatch({ type: "error", message: errorMessage(err) });
        return null;
      }
    },
    [api],
  );

  const search = useCallback<ChainActions["search"]>(
    async (q) => {
      const { game } = stateRef.current;
      // The endpoint enforces a two-character minimum; asking below it would
      // only trade a round trip for a 422.
      if (!game || q.trim().length < 2) return [];
      try {
        return await api.searchChainFilms(game.id, q.trim());
      } catch {
        return [];
      }
    },
    [api],
  );

  const move = useCallback<ChainActions["move"]>(
    async (title) => {
      const { game } = stateRef.current;
      if (!game) return false;
      dispatch({ type: "request", pending: "moving" });
      try {
        const next = await api.moveChain(game.id, { title });
        dispatch({ type: "game", game: next });
        return true;
      } catch (err) {
        // The refusal stays next to the input, which stays where it is, so
        // the player can try another film. That exchange is the mode.
        dispatch({ type: "moveError", message: errorMessage(err) });
        return false;
      }
    },
    [api],
  );

  const giveUp = useCallback<ChainActions["giveUp"]>(async () => {
    const { game } = stateRef.current;
    if (!game) return null;
    dispatch({ type: "request", pending: "giving-up" });
    try {
      const results = await api.giveUpChain(game.id);
      dispatch({ type: "results", results });
      return results;
    } catch (err) {
      dispatch({ type: "error", message: errorMessage(err) });
      return null;
    }
  }, [api]);

  const getLeaderboard = useCallback<ChainActions["getLeaderboard"]>(async () => {
    try {
      return await api.getChainLeaderboard();
    } catch {
      return [];
    }
  }, [api]);

  const clearError = useCallback(() => dispatch({ type: "clearError" }), []);

  /* ---- The stopwatch --------------------------------------------------- *
   * Three effects, in this order:
   *   1. tick the display up once a second while the chain is in play;
   *   2. when it reaches the cap, ask the server what it thinks;
   *   3. re-sync whenever the tab comes back, since a frozen tab runs no
   *      timers at all.                                                     */

  const status = state.game?.status ?? null;
  const maxSeconds = state.game?.max_seconds ?? 0;
  const ticking = status === "playing";

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // One re-sync per expiry: without the guard the effect would re-fire on
  // every render while the request is in flight.
  const expiredRef = useRef(false);
  const gameId = state.game?.id ?? null;
  const expired = status === "playing" && maxSeconds > 0 && state.seconds >= maxSeconds;

  useEffect(() => {
    if (!expired) {
      expiredRef.current = false;
      return;
    }
    if (!gameId || expiredRef.current) return;
    expiredRef.current = true;
    // If the server disagrees (our clock was a shade fast) this hands back a
    // round still in play and the stopwatch simply carries on.
    void api.getChainGame(gameId).then(
      (game) => dispatch({ type: "game", game }),
      () => {
        // A failed re-sync must not strand the round: let the next render try.
        expiredRef.current = false;
      },
    );
  }, [expired, gameId, api]);

  // Coming back to the tab. A frozen tab runs no timers, so the stopwatch
  // above is only as fresh as the last frame that rendered. Asking the server
  // the moment the tab is visible again is what turns a round that ran out
  // while the player was elsewhere into a finished chain straight away.
  useEffect(() => {
    if (!gameId || status !== "playing") return;
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      void api.getChainGame(gameId).then(
        (game) => dispatch({ type: "game", game }),
        () => {
          // Not worth surfacing: the tick keeps running and the expiry effect
          // will ask again.
        },
      );
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [gameId, status, api]);

  // The server has said the chain is finished, by arriving, by giving up, or
  // on the clock. Fetch the reveal exactly once.
  const finished = status === "complete";
  const hasResults = state.results !== null;
  const pending = state.pending;
  useEffect(() => {
    if (!finished || hasResults || !gameId || pending === "giving-up") return;
    void api.getChainResults(gameId).then(
      (results) => dispatch({ type: "results", results }),
      (err: unknown) => dispatch({ type: "error", message: errorMessage(err) }),
    );
  }, [finished, hasResults, gameId, pending, api]);

  const value = useMemo<ChainStore>(
    () => ({ ...state, createGame, loadGame, search, move, giveUp, getLeaderboard, clearError }),
    [state, createGame, loadGame, search, move, giveUp, getLeaderboard, clearError],
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useChain(): ChainStore {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used inside <ChainProvider>");
  return ctx;
}
