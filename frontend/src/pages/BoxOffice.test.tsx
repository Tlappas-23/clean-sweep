// Tests for the box office search on the Analytics page.
//
// Three things are worth pinning. That the section leads with the model's
// weakness rather than its headline, because a reader looking at one forecast
// needs to know which end of the calibration range they are on. That searching
// narrows the list. And that a checkout without the artifact gets an
// explanation rather than a broken page.
//
// The other analytics endpoints are stubbed to 404 so this file exercises one
// section rather than the whole page: each section degrades independently, and
// that independence is worth relying on here.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { api, ApiError } from "../api";
import type { BoxOfficeReport } from "../api/types";
import { AnalyticsPage } from "./Analytics";

/** Real rows from the artifact, including both failure modes. */
const FILMS: BoxOfficeReport["films"] = [
  { imdb_id: "tt2488496", title: "Star Wars: The Force Awakens", year: 2015,
    projected: 741_000_000, actual: 2_068_200_000, ratio: 0.358, within_2x: false, upcoming: false, budget_known: true },
  { imdb_id: "tt1745564", title: "The Lego Batman Movie", year: 2017,
    projected: 232_000_000, actual: 312_000_000, ratio: 0.744, within_2x: true, upcoming: false, budget_known: true },
  { imdb_id: "tt0000001", title: "A Small Film Nobody Saw", year: 2016,
    projected: 17_400_000, actual: 1_700_000, ratio: 10.24, within_2x: false, upcoming: false, budget_known: true },
  { imdb_id: "tt9999999", title: "An Unreleased Sequel", year: 2026,
    projected: 340_000_000, actual: null, ratio: null, within_2x: false,
    upcoming: true, budget_known: false },
];

function report(films: BoxOfficeReport["films"]): BoxOfficeReport {
  return {
    generated_from: "rolling-origin folds; each film scored by a model trained "
      + "only on films released before its own year",
    summary: { films: 1495, within_2x: 0.573, median_ratio: 0.991,
      upcoming: 118, upcoming_with_budget: 17, within_2x_without_budget: 0.5084 },
    films,
  };
}

beforeEach(() => {
  for (const method of ["getClusters", "getRanker", "getValidation", "getRolling"] as const) {
    vi.spyOn(api, method).mockRejectedValue(new ApiError(404, "not generated"));
  }
  vi.spyOn(api, "getBoxOffice").mockImplementation(async (query = "") => {
    const needle = query.trim().toLowerCase();
    return report(needle ? FILMS.filter((f) => f.title.toLowerCase().includes(needle)) : FILMS);
  });
});

afterEach(() => vi.restoreAllMocks());

function renderPage() {
  render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

const searchBox = () => screen.getByRole("searchbox", { name: /search a film/i });

describe("box office search", () => {
  it("warns about the calibration before showing any forecast", async () => {
    renderPage();
    const warning = await screen.findByText(/read the small films with suspicion/i);
    // The specific failure, not a vague hedge about uncertainty.
    expect(warning.closest("p")).toHaveTextContent(/cannot tell you a film will flop/i);
  });

  it("prints the forecast beside what the film actually made", async () => {
    renderPage();
    const row = (await screen.findByText(/Star Wars: The Force Awakens/)).closest("li");
    expect(within(row as HTMLElement).getByText(/\$741M/)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(/\$2\.07B/)).toBeInTheDocument();
  });

  it("flags a forecast that missed by an order of magnitude", async () => {
    renderPage();
    const row = (await screen.findByText(/A Small Film Nobody Saw/)).closest("li");
    // The failure the warning describes must be visible on the row itself,
    // not only in the prose above it.
    expect(within(row as HTMLElement).getByText(/10\.2x over/i)).toBeInTheDocument();
  });

  it("narrows the list as the query is typed", async () => {
    renderPage();
    await screen.findByText(/Star Wars: The Force Awakens/);
    fireEvent.change(searchBox(), { target: { value: "batman" } });

    expect(await screen.findByText(/The Lego Batman Movie/)).toBeInTheDocument();
    expect(screen.queryByText(/Star Wars: The Force Awakens/)).toBeNull();
  });

  it("says so when nothing matches, and why", async () => {
    renderPage();
    await screen.findByText(/Star Wars: The Force Awakens/);
    fireEvent.change(searchBox(), { target: { value: "zzznotafilm" } });

    expect(await screen.findByText(/no film matching/i)).toBeInTheDocument();
  });

  it("marks an unreleased film as a forecast, with no actual to check it", async () => {
    renderPage();
    const row = (await screen.findByText(/An Unreleased Sequel/)).closest("li");
    const cell = row as HTMLElement;
    expect(within(cell).getByText(/not out yet/i)).toBeInTheDocument();
    // A dash rather than a zero: the film has not made anything yet, which is
    // not the same as having made nothing.
    expect(within(cell).getByText("—")).toBeInTheDocument();
  });

  it("says a forecast has no budget yet, because that is what weakens it", async () => {
    renderPage();
    const row = (await screen.findByText(/An Unreleased Sequel/)).closest("li");
    expect(within(row as HTMLElement).getByText(/no budget yet/i)).toBeInTheDocument();
  });

  it("quotes the weaker accuracy that a no-budget forecast is worth", async () => {
    renderPage();
    const note = await screen.findByText(/unreleased films carry a real forecast/i);
    // The number is measured by withholding budget from the backtest, not
    // guessed, so the page states it rather than hedging.
    expect(note.closest("p")).toHaveTextContent(/57% to\s+51%/);
  });

  it("explains itself when the artifact was never generated", async () => {
    vi.spyOn(api, "getBoxOffice").mockRejectedValue(
      new ApiError(404, "Box office projections have not been generated yet."));
    renderPage();
    expect(await screen.findByText(/no box office projections yet/i)).toBeInTheDocument();
  });
});
