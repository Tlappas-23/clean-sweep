// Pure reducer for the Play screen's client-side game state.
//
// The server (or mock) is the source of truth for `GameState`; this reducer
// only tracks what the UI layers on top: which request is in flight, the
// candidate list and its sort/search, the card the player has highlighted,
// and the last error. Keeping it pure makes the create → spin → pick flow
// unit-testable (src/state/game.test.tsx) without rendering pages.

import type { CandidateSort, Contender, GameState } from "../api/types";

/** Which API call is currently pending, so buttons can disable themselves. */
export type Pending =
  | "idle"
  | "creating"
  | "loading"
  | "spinning"
  | "skipping"
  | "candidates"
  | "picking";

export interface GameUiState {
  game: GameState | null;
  pending: Pending;
  /** Candidate pool for the current spin (masked per mode). */
  candidates: Contender[];
  sort: CandidateSort;
  query: string;
  /** contender_id highlighted in the grid, awaiting "Lock in". */
  selectedId: string | null;
  error: string | null;
  /** Monotonic counter bumped on every new spin so the reels can re-animate. */
  spinSerial: number;
}

export type GameAction =
  | { type: "request"; pending: Pending }
  | { type: "game"; game: GameState; fromSpin?: boolean }
  | { type: "candidates"; candidates: Contender[] }
  | { type: "sort"; sort: CandidateSort }
  | { type: "query"; query: string }
  | { type: "select"; id: string | null }
  | { type: "error"; message: string }
  | { type: "clearError" }
  | { type: "reset" };

export const initialGameUiState: GameUiState = {
  game: null,
  pending: "idle",
  candidates: [],
  sort: "prestige",
  query: "",
  selectedId: null,
  error: null,
  spinSerial: 0,
};

export function gameReducer(state: GameUiState, action: GameAction): GameUiState {
  switch (action.type) {
    case "request":
      return { ...state, pending: action.pending, error: null };

    case "game": {
      const game = action.game;
      const spinChanged =
        game.current_spin?.year !== state.game?.current_spin?.year ||
        game.current_spin?.category !== state.game?.current_spin?.category;
      return {
        ...state,
        game,
        pending: "idle",
        // A new spin invalidates the old pool and any highlighted card.
        candidates: spinChanged ? [] : state.candidates,
        selectedId: spinChanged ? null : state.selectedId,
        query: spinChanged ? "" : state.query,
        spinSerial: action.fromSpin ? state.spinSerial + 1 : state.spinSerial,
        // Metric sorts are meaningless in cinephile mode (all null) — fall back
        // to title so the list has a stable, sensible order.
        sort:
          game.mode === "cinephile" && isMetricSort(state.sort) ? "title" : state.sort,
      };
    }

    case "candidates":
      return { ...state, candidates: action.candidates, pending: "idle" };

    case "sort":
      return { ...state, sort: action.sort };

    case "query":
      return { ...state, query: action.query };

    case "select":
      return { ...state, selectedId: action.id };

    case "error":
      return { ...state, error: action.message, pending: "idle" };

    case "clearError":
      return { ...state, error: null };

    case "reset":
      return initialGameUiState;
  }
}

export function isMetricSort(sort: CandidateSort): boolean {
  return sort === "acclaim" || sort === "popularity" || sort === "box_office" || sort === "prestige";
}
