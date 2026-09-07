// GridResultsView: the reveal for a finished board.
//
// Two halves. A headline — the score out of 900 and how many of the nine
// squares were filled — and then the nine cells, each opened up to say who
// the player named and what the two ends of that cell's range were.
//
// The rule that shapes this whole component: **only two answers are revealed,
// never the list between them.** The server sends `n_possible` so the reveal
// can say "one of eleven who link them", but it deliberately never sends the
// eleven. A wall of every actor who happens to bridge a pair teaches nothing.
//
// The two it does send answer different questions, which is why both are here.
// "Most would say" is the connection worth remembering and worth the fewest
// points; "Rarest link" is the deepest cut that still works and the one that
// was worth 100. A player who took the obvious route has to be able to see
// what they left on the table, and a player who found the rare one has to see
// it confirmed.
//
// Each is drawn as the chain it stands for — row actor, a film, the connector,
// another film, column actor — because a bare name is an assertion and the two
// posters are the proof.
//
// The stagger is the Oscars results page's, for the same reason: nine cells
// arriving at once is a wall, nine arriving in sequence is a reveal. Under
// `prefers-reduced-motion` the delay collapses to zero and the CSS guard in
// src/index.css flattens the animation itself.

import type { FilmCard, GridCellResult, GridLink, GridResults } from "../../api/types";
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
          Each pairing shows both ends of its range — the link most people would reach for, and the
          most obscure actor who still connects them, which is the one worth the full 100. Two films
          prove each.
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
        {perfect && " — every one of them the rarest link there was"}
      </p>
    </header>
  );
}

/**
 * One pairing, opened up.
 *
 * Who the pairing was, who the player named, and then the two ends of the
 * range: the connection most people would reach for, and the deepest cut that
 * still worked. Both are shown because they answer different questions — one
 * is the thing worth remembering, the other is the thing that was worth 100 —
 * and a player who took the obvious route needs to see what they left behind.
 */
export function CellReveal({ cell, delayMs }: { cell: GridCellResult; delayMs: number }) {
  const answered = cell.played !== null;
  // On a cell with a single connector the two ends are the same person, so
  // the chain is drawn once rather than printed twice as if it were a miss.
  const single = cell.obvious.actor.person_id === cell.rarest.actor.person_id;
  return (
    <article
      className={[
        "flex h-full animate-rise flex-col gap-3 rounded-xl border bg-ink-2/80 p-4",
        cell.found_rarest ? "border-accent/60" : answered ? "border-line" : "border-dashed border-line",
      ].join(" ")}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm leading-tight text-bone-dim">
          {cell.row_actor} <span className="text-muted">⌇</span> {cell.column_actor}
        </h3>
        {cell.played ? (
          <span className="shrink-0 text-sm tabular-nums text-accent">
            {Math.round(cell.played.score)}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted">—</span>
        )}
      </header>

      {cell.played ? (
        <p
          className={`rounded-md border px-3 py-2 text-xs ${
            cell.found_rarest ? "border-accent/40 bg-accent/5 text-bone" : "border-line text-bone-dim"
          }`}
        >
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">You named </span>
          <span className="text-bone">{cell.played.actor.name}</span>
        </p>
      ) : (
        <p className="rounded-md border border-dashed border-line/70 px-3 py-2 text-xs text-muted">
          Left empty.
        </p>
      )}

      {single ? (
        <LinkRow
          label="The only link"
          link={cell.rarest}
          cell={cell}
          note="— nobody else connects them"
          highlight
        />
      ) : (
        <>
          <LinkRow label="Most would say" link={cell.obvious} cell={cell} note={linkContext(cell)} />
          <LinkRow
            label="Rarest link"
            link={cell.rarest}
            cell={cell}
            note="— the deepest cut that works"
            highlight={cell.found_rarest}
          />
        </>
      )}
    </article>
  );
}

/**
 * "one of eleven who link them" — the size of the pool without the pool.
 *
 * `n_possible` is the only thing the reveal knows about the other answers, and
 * saying how many there were is the useful half: it tells a player whether the
 * cell they missed was a needle or an open goal.
 */
function linkContext(cell: GridCellResult): string {
  return `— one of ${cell.n_possible} who link them`;
}

/** One route, named and then proved: the label, the actor, and two films. */
function LinkRow({
  label,
  link,
  cell,
  note,
  highlight = false,
}: {
  label: string;
  link: GridLink;
  cell: GridCellResult;
  note: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        {highlight ? (
          <Chip tone="accent">{label}</Chip>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</span>
        )}
        <span className="text-bone">{link.actor.name}</span>
        <span className="tabular-nums text-accent">{Math.round(link.score)}</span>
        <span className="text-muted">{note}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <LinkHalf film={link.films[0]} connector={link.actor.name} other={cell.row_actor} />
        <LinkHalf film={link.films[1]} connector={link.actor.name} other={cell.column_actor} />
      </div>
    </div>
  );
}

/** One half of the chain: a poster, the film, and who it puts them with. */
function LinkHalf({
  film,
  connector,
  other,
}: {
  film: FilmCard | undefined;
  connector: string;
  other: string;
}) {
  if (!film) return null;
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
