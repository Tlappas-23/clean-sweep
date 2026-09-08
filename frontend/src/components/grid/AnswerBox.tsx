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
//
// The one thing the box does offer is the cell's two hints, one per side.
// Each names a film the *best-known* connector shares with that header actor,
// which is the obvious route through and never the rare one the scoring
// rewards. Both controls quote their price before they are clicked, because
// a deduction a player did not agree to is a deduction they will read as a
// bug.

import { useEffect, useRef, useState } from "react";
import type { GridHint } from "../../api/types";
import { FilmPoster } from "./FilmPoster";

interface Props {
  rowActor: string;
  columnActor: string;
  /** The hints already bought on this cell, in the order taken. */
  hints: GridHint[];
  /** What those hints will cost the cell when it is answered. */
  hintPenalty: number;
  /** True while the typed name is being posted, so the form stops resubmitting. */
  submitting: boolean;
  /** True while a hint is being bought, so a double click buys one thing. */
  hinting: boolean;
  onSubmit: (name: string) => void;
  onHint: (side: "row" | "column") => void;
  onClose: () => void;
}

/** The server rejects anything shorter; no point in a round trip to hear it. */
export const MIN_NAME_LENGTH = 2;

/**
 * What a cell is docked per number of hints taken, mirroring `HINT_COSTS` in
 * the engine (backend/app/engine/grid.py).
 *
 * The client has to hold a copy because it quotes the price *before* the
 * purchase, and the server only reports a penalty once it has been incurred.
 * It is a price list, never an authority: what a cell actually loses is
 * whatever `hint_penalty` comes back saying.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the price list belongs with the control that quotes it
export const HINT_COSTS: readonly number[] = [0, 15, 35];

export function AnswerBox({
  rowActor,
  columnActor,
  hints,
  hintPenalty,
  submitting,
  hinting,
  onSubmit,
  onHint,
  onClose,
}: Props) {
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

  const rowHint = hints.find((h) => h.side === "row");
  const columnHint = hints.find((h) => h.side === "column");

  // The price of the *next* hint, quoted two ways. The table is a total per
  // number taken rather than a price per hint, so the second one costs 20 and
  // brings the cell's bill to 35. Saying only one of those numbers would be
  // half the truth whichever one it was.
  const nextTotal = HINT_COSTS[Math.min(hints.length + 1, HINT_COSTS.length - 1)];
  const extra = nextTotal - hintPenalty;
  const price =
    hintPenalty === 0
      ? `Costs ${extra} points off this cell`
      : `Costs ${extra} more, ${nextTotal} off this cell in all`;

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

      {/* The two hints, one per side of the cell. They sit below the form
          rather than beside it: the box asks for a name first, and offers to
          help only once the player has looked at the question. */}
      <section aria-label="Hints" className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.25em] text-accent">Hints</p>
          <p className="text-[11px] tabular-nums text-muted">{hints.length} of 2 taken</p>
        </div>
        <p className="text-xs text-muted">
          A hint names one film the best known link shares with that actor. Never the rare one.
          The cost comes off this cell when you answer it.
        </p>
        <HintControl
          actor={rowActor}
          hint={rowHint}
          price={price}
          busy={hinting}
          onTake={() => onHint("row")}
        />
        <HintControl
          actor={columnActor}
          hint={columnHint}
          price={price}
          busy={hinting}
          onTake={() => onHint("column")}
        />
      </section>
    </form>
  );
}

/**
 * One side's hint: the offer, or the film it revealed.
 *
 * The two states are deliberately different elements. Before it is bought
 * this is a control with a price on it; afterwards it is evidence, and
 * leaving it as a button would invite a second click for something already
 * paid for.
 */
function HintControl({
  actor,
  hint,
  price,
  busy,
  onTake,
}: {
  actor: string;
  hint: GridHint | undefined;
  price: string;
  busy: boolean;
  onTake: () => void;
}) {
  if (hint) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
        <FilmPoster film={hint.film} className="aspect-[2/3] w-8" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-accent">A film with {actor}</p>
          <p className="truncate text-sm text-bone">{hint.film.title}</p>
          <p className="text-[11px] tabular-nums text-muted">{hint.film.year}</p>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onTake}
      disabled={busy}
      // The label carries the actor because the price beneath it is the same
      // sentence on both controls, and "take a hint" twice over says nothing
      // about which side is being opened.
      aria-label={`Take a hint: a film with ${actor}`}
      className="flex flex-col items-start gap-0.5 rounded-md border border-line bg-ink px-3 py-2 text-left transition-colors hover:border-accent/60 hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
    >
      <span className="text-sm text-bone">A film with {actor}</span>
      <span className="text-[11px] text-muted">{price}</span>
    </button>
  );
}
