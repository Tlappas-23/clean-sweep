// `GridProvider` + `useGrid`: the store for the Co-star Grid mode.
//
// Sits between src/pages/Grid.tsx (which only renders) and the `Api`
// interface (src/api/client.ts), the same way GameContext does for the Oscars
// mode. The page and the components in src/components/grid/* never touch the
// API; they call the actions returned by `useGrid()`. The provider takes an
// `api` prop so tests can inject a zero-latency mock.
//
// Three pieces of this are worth reading before the code:
//
// 1. The clock. `seconds_remaining` on every server response is the truth.
//    We tick a local copy down once a second so the display moves, but the
//    local number never decides anything: when it reaches zero the provider
//    asks the *server* what the board's status is, and only a server response
//    saying "complete" causes the results to be fetched. If our clock ran a
//    second fast, the re-sync simply hands back a positive number and the
//    ticking resumes.
//
// 2. Rejections are per cell, not global. "those two were never in that film
//    together" is the feedback the whole mode exists to give, so it is stored
//    against the cell it belongs to (`cellErrors`) and rendered there, rather
//    than being flashed in a toast that vanishes. `error` is reserved for the
//    page-level failures: the board could not be created or loaded.
//
// 3. Search is debounced here rather than in the input. The component stays a
//    controlled text box with no timers in it, and the debounce sits next to
//    the request it is throttling.

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
import type { FilmCard, GridResults, GridState } from "../api/types";

/** How long the answer box waits after a keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 250;

/** The server rejects a search of fewer than two characters (422). */
export const MIN_SEARCH_LENGTH = 2;

/** Which call is in flight, so only the control that started it shows a spinner. */
export type GridPending =
  | "creating"
  | "loading"
  | "answering"
  | "completing"
  | null;

/** A cell coordinate. Keyed as "row,column" wherever it is used as a map key. */
export interface CellRef {
  row: number;
  column: number;
}

// eslint-disable-next-line react-refresh/only-export-components -- the key format is shared with GridBoard on purpose
export const cellKey = (row: number, column: number): string => `${row},${column}`;

export interface GridUiState {
  game: GridState | null;
  results: GridResults | null;
  pending: GridPending;
  /** Page-level failure: the board could not be created or loaded. */
  error: string | null;
  /** The cell whose answer box is open, or null. */
  activeCell: CellRef | null;
  /** Server rejection per cell, keyed "row,column". Cleared on a new attempt. */
  cellErrors: Record<string, string>;
  query: string;
  searchResults: FilmCard[];
  searching: boolean;
  /**
   * The display clock. Seeded and re-seeded from `game.seconds_remaining`;
   * ticked down locally in between so the number moves once a second.
   */
  secondsRemaining: number;
}

const initialGridState: GridUiState = {
  game: null,
  results: null,
  pending: null,
  error: null,
  activeCell: null,
  cellErrors: {},
  query: "",
  searchResults: [],
  searching: false,
  secondsRemaining: 0,
};

type Action =
  | { type: "reset" }
  | { type: "request"; pending: GridPending }
  | { type: "game"; game: GridState }
  | { type: "results"; results: GridResults }
  | { type: "error"; message: string }
  | { type: "clearError" }
  | { type: "openCell"; cell: CellRef }
  | { type: "closeCell" }
  | { type: "cellError"; cell: CellRef; message: string }
  | { type: "query"; query: string }
  | { type: "searching" }
  | { type: "searchResults"; films: FilmCard[] }
  | { type: "tick" };

