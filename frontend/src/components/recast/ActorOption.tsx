// ActorOption: one actor on a shortlist, as a selectable card — and
// `ActorLine`, the same actor reported rather than chosen.
//
// Sits under src/components/recast/, rendered by ShortlistPanel while a role
// is being cast and read again, in its quieter `ActorLine` form, by the
// reveal.
//
// What a card shows and why it shows it: the whole mode is a judgement about
// whether somebody could plausibly have played a part, and the four things
// the score actually looks at are stature, role size, era and genre
// (docs/GAME_DESIGN.md §8). So the card carries the player-readable version
// of each of them — how many films they have made, the share of those that
// were leads, the years they worked, and what they work in — with the casting
// type on top to say which cluster the shortlist was drawn from. Nothing here
// is decoration: every line is an input to the number the round will give.
//
// It is a real <button> with `aria-pressed`, like the Oscars mode's
// ContenderCard, so selection is a state a screen reader can hear rather than
// an accent border it cannot see.

import type { ActorCard } from "../../api/types";
import { Chip } from "../ui/Chip";

/**
 * "leads 73% of the time" — `lead_share` in words.
 *
 * The wire sends a 0-1 share, which is precise and unreadable. Saying it as a
 * sentence is what makes it comparable at a glance against the part being
 * cast: a lead role wants somebody near the top of this scale, a supporting
 * part somebody nearer the bottom.
 */
function leadShareLabel(share: number): string {
  return `leads ${Math.round(share * 100)}% of the time`;
}

/** "1973–2023", with an en dash, from the two career-boundary fields. Local
 *  to this file: both readers of it are here. */
function careerSpan(actor: ActorCard): string {
  return `${actor.first_year}–${actor.last_year}`;
}

interface Props {
  actor: ActorCard;
  selected: boolean;
  /** False while a cast is in flight, so the shortlist stops taking clicks. */
  interactive: boolean;
  onSelect: (personId: string) => void;
}

export function ActorOption({ actor, selected, interactive, onSelect }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!interactive}
      onClick={() => onSelect(actor.person_id)}
      className={[
        "flex h-full w-full flex-col gap-2 rounded-xl border bg-ink-2/70 p-4 text-left",
        "transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "border-accent shadow-glow" : "border-line hover:border-accent/60 hover:bg-accent/5",
        interactive ? "" : "opacity-60",
      ].join(" ")}
    >
      <span className="font-display text-lg leading-tight text-bone">{actor.name}</span>

      {actor.casting_type && (
        <span className="text-[10px] uppercase tracking-[0.18em] text-accent/80">
          {actor.casting_type}
        </span>
      )}

      <span className="text-xs text-bone-dim">
        <span className="tabular-nums">{actor.n_films}</span> films ·{" "}
        <span className="tabular-nums">{careerSpan(actor)}</span>
      </span>

      <span className="text-xs text-muted">{leadShareLabel(actor.lead_share)}</span>

      {actor.top_genres.length > 0 && (
        <span className="mt-auto flex flex-wrap gap-1 pt-1">
          {actor.top_genres.slice(0, 3).map((genre) => (
            <Chip key={genre}>{genre}</Chip>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * The same actor, flattened to two lines and no interaction.
 *
 * Used wherever an actor is being *reported* rather than chosen — the cast
 * list, the reveal's "you cast" and "best available" rows. It deliberately
 * shows fewer numbers than the card: at that point the decision is made and
 * the fit bars carry the argument.
 */
export function ActorLine({
  actor,
  label,
  tone = "neutral",
}: {
  actor: ActorCard;
  /** What this actor is doing here: "Originally", "You cast", "Best available". */
  label: string;
  tone?: "accent" | "neutral";
}) {
  return (
    <div className="min-w-0">
      <p
        className={`text-[10px] uppercase tracking-[0.2em] ${tone === "accent" ? "text-accent" : "text-muted"}`}
      >
        {label}
      </p>
      <p className="truncate font-display text-base leading-tight text-bone" title={actor.name}>
        {actor.name}
      </p>
      <p className="truncate text-xs text-muted">
        {actor.casting_type ? `${actor.casting_type} · ` : ""}
        {leadShareLabel(actor.lead_share)}
      </p>
    </div>
  );
}
