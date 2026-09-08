// `RecastProvider` + `useRecast`: the store for the Recast mode.
//
// Sits between src/pages/Recast.tsx (which only renders) and the `Api`
// interface (src/api/client.ts), the same way GridContext does for the
// Six Degrees and GameContext for the Oscars. The page and the components in
// src/components/recast/* never touch the API; they call the actions returned
// by `useRecast()`. The provider takes an `api` prop so tests can inject a
// zero-latency mock.
//
// Four things about this store are worth reading before the code:
//
// 1. The shortlist is not something the page asks for. Which role is open is
//    server state (`RecastState.current_role`), so the shortlist is fetched
//    by an effect keyed on the game and that index, and casting a role simply
//    moves the index, and the next shortlist follows on its own. There is no
//    "load the next role" action to forget to call, and no way for the client
//    to ask for a shortlist belonging to a role it is not on.
//
// 2. A refused casting is not a page error. "that actor is not on this role's
//    shortlist" is a statement about the choice, so it is kept apart from
//    `error` (which is reserved for "the round could not be created or
//    loaded") and rendered next to the shortlist. The selection survives it,
//    because the player is mid-decision.
//
// 3. `errorStatus` exists for one case: 503. Both side modes return it when
//    their seed tables were never built, and that is not a failure to retry.
//    It is a checkout that has not run a build step. The page needs the
//    status to tell those apart, so the reducer keeps it.
//
// 4. Selection is local and confirmation is explicit. Clicking an actor
//    highlights them; a second, separate action posts the cast. That is the
//    Oscars mode's "Lock in", and it is here for the same reason: casting is
//    irreversible, and an irreversible act should take two decisions.

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
import { api as defaultApi, errorMessage, isApiError, type Api } from "../api";
import type { ActorCard, RecastResults, RecastState } from "../api/types";

/** Which call is in flight, so only the control that started it shows a spinner. */
export type RecastPending = "creating" | "loading" | "casting" | null;

export interface RecastUiState {
  game: RecastState | null;
  results: RecastResults | null;
  /** The actors offered for the role currently being cast. */
  shortlist: ActorCard[];
  shortlistLoading: boolean;
  pending: RecastPending;
  /** Page-level failure: the round could not be created, loaded or scored. */
  error: string | null;
  /** HTTP status of that failure. 503 means "this mode was never built". */
  errorStatus: number | null;
  /** The server's refusal of a casting, shown against the shortlist. */
  castError: string | null;
  /** The highlighted actor, awaiting confirmation. */
  selectedId: string | null;
}

const initialRecastState: RecastUiState = {
  game: null,
  results: null,
  shortlist: [],
  shortlistLoading: false,
  pending: null,
  error: null,
  errorStatus: null,
  castError: null,
  selectedId: null,
};

type Action =
  | { type: "reset" }
  | { type: "request"; pending: RecastPending }
  | { type: "game"; game: RecastState }
  | { type: "results"; results: RecastResults }
  | { type: "error"; message: string; status: number | null }
  | { type: "clearError" }
  | { type: "shortlistLoading" }
  | { type: "shortlist"; actors: ActorCard[] }
  | { type: "select"; personId: string | null }
  | { type: "castError"; message: string };

function recastReducer(state: RecastUiState, action: Action): RecastUiState {
  switch (action.type) {
    case "reset":
      return initialRecastState;

    case "request":
      return { ...state, pending: action.pending, error: null, errorStatus: null };

    case "game":
      return {
        ...state,
        game: action.game,
        pending: null,
        error: null,
        errorStatus: null,
        castError: null,
        // A new role means a new shortlist and no selection. Clearing both
        // here rather than in the cast action means loading a round from its
        // URL lands in the same state as casting into it.
        selectedId: null,
        shortlist: [],
        // A reveal belongs to the round it came from.
        results: state.results?.game.id === action.game.id ? state.results : null,
      };

    case "results":
      return {
        ...state,
        results: action.results,
        game: action.results.game,
        pending: null,
        error: null,
        errorStatus: null,
        shortlist: [],
        selectedId: null,
      };

    case "error":
      return { ...state, pending: null, error: action.message, errorStatus: action.status };

    case "clearError":
      return { ...state, error: null, errorStatus: null, castError: null };

    case "shortlistLoading":
      return { ...state, shortlistLoading: true };

    case "shortlist":
      return { ...state, shortlist: action.actors, shortlistLoading: false };

    case "select":
      // Choosing somebody else is a fresh attempt: the last refusal was about
      // the previous name and should not hang over this one.
      return { ...state, selectedId: action.personId, castError: null };

    case "castError":
      // The selection is deliberately left alone. The player is mid-decision
      // and the message explains what is wrong with the one they made.
      return { ...state, pending: null, castError: action.message };

    default:
      return state;
  }
}

