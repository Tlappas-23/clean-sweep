// Recast: the "who else could have played the part?" screen. Routes
// "/recast" and "/recast/:gameId".
//
// One route pattern serves both (`/recast/:gameId?` in src/App.tsx) so the
// component is not torn down and rebuilt on the hop between them. That hop is
// the page's first job: arriving at "/recast" with no id, it starts a round
// and replaces the URL with "/recast/:id", which is what makes a round a
// shareable, reloadable thing rather than a session that dies with the tab.
// A `?seed=YYYY-MM-DD` on the way in is passed straight to the server and
// produces the shared daily film — the same approach the Co-star Grid takes.
//
// Like Play and Grid, this page is orchestration only. The film, the cast
// list, the shortlist and the reveal are all in src/components/recast/*, and
// every rule about what a click means lives in src/state/RecastContext.tsx.
// What is left here is the arithmetic nobody else should own — which of the
// four screens (loading / not-built / reveal / casting) is on.
//
// The not-built screen is the one worth pointing at. Both side modes read
// seed tables the core pipeline does not build, and the backend answers 503
// with the commands to run rather than pretending the mode is broken
// (backend/app/api/deps.py, `require_people`). That is not a failure to
// retry, so it gets the empty state and the server's own words, not the
// error banner.

import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { RecastProvider, useRecast } from "../state/RecastContext";
import { todaySeed } from "../lib/format";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageLoader } from "../components/ui/Spinner";
import { FilmMarquee } from "../components/recast/FilmMarquee";
import { RoleList } from "../components/recast/RoleList";
import { ShortlistPanel } from "../components/recast/ShortlistPanel";
import { RecastResultsView } from "../components/recast/RecastResultsView";

/** The route element: the store, then the screen that reads it. */
export function RecastPage() {
  return (
    <RecastProvider>
      <RecastScreen />
    </RecastProvider>
  );
}

/**
 * The screen itself, exported separately so tests can wrap it in a
 * `<RecastProvider api={mock}>` of their own.
 */
export function RecastScreen() {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const seed = searchParams.get("seed") ?? undefined;

  const {
    game,
    results,
    shortlist,
    shortlistLoading,
    pending,
    error,
    errorStatus,
    castError,
    selectedId,
    createGame,
    loadGame,
    select,
    castSelected,
    clearError,
  } = useRecast();

  // "/recast" with no id: start a round, then replace the URL with its own.
  // The ref is what keeps React 19's double-invoked effects (and any
  // re-render while the POST is in flight) from dealing two rounds.
  const creating = useRef(false);
  useEffect(() => {
    if (gameId || creating.current) return;
    creating.current = true;
    void createGame(seed).then((created) => {
      if (created) navigate(`/recast/${created.id}`, { replace: true });
      // A failure has to be retryable, so release the latch.
      else creating.current = false;
    });
  }, [gameId, seed, createGame, navigate]);

  // Landing on /recast/:id directly (a reload, a shared link) hydrates from
  // the server. Arriving via the redirect above, the round is already in the
  // store and this does nothing.
  useEffect(() => {
    if (!gameId || game?.id === gameId) return;
    void loadGame(gameId);
  }, [gameId, game?.id, loadGame]);

  /* ---- Screen 1: the mode was never built ---------------------------- *
   * A 503 from either side mode means its seed tables are missing. There is
   * nothing to retry, so this is a destination rather than an error: the
   * server's message names the commands, and it is shown verbatim.        */

  if (errorStatus === 503) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="Recast has not been built yet"
          action={
            <Link to="/modes">
              <Button variant="secondary">Back to the modes</Button>
            </Link>
          }
        >
          This mode reads seed tables the core pipeline does not build, so a fresh checkout has the
          Oscars game and nothing else. The server says: {error}
        </EmptyState>
      </div>
    );
  }

  /* ---- Screen 2: still getting a round -------------------------------- */

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
    return <PageLoader label={gameId ? "Loading the round" : "Casting a film"} />;
  }

  /* ---- Screen 3: the reveal ------------------------------------------ */

  if (results) {
    return (
      <div className="flex flex-col gap-8">
        <RecastResultsView results={results} />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/recast">
            <Button>Recast another film</Button>
          </Link>
          <Link to={`/recast?seed=${todaySeed()}`}>
            <Button variant="secondary">Today&rsquo;s daily film</Button>
          </Link>
          <Link to="/modes">
            <Button variant="ghost">Other modes</Button>
          </Link>
        </div>
      </div>
    );
  }

  /* ---- Screen 4: casting ---------------------------------------------- */

  const role = game.roles[game.current_role] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <FilmMarquee film={game.film} seed={game.seed} />

      {/* The daily round is a client-side URL, so the offer to play it
          belongs here rather than coming from the server. It is only worth
          showing on a round that is not already one. */}
      {!game.seed && (
        <p className="text-xs text-muted">
          A fresh film each time. Or play{" "}
          <Link
            to={`/recast?seed=${todaySeed()}`}
            className="text-gold hover:underline"
            title={`Everyone gets the same film on ${todaySeed()}`}
          >
            today&rsquo;s daily film
          </Link>
          , which is the same for everybody.
        </p>
      )}

      {/* Page-level failures only; a refused casting belongs to the
          shortlist and is rendered there. */}
      {error && <ErrorBanner message={error} onRetry={clearError} />}

      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* On a phone the shortlist comes first: the cast list is context,
            and context should not push the decision below the fold. */}
        <div className="order-2 lg:order-1">
          <RoleList roles={game.roles} picks={game.picks} currentRole={game.current_role} />
        </div>

        <div className="order-1 lg:order-2">
          {role ? (
            <ShortlistPanel
              role={role}
              actors={shortlist}
              loading={shortlistLoading}
              casting={pending === "casting"}
              selectedId={selectedId}
              error={castError}
              onSelect={select}
              onConfirm={() => void castSelected()}
            />
          ) : (
            // Every role is cast and the reveal is on its way: the server
            // decides when a round is over, so this is the beat between its
            // last response and the results arriving.
            <PageLoader label="Scoring the casting" />
          )}
        </div>
      </div>
    </div>
  );
}