function gridReducer(state: GridUiState, action: Action): GridUiState {
  switch (action.type) {
    case "reset":
      return initialGridState;

    case "request":
      return { ...state, pending: action.pending, error: null };

    case "game":
      return {
        ...state,
        game: action.game,
        pending: null,
        error: null,
        // A reveal belongs to the board it came from. Starting or loading a
        // different board must not leave the previous one's results on screen.
        results: state.results?.game.id === action.game.id ? state.results : null,
        // Every response re-syncs the clock. This is the only assignment that
        // may raise the number; the tick below can only lower it.
        secondsRemaining: action.game.seconds_remaining,
      };

    case "results":
      return {
        ...state,
        results: action.results,
        game: action.results.game,
        pending: null,
        error: null,
        activeCell: null,
        secondsRemaining: action.results.game.seconds_remaining,
      };

    case "error":
      return { ...state, pending: null, error: action.message };

    case "clearError":
      return { ...state, error: null };

    case "openCell":
      return {
        ...state,
        activeCell: action.cell,
        // Opening a cell is a fresh attempt: drop the last rejection and the
        // stale result list from whatever cell was open before.
        cellErrors: withoutCell(state.cellErrors, action.cell),
        query: "",
        searchResults: [],
        searching: false,
      };

    case "closeCell":
      return { ...state, activeCell: null, query: "", searchResults: [], searching: false };

    case "cellError":
      return {
        ...state,
        pending: null,
        cellErrors: { ...state.cellErrors, [cellKey(action.cell.row, action.cell.column)]: action.message },
      };

    case "query":
      return { ...state, query: action.query };

    case "searching":
      return { ...state, searching: true };

    case "searchResults":
      return { ...state, searchResults: action.films, searching: false };

    case "tick":
      // Display only, and it can never go below zero — what happens *at* zero
      // is decided by the server, in the effect below.
      return { ...state, secondsRemaining: Math.max(0, state.secondsRemaining - 1) };

    default:
      return state;
  }
}

