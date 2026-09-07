// AnswerSearch: the box that opens when a player clicks an empty cell.
//
// It searches the *whole* catalog, not the cell's valid answers, because the
// backend does (docs/API.md, "Co-star Grid"): being able to name a wrong film
// and be told why it is wrong is the exchange the mode is built on. So this
// component's job is only to find films quickly and hand one to the store —
// it makes no judgement about whether an answer is any good, and it renders
// no rejection. The refusal belongs to the cell (src/components/grid/GridCell.tsx).
//
// The debounce lives in src/state/GridContext.tsx, next to the request it
// throttles; this stays a controlled text box with no timers in it.

import { useEffect, useRef } from "react";
import type { FilmCard } from "../../api/types";
import { MIN_SEARCH_LENGTH } from "../../state/GridContext";
import { Spinner } from "../ui/Spinner";
import { FilmPoster } from "./FilmPoster";

interface Props {
  rowActor: string;
  columnActor: string;
  query: string;
  results: FilmCard[];
  searching: boolean;
  /** True while the chosen film is being posted, so the list stops taking clicks. */
  submitting: boolean;
  onQuery: (q: string) => void;
  onPick: (filmId: string) => void;
  onClose: () => void;
}

export function AnswerSearch({
  rowActor,
  columnActor,
  query,
  results,
  searching,
  submitting,
  onQuery,
  onPick,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening a cell should put the cursor in the box: on a three-minute clock,
  // a click that then needs a second click is a click too many.
  useEffect(() => {
    inputRef.current?.focus();
  }, [rowActor, columnActor]);

  const short = query.trim().length < MIN_SEARCH_LENGTH;

  return (
    <section
      aria-label={`Name a film with ${rowActor} and ${columnActor}`}
      className="flex flex-col gap-3 rounded-xl border border-gold/40 bg-ink-2/80 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-gold">Name a film</p>
          <h2 className="mt-1 text-lg leading-tight text-ivory">
            {rowActor} <span className="text-muted">×</span> {columnActor}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the answer box"
          className="rounded-md px-2 py-1 text-ivory-dim transition-colors hover:text-ivory"
        >
          ×
        </button>
      </header>

      <label className="relative block">
        <span className="sr-only">Search films by title</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search a film title…"
          className="w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-ivory placeholder:text-muted focus:border-gold focus:outline-none"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size={14} />
          </span>
        )}
      </label>

      {short ? (
        <p className="text-xs text-muted">
          Type at least {MIN_SEARCH_LENGTH} characters. Any film in the catalog can be named —
          whether the two of them were actually in it is the server&rsquo;s call.
        </p>
      ) : results.length === 0 && !searching ? (
        <p className="text-xs text-muted">No film in the catalog matches that.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {results.map((film) => (
            <li key={film.film_id}>
              <button
                type="button"
                disabled={submitting}
                // The visible label is split over three lines for layout, so
                // the name is stated once, plainly, for anyone not reading it
                // as a picture.
                aria-label={`${film.title} (${film.year})`}
                onClick={() => onPick(film.film_id)}
                className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-gold/40 hover:bg-gold/5 focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
              >
                <FilmPoster film={film} className="aspect-[2/3] w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ivory">{film.title}</span>
                  <span className="block truncate text-xs text-muted">
                    <span className="tabular-nums">{film.year}</span>
                    {film.genres.length > 0 && ` · ${film.genres.slice(0, 2).join(", ")}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
