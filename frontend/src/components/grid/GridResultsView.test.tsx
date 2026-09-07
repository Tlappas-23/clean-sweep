// Tests for the grid reveal (src/components/grid/GridResultsView.tsx).
//
// One rule carries this component, and it is a rule about restraint: the
// server sends each pairing's **best** answer and nothing else, and the view
// shows that one film. A reveal that listed every film a pair share would be
// a wall of titles nobody reads and would give away nine boards' worth of
// answers at once; one memorable collaboration per square is the thing worth
// walking away with.
//
// So the assertions here are as much about what is *absent* as what is
// present: the count of other possibilities is stated, the possibilities
// themselves never are.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { FilmCard, GridCellResult, GridResults, GridState } from "../../api/types";
import { GridResultsView } from "./GridResultsView";

function film(title: string, year: number): FilmCard {
  return { film_id: `tt-${title.toLowerCase().replace(/\W+/g, "")}`, title, year, poster_url: null, genres: ["Action"] };
}

function cellOf(overrides: Partial<GridCellResult> = {}): GridCellResult {
  return {
    row: 0,
    column: 0,
    row_actor: "Robert Downey Jr.",
    column_actor: "Samuel L. Jackson",
    film: film("Iron Man 2", 2010),
    score: 78,
    n_possible: 5,
    best_answer: film("Iron Man", 2008),
    found_best: false,
    ...overrides,
  };
}

/** A finished board; `game` is only carried through, so it stays minimal. */
function resultsOf(cells: GridCellResult[], overrides: Partial<GridResults> = {}): GridResults {
  const game: GridState = {
    id: "grid-1",
    seed: null,
    status: "complete",
    rows: [],
    columns: [],
    cells: [],
    seconds_remaining: 0,
    round_seconds: 180,
    created_at: "2026-09-07T00:00:00Z",
  };
  return {
    game,
    filled: cells.filter((c) => c.film !== null).length,
    total: cells.length,
    score: cells.reduce((sum, c) => sum + (c.score ?? 0), 0),
    perfect: cells.every((c) => c.found_best),
    cells,
    ...overrides,
  };
}

describe("GridResultsView", () => {
  it("headlines the score out of 900 and how much of the board was filled", () => {
    const cells = [
      cellOf(),
      cellOf({ row: 0, column: 1, column_actor: "Mark Ruffalo", film: null, score: null }),
    ];
    render(<GridResultsView results={resultsOf(cells, { filled: 1, total: 9, score: 178 })} />);

    expect(screen.getByText("178")).toBeInTheDocument();
    expect(screen.getByText("/ 900")).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
  });

  it("shows what the player named beside the pair's best answer", () => {
    render(<GridResultsView results={resultsOf([cellOf()])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("You named")).toBeInTheDocument();
    expect(within(cell).getByText("Iron Man 2")).toBeInTheDocument();
    expect(within(cell).getByText("Best answer")).toBeInTheDocument();
    expect(within(cell).getByText("Iron Man")).toBeInTheDocument();
    // What it scored, and both halves of the pairing.
    expect(within(cell).getByText("78")).toBeInTheDocument();
    expect(within(cell).getByText(/Robert Downey Jr\./)).toBeInTheDocument();
  });

  it("names the size of the pool but never the pool itself", () => {
    render(<GridResultsView results={resultsOf([cellOf({ n_possible: 5 })])} />);

    const cell = screen.getByRole("article");
    // How many there were is useful — it says whether a miss was a needle or
    // an open goal.
    expect(within(cell).getByText(/one of 5 films they share/)).toBeInTheDocument();

    // Exactly two films are named in the whole cell: the answer given and the
    // best one. Anything more would be the list this view refuses to print.
    expect(within(cell).getAllByText(/^Iron Man( 2)?$/)).toHaveLength(2);
    expect(within(cell).queryByRole("list")).toBeNull();
  });

  it("says so when a pair only ever made one film together", () => {
    render(<GridResultsView results={resultsOf([cellOf({ n_possible: 1 })])} />);

    expect(screen.getByText(/their only film together/)).toBeInTheDocument();
  });

  it("highlights a cell where the player found the best answer, without printing it twice", () => {
    const found = cellOf({ film: film("Iron Man", 2008), score: 100, found_best: true });
    render(<GridResultsView results={resultsOf([found])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("Best answer")).toBeInTheDocument();
    expect(within(cell).getByText(/best-known film together/)).toBeInTheDocument();
    // The film is stated once, as the answer they gave — not repeated below it
    // as a reveal of something they already had.
    expect(within(cell).getAllByText("Iron Man")).toHaveLength(1);
    expect(within(cell).getByText("100")).toBeInTheDocument();
  });

  it("marks an unanswered square as empty and still reveals its best answer", () => {
    render(<GridResultsView results={resultsOf([cellOf({ film: null, score: null })])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("Left empty.")).toBeInTheDocument();
    expect(within(cell).queryByText("You named")).toBeNull();
    // A missed square is exactly where the reveal earns its keep.
    expect(within(cell).getByText("Best answer")).toBeInTheDocument();
    expect(within(cell).getByText("Iron Man")).toBeInTheDocument();
  });

  it("celebrates a perfect board", () => {
    const perfect = cellOf({ film: film("Iron Man", 2008), score: 100, found_best: true });
    render(<GridResultsView results={resultsOf([perfect])} />);

    expect(screen.getByText("A perfect board")).toBeInTheDocument();
    // The gilded gradient is the payoff, and it belongs to the headline score
    // rather than to the cell that happens to carry the same number.
    expect(screen.getByText("/ 900").parentElement?.className).toContain("text-gilded");
  });
});
