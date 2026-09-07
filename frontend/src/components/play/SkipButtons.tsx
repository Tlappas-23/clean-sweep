// SkipButtons: the two per-game skips with their remaining counts.
// Disabled when the count is zero or the game is not in "picking".
import type { SkipsRemaining } from "../../api/types";
import { Button } from "../ui/Button";

interface Props {
  skips: SkipsRemaining;
  disabled: boolean;
  onSkip: (kind: "year" | "category") => void;
}

export function SkipButtons({ skips, disabled, onSkip }: Props) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || skips.year <= 0}
        onClick={() => onSkip("year")}
        title="Re-spin the year reel, keeping the category"
      >
        Skip year
        <Count n={skips.year} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || skips.category <= 0}
        onClick={() => onSkip("category")}
        title="Defer this category to the end, keeping the year"
      >
        Skip category
        <Count n={skips.category} />
      </Button>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-gold/15 px-1.5 text-[10px] tabular-nums" aria-label={`${n} remaining`}>
      {n}
    </span>
  );
}
