// GridClock: the three-minute countdown, shown as M:SS.
//
// The number it renders is a display copy of the server's
// `seconds_remaining`, ticked down by GridContext (src/state/GridContext.tsx);
// nothing here decides anything about the round. See that file for why the
// local clock is never authoritative.
//
// The last thirty seconds are the point of a timed mode, so they change the
// treatment: gold becomes the loss red and the ring pulses. The pulse is a
// slow opacity breath rather than a flash, and it is dropped entirely under
// `prefers-reduced-motion` — the colour and the label still carry the
// urgency, so nothing is lost by removing the motion.

import { useReducedMotion } from "../../lib/useReducedMotion";

/** Below this many seconds the clock switches to its urgent treatment. */
export const URGENT_SECONDS = 30;

/** Seconds → "2:07". Exported because the tests read it as the contract. */
// eslint-disable-next-line react-refresh/only-export-components -- one small pure helper beside its only caller
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

interface Props {
  seconds: number;
  /** The round's full length, for the depletion ring. */
  roundSeconds: number;
  /** A finished board shows its clock spent, without the urgent styling. */
  finished?: boolean;
}

export function GridClock({ seconds, roundSeconds, finished = false }: Props) {
  const reduced = useReducedMotion();
  const urgent = !finished && seconds <= URGENT_SECONDS;
  const fraction = roundSeconds > 0 ? Math.max(0, Math.min(1, seconds / roundSeconds)) : 0;

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
        urgent ? "border-loss/60 bg-loss/10" : "border-line bg-ink-2/70",
        // The breath only ever runs in the last thirty seconds, and never for
        // a reader who asked for less motion.
        urgent && !reduced ? "animate-pulse" : "",
      ].join(" ")}
    >
      {/* A conic ring draining anticlockwise: the shape of the remaining time
          reads before the digits do. */}
      <span
        aria-hidden
        className="relative h-7 w-7 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${urgent ? "var(--color-loss)" : "var(--color-gold)"} ${fraction * 360}deg, var(--color-line) 0deg)`,
        }}
      >
        <span className="absolute inset-[3px] rounded-full bg-ink" />
      </span>

      <div className="flex flex-col leading-none">
        <span className="text-[9px] uppercase tracking-[0.25em] text-muted">
          {finished ? "Time" : "Remaining"}
        </span>
        <span
          // `role="timer"` names the thing without turning it into a live
          // region: a screen reader should not be interrupted once a second.
          role="timer"
          aria-label={`${Math.max(0, Math.floor(seconds))} seconds remaining`}
          className={`mt-1 font-display text-2xl tabular-nums ${urgent ? "text-loss" : "text-ivory"}`}
        >
          {formatClock(seconds)}
        </span>
      </div>
    </div>
  );
}
