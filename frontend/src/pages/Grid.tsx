// Grid: the Co-star Grid screen. Routes "/grid" and "/grid/:gameId".
//
// One route pattern serves both (`/grid/:gameId?` in src/App.tsx) so the
// component is not torn down and rebuilt on the hop between them. That hop is
// the page's first job: arriving at "/grid" with no id, it creates a board
// and replaces the URL with "/grid/:id", which is what makes a board a
// shareable, reloadable thing rather than a session that dies with the tab.
// A `?seed=YYYY-MM-DD` on the way in is passed straight to the server and
// produces the shared daily board.
//
// Like Play, this page is orchestration only: the board, the clock, the
// answer box and the reveal are all in src/components/grid/*, and every rule
// about what a click means lives in src/state/GridContext.tsx. What is left
// here is the arithmetic nobody else should own — which of the three screens
// (loading / playing / reveal) is on — plus the header that frames it.

import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { GridProvider, useGrid } from "../state/GridContext";
import { todaySeed } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageLoader } from "../components/ui/Spinner";
import { GridBoard } from "../components/grid/GridBoard";
import { GridClock } from "../components/grid/GridClock";
import { AnswerSearch } from "../components/grid/AnswerSearch";
import { GridResultsView } from "../components/grid/GridResultsView";

/** The route element: the store, then the screen that reads it. */
export function GridPage() {
  return (
    <GridProvider>
      <GridScreen />
    </GridProvider>
  );
}

/**
 * The screen itself, exported separately so tests can wrap it in a
 * `<GridProvider api={mock}>` of their own.
 */
export function GridScreen() {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const seed = searchParams.get("seed") ?? undefined;

  const {
    game,
    results,
    pending,
    error,
    activeCell,
    cellErrors,
    query,
    searchResults,
    searching,
    secondsRemaining,
    createGame,
    loadGame,
    openCell,
    closeCell,
    setQuery,
    answer,
    handIn,
    clearError,
  } = useGrid();

  // "/grid" with no id: create a board, then replace the URL with its own.
  // The ref is what keeps React 19's double-invoked effects (and any re-render
  // while the POST is in flight) from dealing two boards.
  const creating = useRef(false);
  useEffect(() => {
    if (gameId || creating.current) return;
    creating.current = true;
    void createGame(seed).then((created) => {
      if (created) navigate(`/grid/${created.id}`, { replace: true });
      // A failure has to be retryable, so release the latch.
      else creating.current = false;
    });
  }, [gameId, seed, createGame, navigate]);

  // Landing on /grid/:id directly (a reload, a shared link) hydrates from the
  // server. Arriving via the redirect above, the board is already in the
  // store and this does nothing.
  useEffect(() => {
    if (!gameId || game?.id === gameId) return;
    void loadGame(gameId);
  }, [gameId, game?.id, loadGame]);

  /* ---- Screen 1: still getting a board ------------------------------- */

  if (!game || (gameId && game.id !== gameId)) {
    if (error) {
      return (
        <div className="mx-auto max-w-xl py-16">
          <ErrorBanner
            message={error}
            onRetry={() => {
              clearError();
              creating.current = false;
              if (gameId) void loadGame(gameId);
            }}
          />
          <div className="mt-6 text-center">
            <Link to="/modes">
              <Button variant="secondary">Back to the modes</Button>
            </Link>
          </div>
        </div>
      );
    }
    return <PageLoader label={gameId ? "Loading the board" : "Building a board"} />;
  }

  /* ---- Screen 2: the reveal ------------------------------------------ */

  if (results) {
    return (
      <div className="flex flex-col gap-8">
        <GridResultsView results={results} />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/grid">
            <Button>New board</Button>
          </Link>
          <Link to={`/grid?seed=${todaySeed()}`}>
            <Button variant="secondary">Today&rsquo;s daily board</Button>
          </Link>
          <Link to="/modes">
            <Button variant="ghost">Other modes</Button>
          </Link>
        </div>
      </div>
    );
  }

  /* ---- Screen 3: playing --------------------------------------------- */

  const filled = game.cells.filter((c) => c.film !== null).length;
  const scored = game.cells.reduce((sum, c) => sum + (c.score ?? 0), 0);
  const rowActor = activeCell ? game.rows[activeCell.row] : null;
  const columnActor = activeCell ? game.columns[activeCell.column] : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold">
            Co-star Grid
            {game.seed && <span className="ml-2 text-muted">daily · {game.seed}</span>}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl">Name a film they were both in</h1>
          {/* Each figure is one element with its whole phrase inside, so it
              reads as a unit to a screen reader instead of a loose number. */}
          <p className="mt-1 text-xs text-ivory-dim">
            <span className="tabular-nums text-ivory">
              {filled} of {game.cells.length}
            </span>{" "}
            filled ·{" "}
            <span className="tabular-nums text-ivory">{Math.round(scored)} points</span> · one film
            per board
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* `finished` covers the beat between the server locking the board
              and the reveal arriving: the clock reads as spent time, not as a
              warning about a round that is already over. */}
          <GridClock
            seconds={secondsRemaining}
            roundSeconds={game.round_seconds}
            finished={game.status === "complete"}
          />
          <Button
            variant="secondary"
            onClick={() => void handIn()}
            loading={pending === "completing"}
            title="Score the board now and see every pairing's best answer"
          >
            Hand it in
          </Button>
        </div>
      </header>

      {/* Page-level failures only; a refused answer belongs to its cell. */}
      {error && <ErrorBanner message={error} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <GridBoard
          game={game}
          activeCell={activeCell}
          cellErrors={cellErrors}
          onSelectCell={openCell}
        />

        <div className="flex flex-col gap-4">
          {activeCell && rowActor && columnActor ? (
            <AnswerSearch
              rowActor={rowActor.name}
              columnActor={columnActor.name}
              query={query}
              results={searchResults}
              searching={searching}
              submitting={pending === "answering"}
              onQuery={setQuery}
              onPick={(filmId) => void answer(filmId)}
              onClose={closeCell}
            />
          ) : (
            <aside className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-5 text-sm text-ivory-dim">
              <p>
                Pick a square and name a film both of its actors appeared in. Every pairing on this
                board has at least one.
              </p>
              <ul className="flex flex-col gap-2 text-xs">
                <li>
                  <Chip tone="gold">Scoring</Chip>{" "}
                  <span className="ml-1">
                    any genuine collaboration is worth at least 60; the pair&rsquo;s best-known film
                    is worth 100.
                  </span>
                </li>
                <li>
                  <Chip tone="gold">One film per board</Chip>{" "}
                  <span className="ml-1">
                    an ensemble picture cannot fill a whole row — each film may be used once.
                  </span>
                </li>
              </ul>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
