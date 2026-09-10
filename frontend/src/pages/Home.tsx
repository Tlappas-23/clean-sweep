// Home: the Six Degrees board, before it is dealt.
//
// This page used to be a hero and a row of mode tiles: a description of four
// games, one click away from any of them. It is now the game itself. A
// visitor lands on a board with the six names still covered, presses Start,
// and is playing.
//
// Why the board is a placeholder rather than a real round with the names
// hidden
// -------------------------------------------------------------------------
// A Six Degrees round carries a three-minute clock that starts the moment the
// board is created (backend/app/engine/grid.py). Dealing one here would run
// that clock against somebody who is still reading, and by the time they
// pressed Start the round could already be over. So nothing is fetched: the
// board on this screen is a shape, and Start is what creates the real one.
//
// MaskedBoard draws to the same grid template as GridBoard, so the swap is a
// reveal rather than a reflow.
//
// The other two modes are not here. They live in the Game modes menu in the
// header (src/components/layout/AppShell.tsx), which is what a menu is for:
// this page has one job, and offering four choices was the old page's job.
//
// Two rules this page enforces
// ----------------------------
// **A live round locks the door.** The clock runs whether or not anybody is
// watching it, so a Start button that deals a *new* board is a way to restart
// the clock by pressing Home. If a round is still in play, this screen
// resumes it and does not offer another.
//
// **Today's daily is one attempt.** It is the same board for everybody, and a
// second go at it is a different game from the one everyone else played. Once
// it has been started, at all, the daily is spent for the day and a fresh
// random board is offered instead.
//
// Both are read from src/lib/activeRound.ts, which is browser storage, and
// that file says plainly why the server cannot do this: there are no
// accounts, so it has no idea who is asking. These are guard rails, not
// locks.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorMessage } from "../api";
import { todaySeed } from "../lib/format";
import { dailyAttempt, liveRound } from "../lib/activeRound";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Monogram } from "../components/layout/Monogram";
import { MaskedBoard } from "../components/grid/MaskedBoard";

export function HomePage() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState<"fresh" | "daily" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // React 19 double-invokes effects and a second click can land while the
  // POST is in flight; either would deal two boards and abandon one.
  const dealing = useRef(false);

  // Read once on mount, not on every render: both answers only change by
  // playing, which leaves this page. Held in state so the screen re-renders
  // if a round finishes while it is open.
  const seed = todaySeed();
  const [resume, setResume] = useState(() => liveRound());
  const [dailySpent, setDailySpent] = useState(() => dailyAttempt(seed) !== null);

  useEffect(() => {
    // Coming back to the tab can be the moment a round's clock ran out, which
    // turns Resume into Start without anything else happening on screen.
    const refresh = () => {
      setResume(liveRound());
      setDailySpent(dailyAttempt(seed) !== null);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [seed]);

  async function start(kind: "fresh" | "daily") {
    if (dealing.current) return;
    dealing.current = true;
    setStarting(kind);
    setError(null);
    try {
      const game = await api.createGridGame(kind === "daily" ? seed : undefined);
      navigate(`/grid/${game.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setStarting(null);
      dealing.current = false; // a failure has to be retryable
    }
  }

  // Releases the latch if the component is still mounted after a failure.
  useEffect(() => () => void (dealing.current = false), []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
      <section className="flex w-full flex-col items-center text-center">
        <Monogram />
        <p className="mt-3 text-[10px] uppercase tracking-[0.45em] text-accent/90">Six Degrees</p>
        <h1 className="text-silvered animate-glow mt-2 text-2xl leading-tight sm:text-4xl">
          Name the actor who connects them
        </h1>
        <p className="mt-3 max-w-lg text-balance text-sm leading-relaxed text-bone-dim">
          Three down the side, three across the top, and nobody on one axis has worked with anybody
          on the other.
        </p>
      </section>

      {/* The board, covered.
          Capped rather than filling the column: at full width on a laptop the
          square cells push Start below the fold, and a game whose start
          button needs scrolling to is a game nobody starts. Small enough that
          the mark, the board and the button are one glance. */}
      <div className="mt-6 w-full max-w-lg">
        <MaskedBoard busy={starting !== null} />
      </div>

      {error && (
        <div className="mt-6 w-full">
          <ErrorBanner message={error} onRetry={() => void start(starting ?? "fresh")} />
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        {resume ? (
          <>
            {/* Resume, never Start. Dealing a new board here would hand back
                a fresh three minutes, which is the whole exploit this is
                closing: the clock is running on the board you already have. */}
            <Link to={`/grid/${resume.id}`}>
              <Button size="lg" className="min-w-[12rem]">
                Resume your board
              </Button>
            </Link>
            <p className="max-w-sm text-center text-xs text-muted">
              {resume.seed ? "Today's board" : "Your board"} is still running. The clock does not
              stop when you leave, so there is nothing to gain by coming back here.
            </p>
          </>
        ) : (
          <>
            <Button
              size="lg"
              onClick={() => void start("fresh")}
              loading={starting === "fresh"}
              disabled={starting !== null}
              className="min-w-[12rem]"
            >
              Start
            </Button>

            {dailySpent ? (
              // Spent, not hidden. Somebody who played it should be told the
              // rule rather than left wondering where the option went.
              <p className="max-w-sm text-center text-xs text-muted">
                You have played today&rsquo;s board. It is the same three by three for everybody,
                so it is one attempt a day. Random boards are unlimited.
              </p>
            ) : (
              <p className="text-xs text-muted">
                or play{" "}
                <button
                  type="button"
                  onClick={() => void start("daily")}
                  disabled={starting !== null}
                  className="text-accent underline-offset-4 hover:underline disabled:opacity-60"
                >
                  today&rsquo;s daily board
                </button>
                , the same three by three for everyone. One attempt.
              </p>
            )}
          </>
        )}
      </div>

      {/* The rules, in the order a player meets them. Four lines, because
          anything longer is a page nobody reads standing in front of a game
          they could already be playing. */}
      <ul className="mt-10 flex w-full max-w-xl flex-col gap-2.5 text-xs leading-relaxed text-bone-dim">
        <li>
          <Chip tone="accent">Three minutes</Chip>{" "}
          <span className="ml-1">
            the clock starts when you press Start, and the board scores itself when it runs out.
          </span>
        </li>
        <li>
          <Chip tone="accent">Rarer is worth more</Chip>{" "}
          <span className="ml-1">
            any genuine link scores at least 60, but the obvious one stops there. The most obscure
            actor who still connects them is worth 100.
          </span>
        </li>
        <li>
          <Chip tone="accent">No autocomplete</Chip>{" "}
          <span className="ml-1">
            type the whole name, since a list of suggestions would be a list of the answers.
            Spelling is forgiven.
          </span>
        </li>
        <li>
          <Chip tone="accent">One actor per board</Chip>{" "}
          <span className="ml-1">
            a well-connected name cannot fill a whole row. Each connector may be played once.
          </span>
        </li>
      </ul>

      <p className="mt-8 text-center text-xs text-muted">
        Two other games are in{" "}
        <Link to="/modes" className="text-accent/90 underline-offset-4 hover:underline">
          Game modes
        </Link>
        : an eight-slot awards ballot, and getting from one film to another through their casts.
      </p>
    </div>
  );
}
