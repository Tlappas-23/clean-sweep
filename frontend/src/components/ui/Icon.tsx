// Icon: the small inline-SVG set used to lead the How to Play steps and to
// mark the three modes on the landing page.
//
// Lives in src/components/ui because it is part of the design language, not
// of any one screen. Deliberately hand-rolled rather than pulled from an icon
// package: the app ships four runtime dependencies and none of them is for
// decoration.
//
// Every glyph is drawn on the same 24x24 grid with a 1.5 stroke and no fill,
// and inherits `currentColor`, so an icon picks up whatever text colour it
// sits in: the accent beside a step, bone-dim inside a card. They are purely
// decorative (`aria-hidden`): each one sits next to the sentence it
// illustrates, so announcing them would only repeat the line.

import type { ReactNode } from "react";

export type IconName =
  | "deal"
  | "draft"
  | "reroll"
  | "skip"
  | "trophy"
  | "crown"
  | "film"
  | "cast"
  | "score"
  | "grid"
  | "clock"
  | "reveal";

const PATHS: Record<IconName, ReactNode> = {
  // Three cards dealt face up, for the Oscars round's three years. Kept a
  // clear gap apart: at 18px, touching outlines merge into one shape.
  deal: (
    <>
      <rect x="2.5" y="7.5" width="5.5" height="10" rx="1.2" />
      <rect x="9.25" y="5.5" width="5.5" height="14" rx="1.2" />
      <rect x="16" y="7.5" width="5.5" height="10" rx="1.2" />
    </>
  ),
  // A choice made: tick in a circle.
  draft: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.4 2.7 2.7L16.4 9.4" />
    </>
  ),
  // Throw it back: a loop that does not quite close.
  reroll: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.2v4h-4" />
    </>
  ),
  // Skip forward past this one.
  skip: (
    <>
      <path d="M5 5.6 14.5 12 5 18.4Z" />
      <path d="M19 5v14" />
    </>
  ),
  // The prize at the end of the season.
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 5.2H4.4v.9A3.4 3.4 0 0 0 7.8 9.5" />
      <path d="M17 5.2h2.6v.9a3.4 3.4 0 0 1-3.4 3.4" />
      <path d="M12 14v3.6" />
      <path d="M8.2 20h7.6" />
    </>
  ),
  // The genre crown: the two slots the Academy never created.
  crown: (
    <>
      <path d="M4 8.6 7.7 12 12 5.6 16.3 12 20 8.6l-1.4 9.8H5.4Z" />
    </>
  ),
  // A strip of film.
  film: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2.5 9h4.5M2.5 15h4.5M17 9h4.5M17 15h4.5" />
    </>
  ),
  // Two people: the casting shortlist, and the grid's pair of actors.
  cast: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.4 19.5a5.6 5.6 0 0 1 11.2 0" />
      <path d="M16.2 5.5a3.2 3.2 0 0 1 0 6" />
      <path d="M20.6 19.5a5.6 5.6 0 0 0-2.9-4.9" />
    </>
  ),
  // How a pick is measured.
  score: (
    <>
      <path d="M5 20V11.5M12 20V4M19 20v-6" />
    </>
  ),
  // The three-by-three board.
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  // Against the clock.
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 6.8V12l3.4 2.1" />
    </>
  ),
  // What was hidden, shown.
  reveal: (
    <>
      <path d="M2.6 12S6.4 5.7 12 5.7 21.4 12 21.4 12 17.6 18.3 12 18.3 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

interface Props {
  name: IconName;
  /** Edge length in pixels; the viewBox scales to it. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className = "" }: Props) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
