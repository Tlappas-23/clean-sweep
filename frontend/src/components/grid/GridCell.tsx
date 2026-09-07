// GridCell: one of the nine answer squares on the board.
//
// It has exactly four states, and the interesting one is the third:
//
//   empty     a "+" plate, clickable, waiting for a name;
//   open      the same plate with the accent ring, while the answer box below
//             the board is pointed at it;
//   rejected  the server's own words against the cell — "that actor does not
//             connect those two" — with the cell still empty and still
//             clickable. This is the state the mode exists for: being told
//             flatly that someone does not bridge two filmographies is how a
//             player learns the shape of the graph, so the message is
//             rendered *here*, on the square that was wrong, not in a toast
//             that disappears while they are still reading it;
//   filled    the connector's name, their casting type, and what it scored.
//
// A filled cell is type rather than artwork, which is the honest thing to
// show: the answer is a person, and the wire carries no headshot for them.
// The posters come back in the reveal, where they belong — a connection is
// proved by the two films, and that is a story a cell in play has no room to
// tell without giving the answer away.
//
// The cell is a real <button> so keyboard and screen-reader users get the
// grid for free; `aria-label` names the pairing because the row and column
// headers are two separate elements a linear reader will have left behind.

import type { GridCell as Cell } from "../../api/types";

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
  const filled = cell.actor !== null;
  const label = filled
    ? `${rowActor} and ${columnActor}: connected by ${cell.actor!.name}, ${Math.round(cell.score ?? 0)} points`
    : `Name an actor who connects ${rowActor} and ${columnActor}`;

  return (
    <button
      type="button"
      // A filled cell cannot be answered again (the server 409s), so it stops
      // being a control rather than offering a click that will be refused.
      disabled={filled || !interactive}
      aria-label={label}
      onClick={() => onSelect(cell.row, cell.column)}
      className={[
        "group relative flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden",
        "rounded-md border p-2 text-center transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        filled
          ? "border-accent/40 bg-accent/5 disabled:opacity-100"
          : error
            ? "border-loss/60 bg-loss/5"
            : open
              ? "border-accent bg-accent/10 shadow-glow"
              : "border-line bg-ink-2/60",
        !filled && interactive ? "hover:border-accent/60 hover:bg-accent/5" : "",
        !filled && !interactive ? "opacity-60" : "",
      ].join(" ")}
    >
      {filled ? (
        <>
          {/* The link glyph reads as "these two, joined by" without needing a
              word for it, and survives the square getting small. */}
          <span aria-hidden className="text-sm text-accent/70">
            ⌇
          </span>
          <span className="line-clamp-3 text-xs font-medium leading-tight text-bone sm:text-sm">
            {cell.actor!.name}
          </span>
          {cell.actor!.casting_type && (
            <span className="line-clamp-1 hidden text-[10px] text-muted sm:block">
              {cell.actor!.casting_type}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-accent">
            {Math.round(cell.score ?? 0)} pts
          </span>
        </>
      ) : error ? (
        <p className="px-1 text-center text-[10px] leading-snug text-loss sm:text-[11px]">{error}</p>
      ) : (
        <span
          aria-hidden
          className={`text-2xl transition-colors ${open ? "text-accent" : "text-line group-hover:text-accent/60"}`}
        >
          +
        </span>
      )}
    </button>
  );
}
