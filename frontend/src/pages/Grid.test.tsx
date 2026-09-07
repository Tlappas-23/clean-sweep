// Flow tests for the Co-star Grid screen (src/pages/Grid.tsx) against the
// in-memory mock adapter.
//
// The mock enforces the same rules as the backend engine, message for message
// (src/api/mock.ts, "Co-star Grid"), so these are contract tests of the whole
// answering loop without a network: click a square, search, name a film, and
// see what the server made of it.
//
// The three rejections are the point of the mode, so each gets its own test.
// A player who names a pair that never worked together, or re-uses a film they
// have already spent, has to be told which of those two things happened — and
// told it against the square they clicked, not in a toast that has faded by
// the time they look up.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { createMockApi } from "../api/mock";
import type { Api } from "../api/client";
import { GridProvider } from "../state/GridContext";
import { GridScreen } from "./Grid";

/**
 * The fixture board (src/api/mock.ts):
 *
 *                     Jackson    Ruffalo    Paltrow
 *   Downey Jr.        Iron Man   Avengers   Iron Man
 *   Johansson         Winter S.  Avengers   Iron Man 2
 *   Evans             Winter S.  Avengers   Endgame
 *
 * Only the pairings matter here; the cell a test clicks is named by its two
 * actors, exactly as the accessible label does.
 */
const DOWNEY = "Robert Downey Jr.";
const JACKSON = "Samuel L. Jackson";
const PALTROW = "Gwyneth Paltrow";

