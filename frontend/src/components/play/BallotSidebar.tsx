// BallotSidebar: the eight category slots with picks so far.
//
// Sticky column on desktop, a collapsible drawer under the machine on
// mobile. Slots follow `category_order` (a category skip rotates it), so the
// list visibly reorders when the player defers a category.

import { useState } from "react";
import type { GameState } from "../../api/types";
import { BALLOT_SLOTS, CATEGORY_LABELS, isGenreCategory } from "../../lib/labels";

interface Props {
  game: GameState;
}

export function BallotSidebar({ game }: Props) {
  const [open, setOpen] = useState(false);
  const filled = game.picks.length;

  return (
    <aside className="lg:sticky lg:top-6" aria-label="Your ballot">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-t-xl border border-line bg-ink-3 px-4 py-3 text-left lg:pointer-events-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ballot-slots"
      >
        <span>
          <span className="block text-[10px] uppercase tracking-[0.3em] text-gold">Ballot</span>
          <span className="font-display text-lg">{filled} of {BALLOT_SLOTS} locked</span>
        </span>
        <span className="text-xs text-ivory-dim lg:hidden">{open ? "Hide" : "Show"}</span>
      </button>
      <ol
        id="ballot-slots"
        className={`divide-y divide-line/60 rounded-b-xl border border-t-0 border-line bg-ink-2/80 ${open ? "" : "hidden lg:block"}`}
      >
        {game.category_order.map((category, i) => {
          const pick = game.picks.find((p) => p.category === category);
          const isCurrent = game.status !== "complete" && i === game.round - 1;
          return (
            <li
              key={category}
              className={`flex items-start gap-3 px-4 py-3 text-sm ${isCurrent ? "bg-gold/5" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={`mt-0.5 w-5 shrink-0 font-display text-base ${pick ? "text-gold" : "text-muted"}`}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wider text-ivory-dim">
                  {CATEGORY_LABELS[category]}
                  {/* The two genre slots are scored against a crown, not an
                      Oscar; marking them keeps the ballot honest at a glance. */}
                  {isGenreCategory(category) && (
                    <span className="ml-1.5 text-[10px] text-gold/70" title="Judged against the genre crown, not an Academy Award">
                      crown
                    </span>
                  )}
                </p>
                {pick ? (
                  <>
                    <p className="truncate text-ivory">{pick.contender.person_name ?? pick.contender.film_title}</p>
                    <p className="truncate text-xs text-muted">
                      {pick.contender.person_name ? `${pick.contender.film_title} · ` : ""}
                      {pick.year}
                    </p>
                  </>
                ) : (
                  <p className={`text-xs ${isCurrent ? "text-gold" : "text-muted"}`}>
                    {isCurrent ? "Picking now" : "Open"}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
