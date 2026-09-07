// SpinBanner: after the reels settle, states the assignment in words —
// "Round 3 of 8 · 1975 / 1994 / 2008 · Best Actor" — plus the round's reroll
// and the game's category skip.
//
// The years are listed here as well as on the reels because the banner is the
// screen-reader-friendly statement of the board: three years, any of which the
// pick may come from, or one year the round is locked to.

import type { GameState, SkipKind } from "../../api/types";
import { BALLOT_SLOTS, CATEGORY_LABELS, isGenreCategory, isPersonCategory } from "../../lib/labels";
import { RerollButton } from "./RerollButton";
import { SkipButtons } from "./SkipButtons";

interface Props {
  game: GameState;
  disabled: boolean;
  rerolling: boolean;
  onSkip: (kind: SkipKind) => void;
  onReroll: () => void;
}

export function SpinBanner({ game, disabled, rerolling, onSkip, onReroll }: Props) {
  const spin = game.current_spin;
  if (!spin) return null;

  const years = spin.year_options.map((o) => o.year);
  const decades = [...new Set(spin.year_options.map((o) => o.decade))];
  const noun = isPersonCategory(spin.category) ? "performance" : "film";
  const genre = isGenreCategory(spin.category);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gold/30 bg-gold/5 px-5 py-4 animate-rise lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.3em] text-gold">
          Round {game.round} of {BALLOT_SLOTS} · {decades.join(" / ")}
        </p>
        <h2 className="mt-1 text-2xl sm:text-3xl">
          <span className="text-gilded tabular-nums">{years.join(" · ")}</span>
          <span className="mx-3 text-muted">·</span>
          {CATEGORY_LABELS[spin.category]}
        </h2>
        <p className="mt-1 text-xs text-ivory-dim">
          {spin.locked ? (
            <>
              This round is locked to <span className="tabular-nums text-ivory">{years[0]}</span> —
              the reroll is spent, so the pick has to come from that year.
            </>
          ) : years.length > 1 ? (
            <>
              Draft the strongest {noun} for this slot from{" "}
              <span className="text-ivory">any of these {years.length} years</span>. Nominees are in
              the pool with everyone else.
            </>
          ) : (
            <>
              Draft the strongest {noun} of {years[0]} for this slot. Nominees are in the pool with
              everyone else.
            </>
          )}
        </p>
        {/* The two genre slots are not Academy Awards, and a player who does
            not know that will draft them as though they were. */}
        {genre && (
          <p className="mt-1 text-xs text-gold/80">
            Not an Academy Award: this slot is scored against the genre crown — the year&rsquo;s
            top-rated {spin.category} film takes 100, the next four take 60.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-start gap-3">
        <RerollButton spin={spin} disabled={disabled} rerolling={rerolling} onReroll={onReroll} />
        <SkipButtons skips={game.skips_remaining} disabled={disabled} onSkip={onSkip} />
      </div>
    </div>
  );
}
