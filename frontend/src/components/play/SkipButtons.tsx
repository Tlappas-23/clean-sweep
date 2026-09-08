// SkipButtons: the per-game category skip with its remaining count.
//
// There used to be a year skip beside it. It was replaced by the per-round
// reroll (see RerollButton), which is tracked on the spin rather than counted
// here. So this is deliberately a one-button row rather than a pair.
// Disabled when the count is zero or the game is not in "picking".
import type { SkipKind, SkipsRemaining } from "../../api/types";
import { Button } from "../ui/Button";

interface Props {
  skips: SkipsRemaining;
  disabled: boolean;
  onSkip: (kind: SkipKind) => void;
}

export function SkipButtons({ skips, disabled, onSkip }: Props) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || skips.category <= 0}
        onClick={() => onSkip("category")}
        title="Defer this category to the end of the ballot and draft the next one, on a fresh set of years"
      >
        Skip category
        <Count n={skips.category} />
      </Button>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-accent/15 px-1.5 text-[10px] tabular-nums" aria-label={`${n} remaining`}>
      {n}
    </span>
  );
}
