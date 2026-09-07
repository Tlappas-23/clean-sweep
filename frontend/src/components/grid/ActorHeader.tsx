// ActorHeader: one actor's label on the edge of the board.
//
// Rendered six times per grid — three across the top, three down the left —
// with `orientation` deciding only the text alignment, so the two edges
// cannot drift apart in what they say about an actor.
//
// What it shows and why: the name is the question, so it is the loud part.
// Underneath it, quietly, sit the two facts that actually help a player aim:
// the casting type (a cluster label from the actor model — knowing a column
// is a working character actor tells you which shelf to reach for) and the
// size and span of the filmography. Neither is scored; both are hints, so
// both are muted.

import type { ActorCard } from "../../api/types";

interface Props {
  actor: ActorCard;
  /** "column" heads a column across the top; "row" labels a row down the side. */
  orientation: "row" | "column";
}

export function ActorHeader({ actor, orientation }: Props) {
  const isColumn = orientation === "column";
  return (
    <div
      className={[
        // Both branches set their own `justify-*`: two of them in the base
        // class would be resolved by stylesheet order rather than by this
        // ternary, which is how the row labels drifted to the foot of their
        // row instead of sitting level with it.
        "flex h-full flex-col gap-0.5 p-1.5 sm:p-2",
        isColumn
          ? "items-center justify-end text-center"
          : "items-start justify-center text-left",
      ].join(" ")}
    >
      <span className="font-display text-[13px] leading-tight text-bone sm:text-base">
        {actor.name}
      </span>
      {actor.casting_type && (
        <span className="text-[9px] uppercase leading-tight tracking-[0.15em] text-accent/70 sm:text-[10px]">
          {actor.casting_type}
        </span>
      )}
      <span className="text-[9px] leading-tight text-muted sm:text-[10px]">
        <span className="tabular-nums">{actor.n_films}</span> films ·{" "}
        <span className="tabular-nums">
          {actor.first_year}&#8211;{actor.last_year}
        </span>
      </span>
    </div>
  );
}
