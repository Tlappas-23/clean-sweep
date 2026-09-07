// RerollButton: the round's one gamble, stated in full before it is spent.
//
// The reroll throws away every year on the board for a single fresh one that
// then *has* to be used (docs/GAME_DESIGN.md §2). That is a genuinely bad
// trade if the player misreads it as a free re-spin, so the stake is written
// on the control itself rather than hidden in a tooltip: the label names what
// is lost, the line underneath names the catch.
//
// Once the reroll is spent the button goes away entirely and the caption
// switches to "this round is committed to <year>", because there is no longer
// a decision to present.

import type { Spin } from "../../api/types";
import { Button } from "../ui/Button";

interface Props {
  spin: Spin;
  /** True while any game action is in flight. */
  disabled: boolean;
  /** True while this specific call is in flight. */
  rerolling: boolean;
  onReroll: () => void;
}

export function RerollButton({ spin, disabled, rerolling, onReroll }: Props) {
  const yearCount = spin.year_options.length;

  // Spent: the board is down to one year and the round is committed to it.
  if (spin.locked || !spin.reroll_available) {
    const only = spin.year_options[0];
    return (
      <p className="shrink-0 rounded-md border border-line px-3 py-2 text-xs text-ivory-dim">
        <span className="block text-[10px] uppercase tracking-[0.2em] text-muted">
          Reroll spent
        </span>
        {only ? (
          <>
            This round is committed to{" "}
            <span className="tabular-nums text-gold">{only.year}</span>.
          </>
        ) : (
          "This round is committed to the year on the board."
        )}
      </p>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        loading={rerolling}
        onClick={onReroll}
        title="Trade every year on the board for one fresh year you then have to use"
      >
        Reroll: trade all {yearCount === 3 ? "three" : yearCount} years for one you must use
      </Button>
      <span className="text-[10px] text-muted">
        One per round. The new year is the only one left — no going back.
      </span>
    </div>
  );
}
