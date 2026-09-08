// WakeBanner: "the server is waking up".
//
// The API is on a free tier that sleeps after fifteen minutes idle and takes
// the better part of a minute to come back. That is a normal state, not a
// fault, but to anything watching a spinner it is indistinguishable from one.
//
// Silence is the worst option here: a phone showing a spinner for forty
// seconds reads as broken, and the player closes the tab several seconds
// before the thing would have worked. So this says what is happening and why,
// in one line, and disappears the moment a request gets through.
//
// It is deliberately not an error. No red, no retry button, nothing to act
// on: there is nothing for the player to do except wait a moment, and
// dressing a wait up as a failure would be a lie.

import { useEffect, useState } from "react";
import { onWaking } from "../../api";

/**
 * How long the API has to be unreachable before this appears.
 *
 * A first attempt can fail for reasons that resolve instantly, and flashing a
 * banner for 200ms is worse than showing nothing. Past this the wait is long
 * enough that the player deserves an explanation.
 */
const SHOW_AFTER_MS = 1_200;

export function WakeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    onWaking((waking) => {
      clearTimeout(timer);
      if (waking) timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
      else setVisible(false);
    });
    return () => {
      clearTimeout(timer);
      onWaking(null);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      // `status` rather than `alert`: this is progress, not a problem, and a
      // screen reader should hear it without being interrupted.
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2.5 border-b border-accent/20 bg-accent/5 px-4 py-2 text-center text-xs text-bone-dim"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
      />
      <span>
        <span className="text-bone">Waking the server.</span> It sleeps when nobody is playing, so
        the first move of the day takes a few seconds.
      </span>
    </div>
  );
}