/** Drop one cell's rejection message. */
function withoutCell(errors: Record<string, string>, cell: CellRef): Record<string, string> {
  const key = cellKey(cell.row, cell.column);
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

export interface GridActions {
  /** POST /api/grid/games; resolves with the new board so the caller can route. */
  createGame(seed?: string): Promise<GridState | null>;
  /** GET /api/grid/games/{id}; used when landing on /grid/:id directly. */
  loadGame(id: string): Promise<GridState | null>;
  /** Open the answer box on a cell (no-op for a cell that is already filled). */
  openCell(row: number, column: number): void;
  closeCell(): void;
  setQuery(query: string): void;
  /** Name a film for the open cell. Resolves true only if the server took it. */
  answer(filmId: string): Promise<boolean>;
  /** POST /complete — hand the board in and reveal the results. */
  handIn(): Promise<GridResults | null>;
  clearError(): void;
}

export type GridStore = GridUiState & GridActions;

const GridContext = createContext<GridStore | null>(null);

interface ProviderProps {
  children: ReactNode;
  api?: Api;
}

export function GridProvider({ children, api = defaultApi }: ProviderProps) {
  const [state, dispatch] = useReducer(gridReducer, initialGridState);

  // Refs let the async callbacks and the timers read the latest state without
  // re-creating themselves on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const createGame = useCallback<GridActions["createGame"]>(
    async (seed) => {
      // A new board starts from nothing: no stale reveal, no open cell, no
      // rejection left over from the last one.
      dispatch({ type: "reset" });
      dispatch({ type: "request", pending: "creating" });
      try {
        const game = await api.createGridGame(seed);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        dispatch({ type: "error", message: errorMessage(err) });
        return null;
      }
    },
    [api],
  );

  const loadGame = useCallback<GridActions["loadGame"]>(
    async (id) => {
      dispatch({ type: "request", pending: "loading" });
      try {
        const game = await api.getGridGame(id);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        dispatch({ type: "error", message: errorMessage(err) });
        return null;
      }
    },
    [api],
  );

  const openCell = useCallback((row: number, column: number) => {
    dispatch({ type: "openCell", cell: { row, column } });
  }, []);

  const closeCell = useCallback(() => dispatch({ type: "closeCell" }), []);
  const setQuery = useCallback((query: string) => dispatch({ type: "query", query }), []);
  const clearError = useCallback(() => dispatch({ type: "clearError" }), []);

  const answer = useCallback<GridActions["answer"]>(
    async (filmId) => {
      const { game, activeCell } = stateRef.current;
      if (!game || !activeCell) return false;
      dispatch({ type: "request", pending: "answering" });
      try {
        const next = await api.answerGrid(game.id, {
          row: activeCell.row,
          column: activeCell.column,
          film_id: filmId,
        });
        dispatch({ type: "game", game: next });
        dispatch({ type: "closeCell" });
        return true;
      } catch (err) {
        // The rejection belongs to the cell, and the answer box stays open so
        // the player can try again — that exchange is the point of the mode.
        dispatch({ type: "cellError", cell: activeCell, message: errorMessage(err) });
        return false;
      }
    },
    [api],
  );

  const handIn = useCallback<GridActions["handIn"]>(async () => {
    const { game } = stateRef.current;
    if (!game) return null;
    dispatch({ type: "request", pending: "completing" });
    try {
      const results = await api.completeGrid(game.id);
      dispatch({ type: "results", results });
      return results;
    } catch (err) {
      dispatch({ type: "error", message: errorMessage(err) });
      return null;
    }
  }, [api]);

  /* ---- The clock ----------------------------------------------------- *
   * Two effects, in this order:
   *   1. tick the display down once a second while the board is in play;
   *   2. when the display reaches zero, ask the server what it thinks — a
   *      re-sync, never a local decision.                                  */

  const status = state.game?.status ?? null;
  const ticking = status === "playing" && state.secondsRemaining > 0;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // One re-sync per expiry: without the guard the effect would re-fire on
  // every render while the request is in flight.
  const expiredRef = useRef(false);
  const gameId = state.game?.id ?? null;
  const expired = status === "playing" && state.secondsRemaining === 0;

  useEffect(() => {
    if (!expired) {
      expiredRef.current = false;
      return;
    }
    if (!gameId || expiredRef.current) return;
    expiredRef.current = true;
    // If the server disagrees (our clock was a shade fast) this hands back a
    // positive `seconds_remaining` and play simply carries on.
    void api.getGridGame(gameId).then(
      (game) => dispatch({ type: "game", game }),
      () => {
        // A failed re-sync must not strand the board: let the next render try.
        expiredRef.current = false;
      },
    );
  }, [expired, gameId, api]);

  // The server has said the board is finished — by the clock, by a full grid,
  // or because it was handed in. Fetch the reveal exactly once.
  const finished = status === "complete";
  const hasResults = state.results !== null;
  const pending = state.pending;
  useEffect(() => {
    if (!finished || hasResults || !gameId || pending === "completing") return;
    void api.getGridResults(gameId).then(
      (results) => dispatch({ type: "results", results }),
      (err: unknown) => dispatch({ type: "error", message: errorMessage(err) }),
    );
  }, [finished, hasResults, gameId, pending, api]);

  /* ---- Debounced search ---------------------------------------------- */

  const query = state.query;
  const activeCell = state.activeCell;
  const searchSerial = useRef(0);

  useEffect(() => {
    if (!gameId || !activeCell) return;
    const q = query.trim();
    if (q.length < MIN_SEARCH_LENGTH) {
      dispatch({ type: "searchResults", films: [] });
      return;
    }
    dispatch({ type: "searching" });
    const timer = setTimeout(() => {
      const serial = ++searchSerial.current;
      void api.searchGridFilms(gameId, { q }).then(
        (films) => {
          // Drop responses from superseded keystrokes rather than letting an
          // older list overwrite a newer one.
          if (serial === searchSerial.current) dispatch({ type: "searchResults", films });
        },
        () => {
          if (serial === searchSerial.current) dispatch({ type: "searchResults", films: [] });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, gameId, activeCell, api]);

  const value = useMemo<GridStore>(
    () => ({
      ...state,
      createGame,
      loadGame,
      openCell,
      closeCell,
      setQuery,
      answer,
      handIn,
      clearError,
    }),
    [state, createGame, loadGame, openCell, closeCell, setQuery, answer, handIn, clearError],
  );

  return <GridContext.Provider value={value}>{children}</GridContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useGrid(): GridStore {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside <GridProvider>");
  return ctx;
}
