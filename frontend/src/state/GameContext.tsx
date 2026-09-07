// `GameProvider` + `useGame`: the game store described in docs/ARCHITECTURE.md.
//
// Wraps the reducer in src/state/gameReducer.ts with the async API calls.
// Pages call the action functions returned by `useGame()`; they never touch
// the `Api` directly. The provider accepts an `api` prop so tests can inject
// the mock adapter with zero latency (see src/state/game.test.tsx).

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
import type { CandidateSort, GameState, Mode, SkipKind } from "../api/types";
import { gameReducer, initialGameUiState, type GameUiState } from "./gameReducer";

export interface GameActions {
  /** POST /api/games, then hand the new state back so the caller can navigate. */
  createGame(mode: Mode, seed?: string): Promise<GameState | null>;
  /** GET /api/games/{id}; used when landing on /play/:id directly. */
  loadGame(id: string): Promise<GameState | null>;
  spin(): Promise<void>;
  skip(kind: SkipKind): Promise<void>;
  /** Lock in the highlighted card; resolves with the new state (or null on error). */
  pick(contenderId: string): Promise<GameState | null>;
  refreshCandidates(): Promise<void>;
  setSort(sort: CandidateSort): void;
  setQuery(query: string): void;
  select(id: string | null): void;
  clearError(): void;
  reset(): void;
}

export type GameStore = GameUiState & GameActions;

const GameContext = createContext<GameStore | null>(null);

interface ProviderProps {
  children: ReactNode;
  api?: Api;
}

export function GameProvider({ children, api = defaultApi }: ProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialGameUiState);

  // Refs let async callbacks read the latest state without re-creating
  // themselves (and without stale closures) on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const gameId = state.game?.id ?? null;

  /** Shared wrapper: mark pending, run, store the result or the error. */
  const run = useCallback(
    async <T,>(
      pending: GameUiState["pending"],
      fn: () => Promise<T>,
      onOk: (value: T) => void,
    ): Promise<T | null> => {
      dispatch({ type: "request", pending });
      try {
        const value = await fn();
        onOk(value);
        return value;
      } catch (err) {
        dispatch({ type: "error", message: errorMessage(err) });
        return null;
      }
    },
    [],
  );

  const createGame = useCallback<GameActions["createGame"]>(
    (mode, seed) => {
      dispatch({ type: "reset" });
      return run("creating", () => api.createGame({ mode, seed }), (game) =>
        dispatch({ type: "game", game }),
      );
    },
    [api, run],
  );

  const loadGame = useCallback<GameActions["loadGame"]>(
    (id) => run("loading", () => api.getGame(id), (game) => dispatch({ type: "game", game })),
    [api, run],
  );

  const spin = useCallback(async () => {
    const id = stateRef.current.game?.id;
    if (!id) return;
    await run("spinning", () => api.spin(id), (game) =>
      dispatch({ type: "game", game, fromSpin: true }),
    );
  }, [api, run]);

  const skip = useCallback(
    async (kind: SkipKind) => {
      const id = stateRef.current.game?.id;
      if (!id) return;
      await run("skipping", () => api.skip(id, kind), (game) =>
        dispatch({ type: "game", game, fromSpin: true }),
      );
    },
    [api, run],
  );

  const pick = useCallback<GameActions["pick"]>(
    (contenderId) => {
      const id = stateRef.current.game?.id;
      if (!id) return Promise.resolve(null);
      return run("picking", () => api.pick(id, contenderId), (game) =>
        dispatch({ type: "game", game }),
      );
    },
    [api, run],
  );

  // Candidate fetching keys off (game id, spin, sort, query). A serial guards
  // against out-of-order responses when the player types quickly.
  const fetchSerial = useRef(0);
  const refreshCandidates = useCallback(async () => {
    const s = stateRef.current;
    const game = s.game;
    if (!game || game.status !== "picking") return;
    const serial = ++fetchSerial.current;
    dispatch({ type: "request", pending: "candidates" });
    try {
      const list = await api.getCandidates(game.id, {
        sort: s.sort,
        q: s.query.trim() || undefined,
      });
      if (serial === fetchSerial.current) dispatch({ type: "candidates", candidates: list });
    } catch (err) {
      if (serial === fetchSerial.current) dispatch({ type: "error", message: errorMessage(err) });
    }
  }, [api]);

  const spinKey = `${state.game?.current_spin?.year ?? ""}:${state.game?.current_spin?.category ?? ""}`;
  const status = state.game?.status;
  useEffect(() => {
    if (status !== "picking") return;
    // Debounce the search box a little; sort changes go through the same timer.
    const t = setTimeout(() => void refreshCandidates(), state.query ? 200 : 0);
    return () => clearTimeout(t);
  }, [gameId, spinKey, status, state.sort, state.query, refreshCandidates]);

  const setSort = useCallback((sort: CandidateSort) => dispatch({ type: "sort", sort }), []);
  const setQuery = useCallback((query: string) => dispatch({ type: "query", query }), []);
  const select = useCallback((id: string | null) => dispatch({ type: "select", id }), []);
  const clearError = useCallback(() => dispatch({ type: "clearError" }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const value = useMemo<GameStore>(
    () => ({
      ...state,
      createGame,
      loadGame,
      spin,
      skip,
      pick,
      refreshCandidates,
      setSort,
      setQuery,
      select,
      clearError,
      reset,
    }),
    [state, createGame, loadGame, spin, skip, pick, refreshCandidates, setSort, setQuery, select, clearError, reset],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useGame(): GameStore {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}
