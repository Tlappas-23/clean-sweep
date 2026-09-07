// GridResultsView: the reveal for a finished board.
//
// Two halves. A headline — the score out of 900 and how many of the nine
// squares were filled — and then the nine cells, each opened up to say who
// the player named, what it scored, and the best connector available.
//
// The rule that shapes this whole component: **only the best answer is
// revealed, never the full list.** The server sends `n_possible` so the
// reveal can say "one of eleven actors who link them", but it deliberately
// never sends the eleven, and this view never asks for them. A wall of every
// possible answer teaches nothing; one memorable connection per pairing is
// the thing worth walking away with.
//
// The chain is the point of the reveal. A bare name is an assertion, so the
// best connector is drawn as what it actually is — row actor, a film, the
// connector, another film, column actor — with both posters on screen. That
// is the piece a player remembers, and it is the only place in the mode where
// the artwork earns its space: a cell in play cannot show a poster without
// giving its own answer away.
//
// The stagger is the Oscars results page's, for the same reason: nine cells
// arriving at once is a wall, nine arriving in sequence is a reveal. Under
// `prefers-reduced-motion` the delay collapses to zero and the CSS guard in
// src/index.css flattens the animation itself.

import type { ActorCard, FilmCard, GridCellResult, GridResults } from "../../api/types";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { Chip } from "../ui/Chip";
import { FilmPoster } from "./FilmPoster";

/** Gap between consecutive cell reveals. Nine cells land inside a second. */
const STAGGER_MS = 90;

/** A perfect board: nine cells, one hundred points each. */
export const MAX_GRID_SCORE = 900;

export function GridResultsView({ results }: { results: GridResults }) {
  const reduced = useReducedMotion();

  return (
    <div className="flex flex-col gap-8">
      <ScoreHeader results={results} />

      <div className="rule-accent" aria-hidden />

      <section aria-labelledby="grid-reveal" className="flex flex-col gap-4">
        <h2 id="grid-reveal" className="text-2xl">
          Cell by cell
        </h2>
        <p className="-mt-2 max-w-2xl text-sm text-bone-dim">
          Each pairing shows the best-known actor who links them, and the two films that prove it.
          There are usually other routes through; this is the one worth remembering.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.cells.map((cell, i) => (
            <li key={`${cell.row},${cell.column}`}>
              <CellReveal cell={cell} delayMs={reduced ? 0 : i * STAGGER_MS} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The headline: score out of 900, and how much of the board was filled. */
function ScoreHeader({ results }: { results: GridResults }) {
  const { score, filled, total, perfect } = results;
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <p className="text-[11px] uppercase tracking-[0.35em] text-accent">
        {perfect ? "A perfect board" : "Board complete"}
      </p>
      <p className={`font-display text-6xl leading-none sm:text-7xl ${perfect ? "text-silvered" : "text-bone"}`}>
        <span className="tabular-nums">{Math.round(score)}</span>
        <span className="text-3xl text-muted"> / {MAX_GRID_SCORE}</span>
      </p>
      <p className="text-sm text-bone-dim">
        <span className="tabular-nums text-bone">
          {filled} of {total}
        </span>{" "}
        squares filled
        {perfect && " — every one of them the best-known link"}
      </p>
    </header>
  );
}

/**
 * One pairing, opened up.
 *
 * Who the pairing was, who the player named (or that the square was left
 * empty), and then the chain: the best connector with a film to each side.
 */
export function CellReveal({ cell, delayMs }: { cell: GridCellResult; delayMs: number }) {
  const answered = cell.actor !== null;
  return (
    <article
      className={[
        "flex h-full animate-rise flex-col gap-3 rounded-xl border bg-ink-2/80 p-4",
        cell.found_best ? "border-accent/60" : answered ? "border-line" : "border-dashed border-line",
      ].join(" ")}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm leading-tight text-bone-dim">
          {cell.row_actor} <span className="text-muted">⌇</span> {cell.column_actor}
        </h3>
        {answered ? (
          <span className="shrink-0 text-sm tabular-nums text-accent">{Math.round(cell.score ?? 0)}</span>
        ) : (
          <span className="shrink-0 text-xs text-muted">—</span>
        )}
      </header>

      {answered ? (
        <p
          className={`rounded-md border px-3 py-2 text-xs ${
            cell.found_best ? "border-accent/40 bg-accent/5 text-bone" : "border-line text-bone-dim"
          }`}
        >
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">You named </span>
          <span className="text-bone">{cell.actor!.name}</span>
        </p>
      ) : (
        <p className="rounded-md border border-dashed border-line/70 px-3 py-2 text-xs text-muted">
          Left empty.
        </p>
      )}

      {/* The chain proper. When the player already found the name, it is not
          printed twice as a correction — it is confirmed, and the films are
          still shown, because those are the part worth taking away. */}
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2 text-xs">
          {cell.found_best ? (
            <Chip tone="accent">Best link</Chip>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.2em] text-accent">Best link</span>
          )}
          <span className="text-bone">{cell.best_answer.name}</span>
          <span className="text-muted">{linkContext(cell)}</span>
        </p>
        <LinkChain cell={cell} connector={cell.best_answer} />
      </div>
    </article>
  );
}

/**
 * "one of eleven actors who link them" — the size of the pool without the pool.
 *
 * `n_possible` is the only thing the reveal knows about the other answers, and
 * saying how many there were is the useful half: it tells a player whether the
 * cell they missed was a needle or an open goal.
 */
function linkContext(cell: GridCellResult): string {
  if (cell.n_possible <= 1) return "— the only actor who links them";
  return `— one of ${cell.n_possible} who link them`;
}

/**
 * The two films that prove a connection, in the order the chain is read.
 *
 * `best_link_films` is always exactly two — the film shared with the row
 * actor, then the film shared with the column actor — so the halves are
 * labelled with the actor each one reaches rather than with "first" and
 * "second", which would tell the reader nothing.
 */
function LinkChain({ cell, connector }: { cell: GridCellResult; connector: ActorCard }) {
  const [withRow, withColumn] = cell.best_link_films;
  if (!withRow || !withColumn) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <LinkHalf film={withRow} connector={connector.name} other={cell.row_actor} />
      <LinkHalf film={withColumn} connector={connector.name} other={cell.column_actor} />
    </div>
  );
}

/** One half of the chain: a poster, the film, and who it puts them with. */
function LinkHalf({
  film,
  connector,
  other,
}: {
  film: FilmCard;
  connector: string;
  other: string;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-line/70 bg-ink/40 p-2"
      // Two names and a title split over three lines is a poor read linearly,
      // so the whole claim is stated once as a sentence for a screen reader.
      aria-label={`${connector} and ${other} were both in ${film.title}, ${film.year}`}
    >
      <FilmPoster film={film} className="aspect-[2/3] w-8 shrink-0" />
      <div className="min-w-0" aria-hidden>
        <p className="truncate text-[11px] leading-tight text-bone" title={film.title}>
          {film.title}
        </p>
        <p className="truncate text-[10px] text-muted">
          <span className="tabular-nums">{film.year}</span> · with {other}
        </p>
      </div>
    </div>
  );
}
