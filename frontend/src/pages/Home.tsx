// Home: the lobby. Hero, the three ways to start a game, and a "how to play"
// summary of docs/GAME_DESIGN.md.
//
// Route "/" (src/App.tsx). Starting a game goes through the game store
// (`useGame().createGame`) rather than the API client directly, so the new
// GameState is already in context when we navigate to /play/:gameId — the
// Play page then renders instantly instead of re-fetching it.

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Mode } from "../api/types";
import { useGame } from "../state/GameContext";
import { useToast } from "../state/ToastContext";
import { todaySeed } from "../lib/format";
import { ALL_METRICS, CATEGORY_LABELS, CATEGORY_ORDER, MODE_LABELS } from "../lib/labels";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";

/** Which start button is waiting on POST /api/games (so only it spins). */
type StartKey = "classic" | "cinephile" | "daily";

export function HomePage() {
  const navigate = useNavigate();
  const { createGame, error, clearError } = useGame();
  const { push } = useToast();
  const [starting, setStarting] = useState<StartKey | null>(null);

  // The store keeps the last error; surface it as a toast (the `detail` string
  // from the API) and clear it so it cannot fire twice.
  useEffect(() => {
    if (!error) return;
    push(error, "error");
    clearError();
  }, [error, push, clearError]);

  const seed = todaySeed();

  async function start(key: StartKey, mode: Mode, gameSeed?: string) {
    setStarting(key);
    const game = await createGame(mode, gameSeed);
    setStarting(null);
    if (game) navigate(`/play/${game.id}`);
  }

  return (
    <div className="flex flex-col gap-16">
      {/* ---- Hero ---------------------------------------------------- */}
      <section className="flex flex-col items-center pt-6 text-center sm:pt-14">
        <p className="mb-4 text-[11px] uppercase tracking-[0.4em] text-gold">
          An Oscar-ballot drafting game
        </p>
        <h1 className="text-gilded animate-glow text-5xl leading-[1.05] sm:text-7xl">Clean Sweep</h1>
        <p className="mt-6 max-w-2xl text-base text-ivory-dim sm:text-lg">
          Spin for a year, draft one contender per category, then run your six-name ballot through a
          thirty-stop awards season. Win every stop and you have a{" "}
          <span className="text-gold">30&#8211;0 clean sweep</span>.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => void start("classic", "classic")}
            loading={starting === "classic"}
            disabled={starting !== null}
          >
            Play Classic
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void start("cinephile", "cinephile")}
            loading={starting === "cinephile"}
            disabled={starting !== null}
          >
            Play Cinephile
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => void start("daily", "classic", seed)}
            loading={starting === "daily"}
            disabled={starting !== null}
            title={`Everyone gets the same spins on ${seed}`}
          >
            Daily Challenge
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Daily seed <span className="tabular-nums text-ivory-dim">{seed}</span> — same spins for
          every player.{" "}
          <Link to="/leaderboard" className="text-gold hover:underline">
            See today&rsquo;s board
          </Link>
        </p>
      </section>

      <div className="rule-gold" aria-hidden />

      {/* ---- How to play --------------------------------------------- */}
      <section aria-labelledby="how-to-play">
        <h2 id="how-to-play" className="mb-8 text-center text-3xl">
          How to play
        </h2>

        <ol className="grid gap-5 md:grid-cols-3">
          <Step n={1} title="Spin the machine">
            Two reels deal you a <strong className="text-ivory">year</strong> and the next unfilled{" "}
            <strong className="text-ivory">category</strong>. The machine only deals years that
            actually had a winner in that category, so every slot can be filled perfectly.
          </Step>
          <Step n={2} title="Draft a contender">
            The pool is every notable film or performance of that year — not just the nominees. In
            Classic you see four strength metrics; in Cinephile you see nothing but the names.
          </Step>
          <Step n={3} title="Run the season">
            Six picks make a ballot. Thirty ceremonies, each with its own threshold and its own
            emphasis, decide your record.
          </Step>
        </ol>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {/* The six ballot slots, in draft order. */}
          <Panel title="Six slots, one ballot">
            <ol className="flex flex-col gap-1.5 text-sm">
              {CATEGORY_ORDER.map((category, i) => (
                <li key={category} className="flex items-baseline gap-3">
                  <span className="w-4 shrink-0 font-display text-gold">{i + 1}</span>
                  <span className="text-ivory">{CATEGORY_LABELS[category]}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-ivory-dim">
              Categories are always drafted in this order — the slot machine randomises the year, not
              the order.
            </p>
          </Panel>

          {/* Metric glossary, straight from lib/labels so it cannot drift. */}
          <Panel title="Five strength metrics">
            <dl className="flex flex-col gap-2.5 text-sm">
              {ALL_METRICS.map((m) => (
                <div key={m.id}>
                  <dt className="text-ivory">{m.label}</dt>
                  <dd className="text-xs text-ivory-dim">{m.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-ivory-dim">
              Each is 0&#8211;100 and scored against the contender&rsquo;s own film year. The six pick
              scores add up to a ballot strength of 0&#8211;600.
            </p>
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title="Two skips per game">
              <ul className="flex flex-col gap-2 text-sm text-ivory-dim">
                <li>
                  <Chip tone="gold">Year skip ×1</Chip>{" "}
                  <span className="ml-1">re-spins the year, keeping the category.</span>
                </li>
                <li>
                  <Chip tone="gold">Category skip ×1</Chip>{" "}
                  <span className="ml-1">
                    defers the category to the end of the ballot, keeping the year.
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-ivory-dim">
                Spend them when the machine lands on a thin year for the slot you need.
              </p>
            </Panel>

            <Panel title="The deficiency rule">
              <p className="text-sm text-ivory-dim">
                Every ceremony weights the six categories differently — an actors&rsquo; body leans on
                the four acting slots, a directors&rsquo; guild on Best Director. One weak pick costs
                you the ceremonies that care about it, however strong your total is.
              </p>
            </Panel>
          </div>
        </div>

        {/* Mode comparison, using the same copy the toolbar and cards use. */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => (
            <div
              key={mode}
              className="flex flex-col gap-2 rounded-xl border border-line bg-ink-2/70 p-5"
            >
              <div className="flex items-center gap-3">
                <h3 className="text-xl text-ivory">{MODE_LABELS[mode].label}</h3>
                {mode === "cinephile" && <Chip>hard mode</Chip>}
              </div>
              <p className="text-sm text-ivory-dim">{MODE_LABELS[mode].description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** One numbered step in the "how to play" row. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-ink-2/70 p-5">
      <span className="font-display text-3xl text-gold/70">{String(n).padStart(2, "0")}</span>
      <h3 className="mt-2 text-xl text-ivory">{title}</h3>
      <p className="mt-2 text-sm text-ivory-dim">{children}</p>
    </li>
  );
}

/** Bordered card used for the reference panels below the steps. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-ink-2/70 p-5">
      <h3 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-gold">{title}</h3>
      {children}
    </section>
  );
}
