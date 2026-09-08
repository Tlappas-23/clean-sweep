// MoveBox: where a chain move is typed.
//
// The counterpart of Six Degrees' AnswerBox, and the one place the two modes
// deliberately differ. That box refuses to suggest anything, because a list
// of actors matching what you typed would be a list of the cell's answers.
// This one suggests freely, because the puzzle here is which films share a
// cast, and a list of titles matching your typing says nothing whatsoever
// about that. All the search does is stop a move being lost to a spelling,
// which against a stopwatch is worth having.
//
// The suggestions are a convenience, never a gate: what is typed is submitted
// as typed, and the server resolves it. Picking from the list and finishing
// the title yourself have to reach the same place, or the list stops being
// optional.
//
// The refusal sits directly under the input, and the input keeps what was
// typed. Being told "no one in that film was in the one you are on" and then
// having to retype the title would make the mode's own feedback feel like a
// punishment.

import { useEffect, useId, useRef, useState } from "react";
import type { FilmCard } from "../../api/types";
import { Button } from "../ui/Button";

/**
 * How long typing has to pause before the search runs.
 *
 * Long enough that a typed title is one request rather than a dozen, short
 * enough that the list feels attached to the keyboard.
 */
const SEARCH_DEBOUNCE_MS = 180;

/** Below this many characters there is nothing worth asking about. */
const MIN_QUERY = 2;

interface Props {
  /** The film currently stood on, named in the prompt so the ask is concrete. */
  here: string;
  /** The film being aimed at. */
  target: string;
  submitting: boolean;
  /** The server's reason for refusing the last move, if it did. */
  error: string | null;
  onSearch(q: string): Promise<FilmCard[]>;
  onSubmit(title: string): void;
}

export function MoveBox({ here, target, submitting, error, onSearch, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [matches, setMatches] = useState<FilmCard[]>([]);
  const inputId = useId();
  const listId = useId();

  // Only the newest search may write to state. Without this guard a slow
  // early request can land after a fast later one and repopulate the list
  // with matches for a prefix the player has already typed past.
  const queryRef = useRef(0);

  useEffect(() => {
    const typed = title.trim();
    if (typed.length < MIN_QUERY) {
      setMatches([]);
      return;
    }
    const ticket = ++queryRef.current;
    const timer = setTimeout(() => {
      void onSearch(typed).then((films) => {
        if (queryRef.current === ticket) setMatches(films);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [title, onSearch]);

  const submit = (value: string) => {
    const typed = value.trim();
    if (!typed || submitting) return;
    onSubmit(typed);
    // Cleared optimistically. A refused move leaves the message below and an
    // empty box, which is the right place to start the next guess from: the
    // title that was refused is not the one to try again.
    setTitle("");
    setMatches([]);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-ink-2/60 p-5">
      <div>
        <h2 className="text-sm text-bone">
          Name a film that shares an actor with{" "}
          <span className="text-accent">{here}</span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-bone-dim">
          Aiming for <span className="text-bone">{target}</span>. Any film with a cast member in
          common counts, so the way there is rarely the obvious one.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(title);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Film title
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type a film title"
            // The list is advisory, so the input is a combobox that still
            // accepts anything: `aria-autocomplete="list"` says suggestions
            // exist, and nothing here requires one to be chosen.
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-bone placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
          <Button type="submit" loading={submitting} disabled={!title.trim()}>
            Move
          </Button>
        </div>

        {error && (
          // `role="alert"` because this is the mode's feedback and a player
          // who is typing rather than looking still has to hear it.
          <p role="alert" className="text-xs leading-relaxed text-loss">
            {error}
          </p>
        )}
      </form>

      {matches.length > 0 && (
        // Capped and scrollable. A common prefix ("x-men", "star") matches a
        // dozen films in the real catalogue, and on a phone an uncapped list
        // pushes everything else off the screen, including the board the
        // player is reading. Roughly five rows, then it scrolls.
        <ul id={listId} className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
          {matches.map((film) => (
            <li key={film.film_id}>
              <button
                type="button"
                onClick={() => submit(film.title)}
                // min-h-11 is the 44px both platforms recommend as the
                // smallest comfortable touch target; at py-1.5 these rows
                // were 30px and easy to fat-finger into the wrong film.
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm text-bone-dim transition-colors hover:bg-white/5 hover:text-bone"
              >
                <span className="min-w-0 truncate">{film.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">{film.year}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        Spelling is forgiven, and a film you have already visited cannot be used twice.
      </p>
    </section>
  );
}
