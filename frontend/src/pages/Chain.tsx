// Chain: The Chain screen. Routes "/chain" and "/chain/:gameId".
//
// One route pattern serves both (`/chain/:gameId?` in src/App.tsx) so the
// component is not torn down and rebuilt on the hop between them, which would
// restart the stopwatch. That hop is the page's first job: arriving at
// "/chain" with no id, it creates a round and replaces the URL with
// "/chain/:id", which is what makes a chain a shareable, reloadable thing
// rather than a session that dies with the tab. A `?seed=YYYY-MM-DD` on the
// way in is passed straight to the server and produces the shared daily pair.
//
// Like Grid, this page is orchestration only: the trail, the stopwatch, the
// move box, the reveal and the leaderboard are all in
// src/components/chain/*, and every rule about what a move means lives in
// src/state/ChainContext.tsx. What is left here is the arithmetic nobody else
// should own: which of the three screens (loading / playing / reveal) is on,
// plus the header that frames it.

import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ChainProvider, useChain } from "../state/ChainContext";
import { useAsync } from "../lib/useAsync";
import { todaySeed } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageLoader } from "../components/ui/Spinner";
import { ChainStopwatch } from "../components/chain/ChainStopwatch";
import { ChainTrail } from "../components/chain/ChainTrail";
import { MoveBox } from "../components/chain/MoveBox";
import { ChainResultsView } from "../components/chain/ChainResultsView";
import { ChainLeaderboard } from "../components/chain/ChainLeaderboard";

/** The route element: the store, then the screen that reads it. */
export function ChainPage() {
  return (
    <ChainProvider>
      <ChainScreen />
    </ChainProvider>
  );
}

/**
 * The screen itself, exported separately so tests can wrap it in a
 * `<ChainProvider api={mock}>` of their own.
 */
export function ChainScreen() {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const seed = searchParams.get("seed") ?? undefined;

  const {
    game,
    results,
    pending,
    error,
    moveError,
    seconds,
    createGame,
    loadGame,
    search,
    move,
    giveUp,
    getLeaderboard,
    clearError,
  } = useChain();

  // "/chain" with no id: create a round, then replace the URL with its own.
  // The ref is what keeps React 19's double-invoked effects (and any
  // re-render while the POST is in flight) from dealing two chains.
  const creating = useRef(false);
  useEffect(() => {
    if (gameId || creating.current) return;
    creating.current = true;
    void createGame(seed).then((created) => {
      if (created) navigate(`/chain/${created.id}`, { replace: true });
      // A failure has to be retryable, so release the latch.
      else creating.current = false;
    });
  }, [gameId, seed, createGame, navigate]);

  // Landing on /chain/:id directly (a reload, a shared link) hydrates from
  // the server. Arriving via the redirect above, the round is already in the
  // store and this does nothing.
  useEffect(() => {
    if (!gameId || game?.id === gameId) return;
    void loadGame(gameId);
  }, [gameId, game?.id, loadGame]);

  // The leaderboard is only fetched once a chain has ended, and it is keyed
  // on the finished round so the row for the chain just played is there when
  // the table appears rather than one refresh later.
  const finishedId = results ? results.game.id : null;
  const { data: board } = useAsync(
    () => (finishedId ? getLeaderboard() : Promise.resolve([])),
    [finishedId, getLeaderboard],
  );

  /* ---- Screen 1: still getting a chain -------------------------------- */

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
    return <PageLoader label={gameId ? "Loading the chain" : "Finding two films"} />;
  }

  /* ---- Screen 2: the reveal ------------------------------------------- */

  if (results) {
    return (
      <div className="flex flex-col gap-10">
        <ChainResultsView results={results} />

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-muted">Finished chains</h2>
          <ChainLeaderboard entries={board ?? []} highlightId={results.game.id} />
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/chain">
            <Button>New chain</Button>
          </Link>
          <Link to={`/chain?seed=${todaySeed()}`}>
            <Button variant="secondary">Today&rsquo;s daily pair</Button>
          </Link>
          <Link to="/modes">
            <Button variant="ghost">Other modes</Button>
          </Link>
        </div>
      </div>
    );
  }

  /* ---- Screen 3: playing ---------------------------------------------- */

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent">
            The Chain
            {game.seed && <span className="ml-2 text-muted">daily · {game.seed}</span>}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl">
            {game.start.title} <span className="text-muted">to</span> {game.target.title}
          </h1>
          {/* Each figure is one element with its whole phrase inside, so it
              reads as a unit to a screen reader instead of a loose number. */}
          <p className="mt-1 text-xs text-bone-dim">
            <span className="tabular-nums text-bone">
              {game.steps} {game.steps === 1 ? "film" : "films"} so far
            </span>{" "}
            · every pair is dealt three steps apart
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ChainStopwatch
            seconds={seconds}
            maxSeconds={game.max_seconds}
            finished={game.status === "complete"}
          />
          <Button
            variant="secondary"
            onClick={() => void giveUp()}
            loading={pending === "giving-up"}
            title="Stop the round and see a shortest route"
          >
            Show me
          </Button>
        </div>
      </header>

      {/* Page-level failures only; a refused move belongs to the move box. */}
      {error && <ErrorBanner message={error} />}

      <ChainTrail start={game.start} target={game.target} route={game.route} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <MoveBox
          here={game.here.title}
          target={game.target.title}
          submitting={pending === "moving"}
          error={moveError}
          onSearch={search}
          onSubmit={(title) => void move(title)}
        />

        <aside className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-5 text-sm text-bone-dim">
          <p>
            Two films, and a cast list between them. Name any film that shares an actor with the
            one you are standing on and you move to it, and the game tells you who made the link.
          </p>
          <ul className="flex flex-col gap-2 text-xs">
            <li>
              <Chip tone="accent">Three steps apart</Chip>{" "}
              <span className="ml-1">
                every pair is searched for until the shortest route between them is exactly three
                films. Three is the number to beat, and it is always reachable.
              </span>
            </li>
            <li>
              <Chip tone="accent">No going back</Chip>{" "}
              <span className="ml-1">
                a film you have already visited cannot be used twice, so a route can never be
                padded out.
              </span>
            </li>
            <li>
              <Chip tone="accent">The clock is a tiebreak</Chip>{" "}
              <span className="ml-1">
                it never stops you playing. Chains are ranked on arriving first, then on fewest
                films, and only then on time.
              </span>
            </li>
            <li>
              <Chip tone="accent">Stop whenever</Chip>{" "}
              <span className="ml-1">
                a shortest route is revealed either way. Giving up is ranked below arriving, not
                hidden.
              </span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
