// GridCell: one of the nine answer squares on the board.
//
// It has exactly four states, and the interesting one is the third:
//
//   empty     a "+" plate, clickable, waiting for a name;
//   open      the same plate with the accent ring, while the answer box below
//             the board is pointed at it;
//   rejected  the server's own words against the cell, "that actor does not
//             connect those two", with the cell still empty and still
//             clickable. This is the state the mode exists for: being told
//             flatly that someone does not bridge two filmographies is how a
//             player learns the shape of the graph, so the message is
//             rendered *here*, on the square that was wrong, not in a toast
//             that disappears while they are still reading it;
//   filled    the connector's name, the two films that prove them, and what
//             it scored.
//
// The films are the point of the filled state. A name on its own is an
// assertion. "Samuel L. Jackson connects Stanley Tucci and Mark Strong" is
// only worth anything if you can see it was The First Avenger on one side and
// Kingsman on the other. So a correct answer opens into its own evidence, on
// the board, while the rest of the round is still in front of the player.
// Nothing is given away by it: this is a cell they have already solved.
//
// The cell is a real <button> so keyboard and screen-reader users get the
// grid for free; `aria-label` names the pairing because the row and column
// headers are two separate elements a linear reader will have left behind.

import type { FilmCard, GridCell as Cell } from "../../api/types";
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
  const link = cell.link;
  const filled = link !== null;
  // The whole chain in one sentence, because three names and two titles split
  // over five elements is a poor read linearly.
  const label = link
    ? `${rowActor} and ${columnActor}: connected by ${link.actor.name}, ` +
      `${link.films[0]?.title} with ${rowActor} and ${link.films[1]?.title} with ${columnActor}, ` +
      `${Math.round(link.score)} points`
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
      {link ? (
        <div aria-hidden className="flex w-full flex-col items-center gap-1.5">
          <span className="line-clamp-2 text-xs font-medium leading-tight text-bone sm:text-sm">
            {link.actor.name}
          </span>
          {/* The evidence: one poster per side of the link, in the order the
              chain reads. Each is captioned with the actor it reaches rather
              than with its own title, because "with Mark Strong" is the part
              that makes the film mean something here. */}
          <div className="flex w-full items-stretch justify-center gap-1">
            <LinkHalf film={link.films[0]} other={rowActor} />
            <LinkHalf film={link.films[1]} other={columnActor} />
          </div>
          <span className="text-[10px] tabular-nums text-accent">
            {Math.round(link.score)} pts
          </span>
        </div>
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

/**
 * One half of a solved cell's evidence: the poster, the title, and who it
 * puts the connector with.
 *
 * The title is deliberately kept even at this size. A poster alone is
 * recognisable to someone who already knows the film, which is exactly the
 * player who did not need the evidence.
 */
function LinkHalf({ film, other }: { film: FilmCard | undefined; other: string }) {
  if (!film) return null;
  return (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
      <FilmPoster film={film} className="aspect-[2/3] w-7 shrink-0 sm:w-8" />
      <span
        className="line-clamp-2 text-center text-[8px] leading-tight text-bone-dim sm:text-[9px]"
        title={`${film.title} (${film.year}), with ${other}`}
      >
        {film.title}
      </span>
    </span>
  );
}
