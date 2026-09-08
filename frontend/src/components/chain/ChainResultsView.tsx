// ChainResultsView: the reveal, once a chain has ended.
//
// The whole screen is built around one comparison: the route the player
// walked, and a shortest route, one above the other in the same visual
// language. That is the mode's argument. Taking a step more than necessary is
// a worse answer, not a wrong one, and the only honest way to say so is to
// show both and let the reader see the difference for themselves.
//
// Three endings arrive here and they are not the same experience: arriving,
// giving up, and running out the stopwatch. A player whose time went while
// they were on another tab should be told that is what happened rather than
// left to infer it from a route that stops in the middle.
//
// The shortest route is not shown as "the answer". There is usually more than
// one route of that length, and the header says so, because a player who
// found a different three-step route has not been beaten by this one.

import type { ChainResults } from "../../api/types";
import { Chip } from "../ui/Chip";
import { ChainTrail } from "./ChainTrail";
import { formatStopwatch } from "./ChainStopwatch";

/** What each ending is called, and how it is coloured. */
const ENDINGS: Record<ChainResults["ended"], { label: string; tone: "win" | "loss" | "neutral" }> = {
  solved: { label: "Arrived", tone: "win" },
  gave_up: { label: "Stopped", tone: "neutral" },
  time: { label: "Out of time", tone: "loss" },
};

/**
 * The line under the headline, which is where the result is actually
 * explained. Each ending gets its own sentence: a chain that ran out of time
 * and one that was abandoned look identical on the page otherwise.
 */
function verdict(results: ChainResults): string {
  if (!results.solved) {
    return results.ended === "time"
      ? "The stopwatch ran out before you got there. Here is a route that would have worked."
      : "You stopped before arriving. Here is a route that would have worked.";
  }
  if (results.steps === results.par) {
    return `You got there in ${results.steps}, which is as short as this pair goes.`;
  }
  const spare = results.steps - results.par;
  return `You got there in ${results.steps}, ${spare} more than the shortest route. Still arrived.`;
}

interface Props {
  results: ChainResults;
}

export function ChainResultsView({ results }: Props) {
  const { game, solved, steps, par, seconds, ended, route, shortest } = results;
  const ending = ENDINGS[ended];
  // Only worth showing twice if the two routes actually differ. A player who
  // found the revealed route should see it once, marked as both.
  const sameRoute =
    route.length === shortest.length &&
    route.every((step, i) => step.film.film_id === shortest[i].film.film_id);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={ending.tone}>{ending.label}</Chip>
          {game.seed && <Chip>daily · {game.seed}</Chip>}
          {solved && steps === par && <Chip tone="win">Shortest possible</Chip>}
        </div>
        <h1 className="text-2xl sm:text-3xl">
          {game.start.title} <span className="text-muted">to</span> {game.target.title}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-bone-dim">{verdict(results)}</p>

        {/* The three figures the leaderboard ranks on, in the order it ranks
            them, so the table later reads as an explanation rather than a
            surprise. */}
        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-3">
          <Figure label="Films" value={String(steps)} note={`shortest is ${par}`} />
          <Figure label="Time" value={formatStopwatch(seconds)} note="start to finish" />
          <Figure
            label="Arrived"
            value={solved ? "Yes" : "No"}
            note={solved ? "the point of the game" : "ranked below every chain that did"}
          />
        </dl>
      </header>

      {route.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-muted">
            {sameRoute ? "Your route, and a shortest one" : "Your route"}
          </h2>
          <ChainTrail
            start={game.start}
            target={game.target}
            route={route}
            solved={solved}
            variant={sameRoute ? "revealed" : "played"}
          />
        </div>
      )}

      {!sameRoute && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-accent">
            A shortest route · {par} films
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-bone-dim">
            One of them. Pairs this close usually have several routes of the same length, so a
            different {par} is just as short as this one.
          </p>
          <ChainTrail
            start={game.start}
            target={game.target}
            route={shortest}
            solved
            variant="revealed"
          />
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-[0.25em] text-muted">{label}</dt>
      <dd className="font-display text-2xl leading-none tabular-nums text-bone">{value}</dd>
      <dd className="text-[11px] text-bone-dim">{note}</dd>
    </div>
  );
}
