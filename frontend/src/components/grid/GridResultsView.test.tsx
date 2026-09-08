// Tests for the grid reveal (src/components/grid/GridResultsView.tsx).
//
// One rule carries this component, and it is a rule about restraint: the
// server sends two of each pairing's connectors and nothing else. A reveal
// that listed everyone who bridges a pair would be a wall of names nobody
// reads; two is what the mode needs, and the assertions here are as much
// about what is *absent* as what is present.
//
// The two answer different questions, and the tests hold them apart. "Most
// would say" is the obvious route, worth the floor. "Rarest link" is the deep
// cut, worth 100. A player who took the easy one has to see what they left
// behind, so both must be on screen at once.
//
// The other thing worth testing is the chain. A bare name is an assertion, and
// the two films are what make it checkable, so each route must show one film
// to each side, labelled with the actor it reaches.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  ActorCard,
  FilmCard,
  GridCellResult,
  GridLink,
  GridResults,
  GridState,
} from "../../api/types";
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

function link(name: string, left: string, right: string, score: number): GridLink {
  return {
    actor: actor(name),
    films: [film(left, 1986), film(right, 1995)],
    score,
  };
}

function cellOf(overrides: Partial<GridCellResult> = {}): GridCellResult {
  return {
    row: 0,
    column: 0,
    row_actor: "Sigourney Weaver",
    column_actor: "Tom Hanks",
    played: link("Tim Allen", "Galaxy Quest", "Toy Story", 78),
    n_possible: 5,
    obvious: link("Bill Paxton", "Aliens", "Apollo 13", 60),
    rarest: link("Joan Cusack", "Working Girl", "Toy Story 2", 100),
    found_rarest: false,
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
    filled: cells.filter((c) => c.played !== null).length,
    total: cells.length,
    score: cells.reduce((sum, c) => sum + (c.played?.score ?? 0), 0),
    perfect: cells.every((c) => c.found_rarest),
    ended: "handed_in",
    cells,
    ...overrides,
  };
}

describe("GridResultsView", () => {
  it("headlines the score out of 900 and how much of the board was filled", () => {
    const cells = [
      cellOf(),
      cellOf({ row: 0, column: 1, column_actor: "Emma Stone", played: null }),
    ];
    render(<GridResultsView results={resultsOf(cells, { filled: 1, total: 9, score: 178 })} />);

    expect(screen.getByText("178")).toBeInTheDocument();
    expect(screen.getByText("/ 900")).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
  });

  it("shows who the player named beside both ends of the range", () => {
    render(<GridResultsView results={resultsOf([cellOf()])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("You named")).toBeInTheDocument();
    expect(within(cell).getByText("Tim Allen")).toBeInTheDocument();

    // The obvious route and the rare one, each named and each scored.
    expect(within(cell).getByText("Most would say")).toBeInTheDocument();
    expect(within(cell).getByText("Bill Paxton")).toBeInTheDocument();
    expect(within(cell).getByText("60")).toBeInTheDocument();
    expect(within(cell).getByText("Rarest link")).toBeInTheDocument();
    expect(within(cell).getByText("Joan Cusack")).toBeInTheDocument();
    expect(within(cell).getByText("100")).toBeInTheDocument();

    // What it scored, and both halves of the pairing in the cell's heading.
    expect(within(cell).getByText("78")).toBeInTheDocument();
    expect(within(cell).getByRole("heading")).toHaveTextContent("Sigourney Weaver");
    expect(within(cell).getByRole("heading")).toHaveTextContent("Tom Hanks");
  });

  it("proves each route with one film to each side", () => {
    render(<GridResultsView results={resultsOf([cellOf()])} />);

    const cell = screen.getByRole("article");
    // Each half states the whole claim for a screen reader, because three
    // names split over two lines is a poor linear read.
    for (const claim of [
      "Bill Paxton and Sigourney Weaver were both in Aliens, 1986",
      "Bill Paxton and Tom Hanks were both in Apollo 13, 1995",
      "Joan Cusack and Sigourney Weaver were both in Working Girl, 1986",
      "Joan Cusack and Tom Hanks were both in Toy Story 2, 1995",
    ]) {
      expect(within(cell).getByLabelText(claim)).toBeInTheDocument();
    }
  });

  it("names the size of the pool but never the pool itself", () => {
    render(<GridResultsView results={resultsOf([cellOf({ n_possible: 5 })])} />);

    const cell = screen.getByRole("article");
    // How many there were is useful: it says whether a miss was a needle or
    // an open goal.
    expect(within(cell).getByText(/one of 5 who link them/)).toBeInTheDocument();

    // Exactly three people are named in the whole cell: what was played, the
    // obvious route and the rare one. Anything more would be the list this
    // view refuses to print.
    expect(
      within(cell).getAllByText(/^(Tim Allen|Bill Paxton|Joan Cusack)$/),
    ).toHaveLength(3);
  });

  it("draws one chain, not two, when a single actor is the only link", () => {
    const only = link("Bill Paxton", "Aliens", "Apollo 13", 100);
    render(
      <GridResultsView
        results={resultsOf([cellOf({ n_possible: 1, obvious: only, rarest: only })])}
      />,
    );

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("The only link")).toBeInTheDocument();
    expect(within(cell).getByText(/nobody else connects them/)).toBeInTheDocument();
    // Named once, not printed twice as if the two ends were different people.
    expect(within(cell).getAllByText("Bill Paxton")).toHaveLength(1);
    expect(within(cell).queryByText("Most would say")).toBeNull();
  });

  it("highlights a cell where the player found the rarest link", () => {
    const found = cellOf({
      played: link("Joan Cusack", "Working Girl", "Toy Story 2", 100),
      found_rarest: true,
    });
    render(<GridResultsView results={resultsOf([found])} />);

    const cell = screen.getByRole("article");
    // The rare route is confirmed rather than offered as a correction, and
    // the obvious one still shows so the gap is visible.
    expect(within(cell).getByText("Rarest link")).toBeInTheDocument();
    expect(within(cell).getByText("Most would say")).toBeInTheDocument();
    expect(within(cell).getAllByText("Joan Cusack")).toHaveLength(2);
  });

  it("marks an unanswered square as empty and still reveals both routes", () => {
    render(<GridResultsView results={resultsOf([cellOf({ played: null })])} />);

    const cell = screen.getByRole("article");
    expect(within(cell).getByText("Left empty.")).toBeInTheDocument();
    expect(within(cell).queryByText("You named")).toBeNull();
    // A missed square is exactly where the reveal earns its keep.
    expect(within(cell).getByText("Bill Paxton")).toBeInTheDocument();
    expect(within(cell).getByText("Joan Cusack")).toBeInTheDocument();
    expect(within(cell).getByText("Aliens")).toBeInTheDocument();
    expect(within(cell).getByText("Working Girl")).toBeInTheDocument();
  });

  it("celebrates a perfect board", () => {
    const perfect = cellOf({
      played: link("Joan Cusack", "Working Girl", "Toy Story 2", 100),
      found_rarest: true,
    });
    render(<GridResultsView results={resultsOf([perfect])} />);

    expect(screen.getByText("A perfect board")).toBeInTheDocument();
    // The silvered gradient is the payoff, and it belongs to the headline score
    // rather than to the cell that happens to carry the same number.
    expect(screen.getByText("/ 900").parentElement?.className).toContain("text-silvered");
  });
});
