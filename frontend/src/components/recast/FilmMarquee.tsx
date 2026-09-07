// FilmMarquee: the film being recast, at the head of the page.
//
// Sits under src/components/recast/. It has one job and it is worth stating,
// because the mode falls apart without it: every judgement the player is
// about to make is a judgement *about this film*. Genre is a fifth of the fit
// score and era is another fifteen per cent, so the poster, the title and the
// year are not chrome — they are the premises of the argument, and they stay
// on screen for the whole round.
//
// The poster comes from src/components/grid/FilmPoster.tsx rather than a
// second copy of it here. Both side modes are served the same `FilmCard`
// (backend/app/models/people.py), so they should not grow two different ideas
// of what a film with no artwork looks like.

import type { FilmCard } from "../../api/types";
import { FilmPoster } from "../grid/FilmPoster";
import { Chip } from "../ui/Chip";

interface Props {
  film: FilmCard;
  /** The daily seed, when this round is a shared one. */
  seed: string | null;
}

export function FilmMarquee({ film, seed }: Props) {
  return (
    <header className="flex items-start gap-4 sm:gap-6">
      <FilmPoster film={film} className="aspect-[2/3] w-20 shrink-0 sm:w-28" />

      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold">
          Recast
          {seed && <span className="ml-2 text-muted">daily · {seed}</span>}
        </p>

        {/* The film is the page's subject, so its title is the <h1>. The
            instruction ("recast this") is a line underneath it, not above. */}
        <h1 className="mt-1 text-2xl leading-tight sm:text-4xl">{film.title}</h1>

        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ivory-dim">
          <span className="tabular-nums">{film.year}</span>
          {film.genres.slice(0, 3).map((genre) => (
            <Chip key={genre}>{genre}</Chip>
          ))}
        </p>

        <p className="mt-2 max-w-xl text-sm text-ivory-dim">
          Replace every principal role, one part at a time. Each choice is scored on whether that
          name could carry a part this size, whether they play parts this size, and whether they
          belong to this film&rsquo;s genre and era.
        </p>
      </div>
    </header>
  );
}
