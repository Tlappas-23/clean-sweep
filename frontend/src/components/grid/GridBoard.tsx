// GridBoard: the 4x4 lattice. An empty corner, three column actors across
// the top, three row actors down the left, and the nine answer cells.
//
// It is one CSS grid rather than a table of nested rows, so every square
// stays aligned no matter how long an actor's name runs. The first track is
// wider than the rest because a name reading down the side needs the room,
// while a name across the top can wrap over the square below it.
//
// The component is deliberately dumb: it takes a `GridState` and callbacks
// and renders. Everything about what a click means lives in
// src/state/GridContext.tsx.

import { Fragment } from "react";
import type { GridState } from "../../api/types";
import { cellKey, type CellRef } from "../../state/GridContext";
import { ActorHeader } from "./ActorHeader";
import { GridCell } from "./GridCell";

interface Props {
  game: GridState;
  /** The cell the answer box is pointed at, if any. */
  activeCell: CellRef | null;
  /** Server rejections keyed "row,column". */
  cellErrors: Record<string, string>;
  onSelectCell: (row: number, column: number) => void;
}

export function GridBoard({ game, activeCell, cellErrors, onSelectCell }: Props) {
  const interactive = game.status === "playing";
  // The wire sends nine cells row-major; index rather than search so a cell
  // is always drawn in its own square even if the order ever surprises us.
  const cellAt = (row: number, column: number) =>
    game.cells.find((c) => c.row === row && c.column === column) ?? {
      row,
      column,
      link: null,
    };

  return (
    <div
      role="group"
      aria-label="Six Degrees grid"
      className="grid gap-1.5 sm:gap-2"
      style={{
        // One header track plus three equal answer columns. The header track
        // is allowed to shrink on a phone but never past a readable name.
        gridTemplateColumns: "minmax(4.5rem, 1fr) repeat(3, minmax(0, 1.6fr))",
      }}
    >
      {/* The empty corner. It carries the instruction rather than nothing at
          all: nine cells, one connecting actor each. */}
      <div className="flex items-end justify-center pb-1 text-center text-[9px] uppercase leading-tight tracking-[0.2em] text-muted sm:text-[10px]">
        Name who
        <br />
        connects them
      </div>

      {game.columns.map((actor) => (
        <ActorHeader key={actor.person_id} actor={actor} orientation="column" />
      ))}

      {game.rows.map((rowActor, row) => (
        // A keyed Fragment keeps the flat grid flat: a wrapper element per
        // row would break the alignment the whole layout depends on.
        <Fragment key={rowActor.person_id}>
          <ActorHeader actor={rowActor} orientation="row" />
          {game.columns.map((columnActor, column) => (
            <GridCell
              key={columnActor.person_id}
              cell={cellAt(row, column)}
              rowActor={rowActor.name}
              columnActor={columnActor.name}
              open={activeCell?.row === row && activeCell?.column === column}
              error={cellErrors[cellKey(row, column)]}
              interactive={interactive}
              onSelect={onSelectCell}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
