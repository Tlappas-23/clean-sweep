// Tests for the grid reveal (src/components/grid/GridResultsView.tsx).
//
// One rule carries this component, and it is a rule about restraint: the
// server sends each pairing's **best** connector and nothing else, and the
// view shows that one name. A reveal that listed everyone who bridges a pair
// would be a wall of names nobody reads and would give away nine boards'
// worth of answers at once; one memorable connection per square is the thing
// worth walking away with.
//
// So the assertions here are as much about what is *absent* as what is
// present: the count of other possibilities is stated, the possibilities
// themselves never are.
//
// The other thing worth testing is the chain. A bare name is an assertion,
// and the two films are what make it checkable — so the reveal must show one
// film to each side, labelled with the actor it reaches.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ActorCard, FilmCard, GridCellResult, GridResults, GridState } from "../../api/types";
import { GridResultsView } from "./GridResultsView";

function film(title: string, year: number): FilmCard {
  return {
    film_id: `tt-${title.toLowerCase().replace(/\W+/g, "")}`,
    title,
    year,
    poster_url: null,
    genres: ["Action"],
  };
}

function actor(name: string): ActorCard {
  return {
    person_id: `nm-${name.toLowerCase().replace(/\W+/g, "")}`,
    name,
    n_films: 40,
    first_year: 1980,
    last_year: 2020,
    lead_share: 0.4,
    top_genres: ["Drama"],
    casting_type: "Working Character Actor",
  };
}

function cellOf(overrides: Partial<GridCellResult> = {}): GridCellResult {
  return {
    row: 0,
    column: 0,
    row_actor: "Sigourney Weaver",
    column_actor: "Tom Hanks",
    actor: actor("Tim Allen"),
    score: 78,
    n_possible: 5,
    best_answer: actor("Bill Paxton"),
    best_link_films: [film("Aliens", 1986), film("Apollo 13", 1995)],
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
    filled: cells.filter((c) => c.actor !== null).length,
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
      cellOf({ row: 0, column: 1, column_actor: "Emma Stone", actor: null, score: null }),
    ];
    render(<GridResultsView results={resultsOf(cells, { filled: 1, total: 9, score: 178 })} />);

    expect(screen.getByText("178")).toBeInTheDocument();
    expect(screen.getByText("/ 900")).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
  });

  it("shows who the player named beside the pair's best connector", () => {
    render(<GridResultsView results={resultsOf([cellOf()])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("You named")).toBeInTheDocument();
    expect(within(cell).getByText("Tim Allen")).toBeInTheDocument();
    expect(within(cell).getByText("Best link")).toBeInTheDocument();
    expect(within(cell).getByText("Bill Paxton")).toBeInTheDocument();
    // What it scored, and both halves of the pairing in the cell's heading.
    // (The names recur in the chain below it, so this asks the heading.)
    expect(within(cell).getByText("78")).toBeInTheDocument();
    expect(within(cell).getByRole("heading")).toHaveTextContent("Sigourney Weaver");
    expect(within(cell).getByRole("heading")).toHaveTextContent("Tom Hanks");
  });

  it("proves the connection with one film to each side", () => {
    render(<GridResultsView results={resultsOf([cellOf()])} />);

    const cell = screen.getByRole("article");
    // Each half states the whole claim for a screen reader, because three
    // names split over two lines is a poor linear read.
    expect(
      within(cell).getByLabelText("Bill Paxton and Sigourney Weaver were both in Aliens, 1986"),
    ).toBeInTheDocument();
    expect(
      within(cell).getByLabelText("Bill Paxton and Tom Hanks were both in Apollo 13, 1995"),
    ).toBeInTheDocument();
  });

  it("names the size of the pool but never the pool itself", () => {
    render(<GridResultsView results={resultsOf([cellOf({ n_possible: 5 })])} />);

    const cell = screen.getByRole("article");
    // How many there were is useful — it says whether a miss was a needle or
    // an open goal.
    expect(within(cell).getByText(/one of 5 who link them/)).toBeInTheDocument();

    // Exactly two people are named in the whole cell: the answer given and the
    // best one. Anything more would be the list this view refuses to print.
    expect(within(cell).getAllByText(/^(Tim Allen|Bill Paxton)$/)).toHaveLength(2);
  });

  it("says so when only one actor links a pair", () => {
    render(<GridResultsView results={resultsOf([cellOf({ n_possible: 1 })])} />);

    expect(screen.getByText(/the only actor who links them/)).toBeInTheDocument();
  });

  it("highlights a cell where the player found the best connector, without printing it twice", () => {
    const found = cellOf({ actor: actor("Bill Paxton"), score: 100, found_best: true });
    render(<GridResultsView results={resultsOf([found])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("Best link")).toBeInTheDocument();
    // The name is stated once as what they gave and once as the confirmed
    // best; the films below it are what the second mention is carrying.
    expect(within(cell).getAllByText("Bill Paxton")).toHaveLength(2);
    expect(within(cell).getByText("100")).toBeInTheDocument();
  });

  it("marks an unanswered square as empty and still reveals its best connector", () => {
    render(<GridResultsView results={resultsOf([cellOf({ actor: null, score: null })])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("Left empty.")).toBeInTheDocument();
    expect(within(cell).queryByText("You named")).toBeNull();
    // A missed square is exactly where the reveal earns its keep — the name
    // and the two films that prove it.
    expect(within(cell).getByText("Best link")).toBeInTheDocument();
    expect(within(cell).getByText("Bill Paxton")).toBeInTheDocument();
    expect(within(cell).getByText("Aliens")).toBeInTheDocument();
    expect(within(cell).getByText("Apollo 13")).toBeInTheDocument();
  });

  it("celebrates a perfect board", () => {
    const perfect = cellOf({ actor: actor("Bill Paxton"), score: 100, found_best: true });
    render(<GridResultsView results={resultsOf([perfect])} />);

    expect(screen.getByText("A perfect board")).toBeInTheDocument();
    // The silvered gradient is the payoff, and it belongs to the headline score
    // rather than to the cell that happens to carry the same number.
    expect(screen.getByText("/ 900").parentElement?.className).toContain("text-silvered");
  });
});