/** Render the screen on /grid/:id, wired to a fresh instantaneous mock. */
async function setup(): Promise<{ api: Api }> {
  const api = createMockApi({ latencyMs: 0 });
  const game = await api.createGridGame();
  render(
    <MemoryRouter initialEntries={[`/grid/${game.id}`]}>
      <Routes>
        <Route
          path="/grid/:gameId?"
          element={
            <GridProvider api={api}>
              <GridScreen />
            </GridProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Name a film they were both in" });
  return { api };
}

/** The empty square where `row` meets `column`, found by its label. */
function emptyCell(rowActor: string, columnActor: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Name a film with ${rowActor} and ${columnActor}`,
  });
}

/** Open a square's answer box and type a title into it. */
async function search(rowActor: string, columnActor: string, title: string) {
  fireEvent.click(emptyCell(rowActor, columnActor));
  const box = await screen.findByRole("searchbox", { name: "Search films by title" });
  fireEvent.change(box, { target: { value: title } });
}

/** Click a film in the result list, waiting for the debounced search first. */
async function chooseFilm(label: string) {
  const option = await screen.findByRole("button", { name: label });
  fireEvent.click(option);
}

/** The one legal answer this suite reaches for, by its accessible label. */
const IRON_MAN = "Iron Man (2008)";

describe("GridScreen", () => {
  it("draws the board: three actors each way and nine empty squares", async () => {
    await setup();

    expect(screen.getByText(DOWNEY)).toBeInTheDocument();
    expect(screen.getByText(JACKSON)).toBeInTheDocument();
    // Nine cells, all offering to be named.
    expect(screen.getAllByRole("button", { name: /^Name a film with / })).toHaveLength(9);
    // The clock is the server's, rendered as M:SS. The exact figure is the
    // server's business — a three-minute round that has already been running
    // for a few milliseconds reads 2:59, and that is correct.
    expect(screen.getByRole("timer").textContent).toMatch(/^[0-3]:[0-5]\d$/);
  });

  it("fills a square and scores it when the pair really were in the film", async () => {
    await setup();

    await search(DOWNEY, JACKSON, "iron man");
    await chooseFilm(IRON_MAN);

    // Iron Man tops that pair's list, so it takes the full 100 — and the cell
    // now says so in its own label rather than only in its pixels.
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `${DOWNEY} and ${JACKSON}: Iron Man, 100 points`,
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
    expect(screen.getByText("100 points")).toBeInTheDocument();
    // A filled square stops taking answers; the server would 409 anyway.
    expect(
      screen.getByRole("button", { name: `${DOWNEY} and ${JACKSON}: Iron Man, 100 points` }),
    ).toBeDisabled();
  });

  it("shows the server's own words against a pair that never shared the film", async () => {
    await setup();

    // Jackson is in Pulp Fiction; Downey is not. The catalog lets it be named
    // on purpose — being told why it is wrong is the feedback the mode gives.
    await search(DOWNEY, JACKSON, "pulp");
    await chooseFilm("Pulp Fiction (1994)");

    const cell = await waitFor(() => {
      const found = emptyCell(DOWNEY, JACKSON);
      expect(
        within(found).getByText("those two were never in that film together"),
      ).toBeInTheDocument();
      return found;
    });

    // The square is still empty and still answerable: the rejection is an
    // invitation to try again, not the end of the cell.
    expect(cell).toBeEnabled();
    expect(screen.getByText("0 of 9")).toBeInTheDocument();

    // And it really is answerable — the right film still goes in.
    await search(DOWNEY, JACKSON, "iron man");
    await chooseFilm(IRON_MAN);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `${DOWNEY} and ${JACKSON}: Iron Man, 100 points` }),
      ).toBeInTheDocument(),
    );
  });

  it("refuses a film that has already been used on this board", async () => {
    await setup();

    // Iron Man is a legal answer for both of Downey's cells with Jackson and
    // with Paltrow — but a board only gets one of each film.
    await search(DOWNEY, JACKSON, "iron man");
    await chooseFilm(IRON_MAN);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `${DOWNEY} and ${JACKSON}: Iron Man, 100 points` }),
      ).toBeInTheDocument(),
    );

    await search(DOWNEY, PALTROW, "iron man");
    await chooseFilm(IRON_MAN);

    await waitFor(() =>
      expect(
        within(emptyCell(DOWNEY, PALTROW)).getByText("you have already used that film"),
      ).toBeInTheDocument(),
    );
    // The refusal is specific: this is a different message from the "never in
    // that film together" one, because it is a different mistake.
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
  });

  it("hands the board in and reveals the best answer for every pairing", async () => {
    await setup();

    await search(DOWNEY, JACKSON, "iron man");
    await chooseFilm(IRON_MAN);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `${DOWNEY} and ${JACKSON}: Iron Man, 100 points` }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Hand it in" }));

    await screen.findByRole("heading", { name: "Cell by cell" });
    // 100 of a possible 900, one square of nine.
    expect(screen.getByText("/ 900")).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    // Nine pairings, each with exactly one revealed answer.
    expect(screen.getAllByText("Best answer")).toHaveLength(9);
  });
});

/* ------------------------------------------------------------------ */
/* Arriving with no board yet                                          */
/* ------------------------------------------------------------------ */

/**
 * "/grid" and "/grid/:id" are one route (`/grid/:gameId?`), so the page is
 * not torn down on the hop between them. Landing on the first, it creates a
 * board and replaces the URL with the second — which is what makes a board
 * reloadable and shareable rather than a session that dies with the tab.
 */
describe("GridScreen with no board in the URL", () => {
  /** Render the same route pair the app mounts, starting at `entry`. */
  function renderAt(entry: string, api: Api) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/grid/:gameId?"
            element={
              <GridProvider api={api}>
                <GridScreen />
              </GridProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("creates a board and lands on its own URL", async () => {
    const api = createMockApi({ latencyMs: 0 });
    renderAt("/grid", api);

    await screen.findByRole("heading", { name: "Name a film they were both in" });
    expect(screen.getAllByRole("button", { name: /^Name a film with / })).toHaveLength(9);
    // A fresh board, not a daily one: nothing says otherwise on the header.
    expect(screen.queryByText(/daily ·/)).toBeNull();
  });

  it("passes ?seed= through, which is what makes the daily board shared", async () => {
    const api = createMockApi({ latencyMs: 0 });
    renderAt("/grid?seed=2026-09-07", api);

    await screen.findByRole("heading", { name: "Name a film they were both in" });
    // The seed is echoed by the server and shown, so a player can tell which
    // board they are on before comparing scores with anyone.
    expect(screen.getByText("daily · 2026-09-07")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* The fixture board itself                                            */
/* ------------------------------------------------------------------ */

/**
 * The board the mock deals is hand-built rather than searched for, so the
 * guarantee the real generator provides has to be asserted here instead:
 * every one of the nine pairings genuinely shares a film, and nine *distinct*
 * films exist to fill them — otherwise the one-film-per-board rule would make
 * a full board impossible and `VITE_API_MOCK=true` would be a demo you cannot
 * finish.
 */
describe("the mock's fixture board", () => {
  /** One legal answer per cell, all nine different films. */
  const SOLUTION = [
    ["Iron Man", "Zodiac", "Iron Man 3"],
    ["Captain America: The Winter Soldier", "Avengers: Age of Ultron", "Iron Man 2"],
    ["Captain America: The First Avenger", "The Avengers", "Avengers: Endgame"],
  ];

  it("can be filled completely, and only then gives up its results", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const game = await api.createGridGame();

    // Results are refused while the board is still in play.
    await expect(api.getGridResults(game.id)).rejects.toThrow("the board is still in play");

    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        const title = SOLUTION[row][column];
        // Look the film up the way a player does, through search.
        const found = await api.searchGridFilms(game.id, { q: title });
        const film = found.find((f) => f.title === title);
        expect(film, `search found no film titled "${title}"`).toBeDefined();
        await api.answerGrid(game.id, { row, column, film_id: film!.film_id });
      }
    }

    // A full board is finished by itself: no hand-in needed.
    const results = await api.getGridResults(game.id);
    expect(results.filled).toBe(9);
    expect(results.total).toBe(9);
    expect(results.game.status).toBe("complete");
    // Every answer was legal, so every cell scored at least the floor.
    for (const cell of results.cells) expect(cell.score).toBeGreaterThanOrEqual(60);
    expect(results.score).toBeGreaterThan(9 * 60);

    // And the reveal names one film per pairing, never a list.
    expect(results.cells).toHaveLength(9);
    for (const cell of results.cells) {
      expect(cell.best_answer).toBeDefined();
      expect(cell.n_possible).toBeGreaterThanOrEqual(1);
      expect(cell).not.toHaveProperty("possible_answers");
    }
  });
});
