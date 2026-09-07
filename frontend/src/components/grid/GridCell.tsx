// GridCell: one of the nine answer squares on the board.
//
// It has exactly four states, and the interesting one is the third:
//
//   empty     a "+" plate, clickable, waiting for a film;
//   open      the same plate with the gold ring, while the answer box below
//             the board is pointed at it;
//   rejected  the server's own words against the cell — "those two were never
//             in that film together" — with the cell still empty and still
//             clickable. This is the state the mode exists for: being told
//             flatly that two people never worked together is how a player
//             learns the shape of a filmography, so the message is rendered
//             *here*, on the square that was wrong, not in a toast that
//             disappears while they are still reading it;
//   filled    the poster, the title and what the answer scored.
//
// The cell is a real <button> so keyboard and screen-reader users get the
// grid for free; `aria-label` names the pairing because the row and column
// headers are two separate elements a linear reader will have left behind.

import type { GridCell as Cell } from "../../api/types";
import { FilmPoster } from "./FilmPoster";

interface Props {
  cell: Cell;
  rowActor: string;
  columnActor: string;
  /** The answer box is currently pointed at this cell. */
  open: boolean;
  /** The server's rejection for this cell, if the last attempt was refused. */
  error?: string;
  /** False once the board is finished: the cells stop taking answers. */
  interactive: boolean;
  onSelect: (row: number, column: number) => void;
}

export function GridCell({ cell, rowActor, columnActor, open, error, interactive, onSelect }: Props) {
  const filled = cell.film !== null;
  const label = filled
    ? `${rowActor} and ${columnActor}: ${cell.film!.title}, ${Math.round(cell.score ?? 0)} points`
    : `Name a film with ${rowActor} and ${columnActor}`;

  return (
    <button
      type="button"
      // A filled cell cannot be answered again (the server 409s), so it stops
      // being a control rather than offering a click that will be refused.
      disabled={filled || !interactive}
      aria-label={label}
      onClick={() => onSelect(cell.row, cell.column)}
      className={[
        "group relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden",
        "rounded-md border transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        filled
          ? "border-gold/40 bg-ink-2 disabled:opacity-100"
          : error
            ? "border-loss/60 bg-loss/5"
            : open
              ? "border-gold bg-gold/10 shadow-glow"
              : "border-line bg-ink-2/60",
        !filled && interactive ? "hover:border-gold/60 hover:bg-gold/5" : "",
        !filled && !interactive ? "opacity-60" : "",
      ].join(" ")}
    >
      {filled ? (
        <>
          {/* The poster fills the square and the caption sits over its foot,
              so nine answers read as a wall of artwork rather than a table. */}
          <FilmPoster film={cell.film!} className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/90 to-transparent px-1.5 pb-1.5 pt-5">
            <p className="line-clamp-2 text-[10px] leading-tight text-ivory sm:text-xs" title={cell.film!.title}>
              {cell.film!.title}
            </p>
            <p className="text-[9px] tabular-nums text-gold sm:text-[10px]">
              {Math.round(cell.score ?? 0)} pts
            </p>
          </div>
        </>
      ) : error ? (
        <p className="px-1.5 text-center text-[10px] leading-snug text-loss sm:text-[11px]">{error}</p>
      ) : (
        <span
          aria-hidden
          className={`text-2xl transition-colors ${open ? "text-gold" : "text-line group-hover:text-gold/60"}`}
        >
          +
        </span>
      )}
    </button>
  );
}
