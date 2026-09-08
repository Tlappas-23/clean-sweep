// FilmPoster: a film's artwork at a fixed 2:3 ratio, with a titled fallback.
//
// Used by every part of Six Degrees that shows a film, and by The Chain,
// where a film is the whole unit of play. It stays in components/grid rather
// than moving to components/ui because it is a *film* card's frame, not a
// piece of the design language, and both callers mean the same thing by it.
// It exists for the same reason the
// Oscars mode's ContenderCard has a `Poster` block: `poster_url` is nullable
// on the wire and images fail to load in the wild, so "no artwork" has to be
// a designed state rather than a broken-image icon.
//
// The box keeps its aspect ratio whether or not an image ever arrives, so the
// board never reflows as posters stream in.

import { useState } from "react";
import type { FilmCard } from "../../api/types";

interface Props {
  film: FilmCard;
  /**
   * Tailwind sizing for the frame, including its shape. The default is the
   * 2:3 poster ratio; a board cell overrides it to fill a square instead,
   * which is why the ratio is a caller's decision rather than baked in.
   */
  className?: string;
}

export function FilmPoster({ film, className = "aspect-[2/3] w-full" }: Props) {
  const [failed, setFailed] = useState(false);
  const usable = film.poster_url !== null && !failed;

  return (
    <div className={`relative shrink-0 overflow-hidden rounded-sm bg-ink-3 ${className}`}>
      {usable ? (
        <img
          src={film.poster_url as string}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        // The fallback still carries identity: a plate with the year, so a
        // posterless film is recognisable rather than blank.
        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center">
          <span aria-hidden className="text-accent/50">
            ✦
          </span>
          <span className="text-[9px] tabular-nums text-muted">{film.year}</span>
        </div>
      )}
    </div>
  );
}
