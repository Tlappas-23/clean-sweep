// ChainLeaderboard: finished chains, best first.
//
// Ranked exactly as the server ranks them (`leaderboard_key` in
// backend/app/engine/chain.py), and the three columns are the three parts of
// that key in order: arrived, then fewest films, then fastest. Showing them
// in ranking order is what makes the table self-explanatory. A reader who
// wonders why one row is above another can see the answer by reading left to
// right, without a legend.
//
// The columns are deliberately not blended into a single score. A fast bad
// route and a slow good one are different achievements, and one number would
// have to decide which is worth more. This table declines to.

import type { ChainLeaderboardEntry } from "../../api/types";
import { Chip } from "../ui/Chip";
import { formatStopwatch } from "./ChainStopwatch";

interface Props {
  entries: ChainLeaderboardEntry[];
  /** The round just played, highlighted so a player can find themselves. */
  highlightId?: string;
}

export function ChainLeaderboard({ entries, highlightId }: Props) {
  if (!entries.length) {
    return (
      <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-bone-dim">
        No chains have been finished yet. Yours will be the first.
      </p>
    );
  }

  return (
    // The table scrolls inside its own container rather than making the page
    // scroll sideways on a narrow screen.
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[30rem] text-sm">
        <caption className="sr-only">
          Finished chains, ranked by whether they arrived, then by fewest films, then by time
        </caption>
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-[0.2em] text-muted">
            <th scope="col" className="px-4 py-3 text-left font-normal">
              #
            </th>
            <th scope="col" className="px-4 py-3 text-left font-normal">
              Result
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Films
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Time
            </th>
            <th scope="col" className="px-4 py-3 text-left font-normal">
              Board
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const mine = entry.id === highlightId;
            return (
              <tr
                key={entry.id}
                className={`border-b border-line/50 last:border-0 ${mine ? "bg-accent/5" : ""}`}
              >
                <td className="px-4 py-3 tabular-nums text-muted">{index + 1}</td>
                <td className="px-4 py-3">
                  {entry.solved ? (
                    <Chip tone="win">Arrived</Chip>
                  ) : (
                    <Chip tone="neutral">Did not arrive</Chip>
                  )}
                  {mine && <span className="ml-2 text-[11px] text-accent">this round</span>}
                </td>
                {/* A chain that never arrived has a step count, but it counted
                    towards nothing, so the number is withheld rather than
                    printed next to the ones that mean something. */}
                <td className="px-4 py-3 text-right tabular-nums text-bone">
                  {entry.solved ? entry.steps : <span className="text-muted">not scored</span>}
                  {entry.solved && entry.steps === entry.par && (
                    <span className="ml-1.5 text-[11px] text-win">par</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-bone-dim">
                  {formatStopwatch(entry.seconds)}
                </td>
                <td className="px-4 py-3 text-[11px] text-muted">{entry.seed ?? "one-off"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
