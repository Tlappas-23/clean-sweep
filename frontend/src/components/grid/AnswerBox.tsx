// AnswerBox: the box that opens when a player clicks an empty cell.
//
// **There is deliberately no autocomplete here.** A dropdown of matching
// actors would hand over the answer: the names worth suggesting for a cell
// are exactly that cell's connectors, so a list of them is the answer key
// with extra steps. The player types the whole name from memory, which is
// the thing the mode is actually asking them to do.
//
// That only works if the game is forgiving about *how* the name is typed, so
// the server absorbs the difference (backend/app/data/people.py,
// `resolve_actor`): case, accents, punctuation, a dropped middle initial and
// an outright misspelling all resolve to the right person. "samuel jackson"
// and "leonardo dicapro" both land. What it will not do is guess between two
// people: "jackson" alone comes back asking for a full name. Silently
// picking the more famous one would score a cell nobody answered.
//
// So this component is a plain form: type a name, submit it, and the answer
// comes back as either a filled cell or the server's own words against the
// square. The refusal belongs to the cell (src/components/grid/GridCell.tsx),
// not here.

import { useEffect, useRef, useState } from "react";

interface Props {
  rowActor: string;
  columnActor: string;
  /** True while the typed name is being posted, so the form stops resubmitting. */
  submitting: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** The server rejects anything shorter; no point in a round trip to hear it. */
export const MIN_NAME_LENGTH = 2;

export function AnswerBox({ rowActor, columnActor, submitting, onSubmit, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  // Opening a cell should put the cursor in the box: on a three-minute clock,
  // a click that then needs a second click is a click too many. Re-running on
  // the cell rather than on mount also clears the previous cell's text, so a
  // rejected name is not still sitting there when the next square opens.
  useEffect(() => {
    setName("");
    inputRef.current?.focus();
  }, [rowActor, columnActor]);

  const tooShort = name.trim().length < MIN_NAME_LENGTH;

  return (
    <form
      aria-label={`Name an actor who connects ${rowActor} and ${columnActor}`}
      className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-ink-2/80 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort && !submitting) onSubmit(name.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-accent">Name the link</p>
          {/* The two names sit either side of the gap rather than being joined
              by a "×": the question is who goes *between* them, and the
              layout should ask it. */}
          <h2 className="mt-1 text-lg leading-tight text-bone">
            {rowActor}
            <span className="mx-2 text-muted">⌇ ? ⌇</span>
            {columnActor}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the answer box"
          className="rounded-md px-2 py-1 text-bone-dim transition-colors hover:text-bone"
        >
          ×
        </button>
      </header>

      <label className="block">
        <span className="sr-only">Type the actor&rsquo;s name</span>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type a name…"
          // The browser's own suggestions are as much of a giveaway as ours
          // would be, and on a name field it will happily offer the player
          // whatever they typed into the last square.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          className="w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-bone placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Spelling is forgiven. Enter to submit.</p>
        <button
          type="submit"
          disabled={tooShort || submitting}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm text-bone transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          {submitting ? "Checking…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
