// GridResultsView: the reveal for a finished board.
//
// Two halves. A headline — the score out of 900 and how many of the nine
// squares were filled — and then the nine cells, each opened up to say what
// the player named, what it scored, and the one film that pair is best known
// for.
//
// The rule that shapes this whole component: **only the best answer is
// revealed, never the full list.** The server sends `n_possible` so the
// reveal can say "one of eleven films they share", but it deliberately never
// sends the eleven, and this view never asks for them. A wall of every
// possible answer teaches nothing; one memorable collaboration per pairing is
// the thing worth walking away with.
//
// The stagger is the Oscars results page's, for the same reason: nine cells
// arriving at once is a wall, nine arriving in sequence is a reveal. Under
// `prefers-reduced-motion` the delay collapses to zero and the CSS guard in
// src/index.css flattens the animation itself.

import type { GridCellResult, GridResults } from "../../api/types";
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

      <div className="rule-gold" aria-hidden />

      <section aria-labelledby="grid-reveal" className="flex flex-col gap-4">
        <h2 id="grid-reveal" className="text-2xl">
          Cell by cell
        </h2>
        <p className="-mt-2 max-w-2xl text-sm text-ivory-dim">
          Each pairing shows the one film they are best known for together. There are usually
          others; this is the one worth remembering.
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
      <p className="text-[11px] uppercase tracking-[0.35em] text-gold">
        {perfect ? "A perfect board" : "Board complete"}
      </p>
      <p className={`font-display text-6xl leading-none sm:text-7xl ${perfect ? "text-gilded" : "text-ivory"}`}>
        <span className="tabular-nums">{Math.round(score)}</span>
        <span className="text-3xl text-muted"> / {MAX_GRID_SCORE}</span>
      </p>
      <p className="text-sm text-ivory-dim">
        <span className="tabular-nums text-ivory">
          {filled} of {total}
        </span>{" "}
        squares filled
        {perfect && " — every one of them the pair's best-known film"}
      </p>
    </header>
  );
}

/**
 * One pairing, opened up.
 *
 * Three lines: who the pairing was, what the player named (or that the square
 * was left empty), and the pair's best-known film — flagged when the player
 * found it, offered as the answer when they did not.
 */
export function CellReveal({ cell, delayMs }: { cell: GridCellResult; delayMs: number }) {
  const answered = cell.film !== null;
  return (
    <article
      className={[
        "flex h-full animate-rise flex-col gap-3 rounded-xl border bg-ink-2/80 p-4",
        cell.found_best ? "border-gold/60" : answered ? "border-line" : "border-dashed border-line",
      ].join(" ")}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm leading-tight text-ivory-dim">
          {cell.row_actor} <span className="text-muted">×</span> {cell.column_actor}
        </h3>
        {answered ? (
          <span className="shrink-0 text-sm tabular-nums text-gold">{Math.round(cell.score ?? 0)}</span>
        ) : (
          <span className="shrink-0 text-xs text-muted">—</span>
        )}
      </header>

      {answered ? (
        <FilmLine
          label="You named"
          film={cell.film!}
          tone={cell.found_best ? "gold" : "neutral"}
        />
      ) : (
        <p className="rounded-md border border-dashed border-line/70 px-3 py-2 text-xs text-muted">
          Left empty.
        </p>
      )}

      {/* The reveal proper. When the player already found it, the same film is
          not printed twice — it is simply confirmed as the best there was. */}
      {cell.found_best ? (
        <p className="flex items-center gap-2 text-xs text-gold">
          <Chip tone="gold">Best answer</Chip>
          <span className="text-ivory-dim">
            Their best-known film together{pairContext(cell)}.
          </span>
        </p>
      ) : (
        <FilmLine label="Best answer" film={cell.best_answer} tone="gold" note={pairContext(cell)} />
      )}
    </article>
  );
}

/**
 * "one of eleven films they share" — the size of the pool without the pool.
 *
 * `n_possible` is the only thing the reveal knows about the other answers,
 * and saying how many there were is the useful half: it tells a player
 * whether the cell they missed was a needle or an open goal.
 */
function pairContext(cell: GridCellResult): string {
  if (cell.n_possible <= 1) return " — their only film together";
  return ` — one of ${cell.n_possible} films they share`;
}

/** A film on one line: small poster, title, year, and what it is doing here. */
function FilmLine({
  label,
  film,
  tone,
  note,
}: {
  label: string;
  film: GridCellResult["best_answer"];
  tone: "gold" | "neutral";
  note?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <FilmPoster film={film} className="aspect-[2/3] w-10 shrink-0" />
      <div className="min-w-0">
        <p className={`text-[10px] uppercase tracking-[0.2em] ${tone === "gold" ? "text-gold" : "text-muted"}`}>
          {label}
        </p>
        <p className="truncate text-sm text-ivory" title={film.title}>
          {film.title}
        </p>
        <p className="truncate text-xs text-muted">
          <span className="tabular-nums">{film.year}</span>
          {note}
        </p>
      </div>
    </div>
  );
}
