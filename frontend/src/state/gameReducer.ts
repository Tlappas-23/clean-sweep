// Pure reducer for the Play screen's client-side game state.
//
// The server (or mock) is the source of truth for `GameState`; this reducer
// only tracks what the UI layers on top: which request is in flight, the
// candidate list and its sort/search, which of the years on the board is being
// viewed, the card the player has highlighted, and the last error. Keeping it
// pure makes the create → spin → pick flow unit-testable
// (src/state/game.test.tsx) without rendering pages.

import type { CandidateSort, Contender, GameState, Spin } from "../api/types";

/** Which API call is currently pending, so buttons can disable themselves. */
export type Pending =
  | "idle"
  | "creating"
  | "loading"
  | "spinning"
  | "skipping"
  | "rerolling"
  | "candidates"
  | "picking";

export interface GameUiState {
  game: GameState | null;
  pending: Pending;
  /** Candidate pool for the current spin (masked per mode). */
  candidates: Contender[];
  sort: CandidateSort;
  query: string;
  /**
   * Which of the years on the board the grid is showing. `null` is the
   * "all years" view, which is what the candidates endpoint returns when the
   * `year` param is omitted.
   */
  viewYear: number | null;
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
  | { type: "viewYear"; year: number | null }
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
  viewYear: null,
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
      const spinChanged = !sameBoard(game.current_spin, state.game?.current_spin ?? null);
      return {
        ...state,
        game,
        pending: "idle",
        // A new board invalidates the old pool and any highlighted card.
        candidates: spinChanged ? [] : state.candidates,
        selectedId: spinChanged ? null : state.selectedId,
        query: spinChanged ? "" : state.query,
        // With several years dealt, "all years" is the honest default: it
        // shows the whole board at once and the player narrows from there.
        // A board with a single year (after a reroll) has nothing to narrow,
        // so it selects itself.
        viewYear: spinChanged ? defaultViewYear(game.current_spin) : state.viewYear,
        spinSerial: action.fromSpin ? state.spinSerial + 1 : state.spinSerial,
        // Metric sorts are meaningless in cinephile mode (all null), so fall back
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

    case "viewYear":
      // Switching years swaps the pool underneath the grid, so a card
      // highlighted in the old year must not stay highlighted.
      return { ...state, viewYear: action.year, selectedId: null };

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

/**
 * True when two spins put the same years and category on the board.
 *
 * The reroll replaces three years with one *without* changing the category or
 * the round, so comparing years alone (or the category alone) would miss it;
 * `locked` is compared too because it changes what the UI is allowed to offer.
 */
function sameBoard(a: Spin | null | undefined, b: Spin | null | undefined): boolean {
  if (!a || !b) return a == null && b == null;
  return (
    a.category === b.category &&
    a.locked === b.locked &&
    a.year_options.length === b.year_options.length &&
    a.year_options.every((o, i) => o.year === b.year_options[i].year)
  );
}

/** "All years" for a normal board; the only year once a reroll has locked it. */
function defaultViewYear(spin: Spin | null): number | null {
  if (!spin) return null;
  return spin.year_options.length === 1 ? spin.year_options[0].year : null;
}

export function isMetricSort(sort: CandidateSort): boolean {
  return sort === "acclaim" || sort === "popularity" || sort === "box_office" || sort === "prestige";
}
