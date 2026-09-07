// SpinBanner: after the reels settle, states the assignment in words —
// "Round 3 · 1994 · Best Actor" — plus the skip buttons.
import type { GameState } from "../../api/types";
import { CATEGORY_LABELS } from "../../lib/labels";
import { SkipButtons } from "./SkipButtons";

interface Props {
  game: GameState;
  disabled: boolean;
  onSkip: (kind: "year" | "category") => void;
}

export function SpinBanner({ game, disabled, onSkip }: Props) {
  const spin = game.current_spin;
  if (!spin) return null;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gold/30 bg-gold/5 px-5 py-4 animate-rise sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-gold">
          Round {game.round} of 6 · {spin.decade}
        </p>
        <h2 className="mt-1 text-2xl sm:text-3xl">
          <span className="text-gilded">{spin.year}</span>
          <span className="mx-3 text-muted">·</span>
          {CATEGORY_LABELS[spin.category]}
        </h2>
        <p className="mt-1 text-xs text-ivory-dim">
          Pick the strongest {spin.category === "picture" ? "film" : "performance"} of {spin.year} for this slot. Nominees are in the pool with everyone else.
        </p>
      </div>
      <SkipButtons skips={game.skips_remaining} disabled={disabled} onSkip={onSkip} />
    </div>
  );
}
