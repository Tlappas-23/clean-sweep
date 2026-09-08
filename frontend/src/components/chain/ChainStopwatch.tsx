// ChainStopwatch: the elapsed clock, shown as M:SS.
//
// The mirror image of GridClock, and the difference is the point. Six Degrees
// counts down, and running out is the ending, so its last thirty seconds turn
// red and pulse. A chain counts *up*, and the number is a measurement rather
// than a threat: it is the tiebreak between two players who found routes of
// the same length. So it is quiet almost all the way, and its ring *fills*
// instead of draining.
//
// There is still an end, because an abandoned round cannot sit on the
// leaderboard forever, and the last thirty seconds before the cap say so. The
// treatment is the same accent-to-loss shift the grid uses, so a player who
// has met one clock recognises the other.
//
// The number it renders is a display copy of the server's `seconds`, ticked
// by ChainContext (src/state/ChainContext.tsx); nothing here decides anything
// about the round. See that file for why the local stopwatch is never
// authoritative.

import { useReducedMotion } from "../../lib/useReducedMotion";

/** Seconds left before the cap at which the clock switches to its urgent treatment. */
export const CHAIN_URGENT_SECONDS = 30;

/** Seconds → "2:07". Exported because the tests read it as the contract. */
// eslint-disable-next-line react-refresh/only-export-components -- one small pure helper beside its only caller
export function formatStopwatch(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

interface Props {
  seconds: number;
  /** The cap, for the fill ring and for knowing when the end is close. */
  maxSeconds: number;
  /** A finished chain shows its time as a final figure, without the warning. */
  finished?: boolean;
}

export function ChainStopwatch({ seconds, maxSeconds, finished = false }: Props) {
  const reduced = useReducedMotion();
  const remaining = Math.max(0, maxSeconds - seconds);
  const urgent = !finished && maxSeconds > 0 && remaining <= CHAIN_URGENT_SECONDS;
  const fraction = maxSeconds > 0 ? Math.max(0, Math.min(1, seconds / maxSeconds)) : 0;

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
        urgent ? "border-loss/60 bg-loss/10" : "border-line bg-ink-2/70",
        urgent && !reduced ? "animate-pulse" : "",
      ].join(" ")}
    >
      {/* A conic ring filling clockwise: time spent, not time left. */}
      <span
        aria-hidden
        className="relative h-7 w-7 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${urgent ? "var(--color-loss)" : "var(--color-accent)"} ${fraction * 360}deg, var(--color-line) 0deg)`,
        }}
      >
        <span className="absolute inset-[3px] rounded-full bg-ink" />
      </span>

      <div className="flex flex-col leading-none">
        <span className="text-[9px] uppercase tracking-[0.25em] text-muted">
          {finished ? "Took" : "Elapsed"}
        </span>
        <span
          // `role="timer"` names the thing without turning it into a live
          // region: a screen reader should not be interrupted once a second.
          role="timer"
          aria-label={`${Math.max(0, Math.floor(seconds))} seconds elapsed`}
          className={`mt-1 font-display text-2xl tabular-nums ${urgent ? "text-loss" : "text-bone"}`}
        >
          {formatStopwatch(seconds)}
        </span>
      </div>
    </div>
  );
}
