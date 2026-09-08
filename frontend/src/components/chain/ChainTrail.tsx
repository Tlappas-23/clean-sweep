// ChainTrail: the route so far, from the start film to wherever you are now,
// with the target waiting at the end.
//
// This is the board. Six Degrees has nine squares to look at; a chain has a
// line, and the line has to answer three questions at a glance: where did I
// start, where am I standing, and how far is it to the film I am aiming at.
//
// Two decisions worth naming:
//
//   The target is always on screen, from the first frame, at the end of the
//   line. A player who has to scroll or remember what they are aiming at is
//   playing a memory game instead of this one.
//
//   Each hop is labelled with the actor who made it, between the two films
//   they were in. That label is not decoration: it is the proof of the move,
//   and it is what turns a finished chain into something a player can read
//   back and check rather than a list of titles they have to take on trust.

import type { ChainStep, FilmCard } from "../../api/types";
import { FilmPoster } from "../grid/FilmPoster";

interface Props {
  start: FilmCard;
  target: FilmCard;
  /** The moves made so far, in order. Empty on a chain nobody has played yet. */
  route: ChainStep[];
  /** True once the target has been reached, so the last card reads as arrived. */
  solved?: boolean;
  /**
   * A route the player did not walk, shown after the reveal. It is rendered
   * in the accent rather than as live play, so the two are never confused
   * when they sit one above the other.
   */
  variant?: "played" | "revealed";
}

export function ChainTrail({ start, target, route, solved = false, variant = "played" }: Props) {
  const revealed = variant === "revealed";
  // The target only doubles as the last step when the route actually reached
  // it. Otherwise it is a separate, dimmed card at the end of the line.
  const arrived = solved || route[route.length - 1]?.film.film_id === target.film_id;

  return (
    <ol
      // Horizontal scroll is contained here rather than left to the page: a
      // long route must never make the whole document scroll sideways.
      className="flex items-stretch gap-1 overflow-x-auto pb-2"
      aria-label={revealed ? "A shortest route" : "Your route so far"}
    >
      <li className="shrink-0">
        <TrailFilm film={start} label="Start" tone="start" />
      </li>

      {route.map((step, index) => (
        <li key={`${step.film.film_id}-${index}`} className="flex shrink-0 items-stretch gap-1">
          <Hop actor={step.actor.name} accent={revealed} />
          <TrailFilm
            film={step.film}
            label={`Step ${index + 1}`}
            tone={
              step.film.film_id === target.film_id ? "target" : revealed ? "revealed" : "played"
            }
          />
        </li>
      ))}

      {!arrived && (
        <li className="flex shrink-0 items-stretch gap-1">
          {/* An unwalked gap, drawn as a dashed rule rather than a named hop:
              nothing is known about it yet, and drawing it solid would claim
              the target is one step away when it may be three. */}
          <span
            aria-hidden
            className="flex w-10 items-center justify-center self-center text-muted"
          >
            <span className="h-px w-full border-t border-dashed border-line" />
          </span>
          <TrailFilm film={target} label="Target" tone="target" pending />
        </li>
      )}
    </ol>
  );
}

type Tone = "start" | "played" | "revealed" | "target";

const TONES: Record<Tone, string> = {
  start: "border-line bg-ink-2/70",
  played: "border-line bg-ink-2/70",
  revealed: "border-accent/40 bg-accent/5",
  target: "border-win/50 bg-win/5",
};

const LABEL_TONES: Record<Tone, string> = {
  start: "text-muted",
  played: "text-muted",
  revealed: "text-accent",
  target: "text-win",
};

interface FilmProps {
  film: FilmCard;
  label: string;
  tone: Tone;
  /** A target not yet reached: dimmed, so the line reads as unfinished. */
  pending?: boolean;
}

function TrailFilm({ film, label, tone, pending = false }: FilmProps) {
  return (
    <figure
      className={`flex h-full w-28 flex-col gap-2 rounded-lg border p-2 sm:w-32 ${TONES[tone]} ${
        pending ? "opacity-70" : ""
      }`}
    >
      <FilmPoster film={film} className="aspect-[2/3] w-full" />
      <figcaption className="flex flex-col gap-0.5">
        <span className={`text-[9px] uppercase tracking-[0.2em] ${LABEL_TONES[tone]}`}>{label}</span>
        {/* The title wraps rather than truncating. A clipped title is a film
            the player cannot identify, which defeats the whole card. */}
        <span className="text-xs leading-snug text-bone">{film.title}</span>
        <span className="text-[10px] tabular-nums text-muted">{film.year}</span>
      </figcaption>
    </figure>
  );
}

/** One hop, labelled with the actor who made it. */
function Hop({ actor, accent }: { actor: string; accent: boolean }) {
  return (
    <span className="flex w-20 flex-col items-center justify-center gap-1 self-center px-1 text-center sm:w-24">
      <span
        aria-hidden
        className={`h-px w-full ${accent ? "bg-accent/40" : "bg-line"}`}
      />
      <span className={`text-[10px] leading-tight ${accent ? "text-accent" : "text-bone-dim"}`}>
        {actor}
      </span>
      <span aria-hidden className={`h-px w-full ${accent ? "bg-accent/40" : "bg-line"}`} />
    </span>
  );
}