export interface RecastActions {
  /** POST /api/recast/games; resolves with the round so the caller can route. */
  createGame(seed?: string): Promise<RecastState | null>;
  /** GET /api/recast/games/{id}; used when landing on /recast/:id directly. */
  loadGame(id: string): Promise<RecastState | null>;
  /** Highlight an actor, or pass null to clear the highlight. */
  select(personId: string | null): void;
  /** Cast the highlighted actor. Resolves true only if the server took it. */
  castSelected(): Promise<boolean>;
  clearError(): void;
}

export type RecastStore = RecastUiState & RecastActions;

const RecastContext = createContext<RecastStore | null>(null);

interface ProviderProps {
  children: ReactNode;
  api?: Api;
}

export function RecastProvider({ children, api = defaultApi }: ProviderProps) {
  const [state, dispatch] = useReducer(recastReducer, initialRecastState);

  // A ref lets the async callbacks read the latest state without being
  // re-created on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Record a failure with its status, so the page can single out the 503. */
  const failed = useCallback((err: unknown) => {
    dispatch({
      type: "error",
      message: errorMessage(err),
      status: isApiError(err) ? err.status : null,
    });
  }, []);

  const createGame = useCallback<RecastActions["createGame"]>(
    async (seed) => {
      // A new round starts from nothing: no stale reveal, no shortlist and no
      // refusal left over from the last one.
      dispatch({ type: "reset" });
      dispatch({ type: "request", pending: "creating" });
      try {
        const game = await api.createRecastGame(seed);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        failed(err);
        return null;
      }
    },
    [api, failed],
  );

  const loadGame = useCallback<RecastActions["loadGame"]>(
    async (id) => {
      dispatch({ type: "request", pending: "loading" });
      try {
        const game = await api.getRecastGame(id);
        dispatch({ type: "game", game });
        return game;
      } catch (err) {
        failed(err);
        return null;
      }
    },
    [api, failed],
  );

  const select = useCallback((personId: string | null) => {
    dispatch({ type: "select", personId });
  }, []);

  const clearError = useCallback(() => dispatch({ type: "clearError" }), []);

  const castSelected = useCallback<RecastActions["castSelected"]>(async () => {
    const { game, selectedId } = stateRef.current;
    if (!game || !selectedId) return false;
    dispatch({ type: "request", pending: "casting" });
    try {
      const next = await api.castRecast(game.id, selectedId);
      dispatch({ type: "game", game: next });
      return true;
    } catch (err) {
      // The refusal belongs to the shortlist, not to the page: it is the
      // server explaining that this name was not on offer for this part.
      dispatch({ type: "castError", message: errorMessage(err) });
      return false;
    }
  }, [api]);

  /* ---- The shortlist follows the open role ---------------------------- *
   * Keyed on the round and `current_role`, so casting a part is the only
   * thing needed to move the mode on: the index changes, this effect runs,
   * and the next shortlist arrives. `serial` drops a response whose role has
   * already been superseded, which is what keeps a slow first shortlist from
   * landing on top of the second one.                                       */

  const gameId = state.game?.id ?? null;
  const currentRole = state.game?.current_role ?? null;
  const casting = state.game?.status === "casting";
  const shortlistSerial = useRef(0);

  useEffect(() => {
    if (!gameId || !casting || currentRole === null) return;
    const serial = ++shortlistSerial.current;
    dispatch({ type: "shortlistLoading" });
    void api.getRecastShortlist(gameId).then(
      (actors) => {
        if (serial === shortlistSerial.current) dispatch({ type: "shortlist", actors });
      },
      (err: unknown) => {
        if (serial !== shortlistSerial.current) return;
        dispatch({ type: "shortlist", actors: [] });
        failed(err);
      },
    );
  }, [gameId, currentRole, casting, api, failed]);

  /* ---- The reveal ------------------------------------------------------ *
   * The server decides when a round is over: `status` turns "complete" on
   * the response to the last cast. So the results are fetched off that,
   * exactly once, rather than off a count the client keeps itself.           */

  const finished = state.game?.status === "complete";
  const hasResults = state.results !== null;

  useEffect(() => {
    if (!finished || hasResults || !gameId) return;
    void api.getRecastResults(gameId).then(
      (results) => dispatch({ type: "results", results }),
      (err: unknown) => failed(err),
    );
  }, [finished, hasResults, gameId, api, failed]);

  const value = useMemo<RecastStore>(
    () => ({ ...state, createGame, loadGame, select, castSelected, clearError }),
    [state, createGame, loadGame, select, castSelected, clearError],
  );

  return <RecastContext.Provider value={value}>{children}</RecastContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useRecast(): RecastStore {
  const ctx = useContext(RecastContext);
  if (!ctx) throw new Error("useRecast must be used inside <RecastProvider>");
  return ctx;
}
