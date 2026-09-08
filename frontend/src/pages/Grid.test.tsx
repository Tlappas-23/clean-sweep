// Flow tests for the Six Degrees screen (src/pages/Grid.tsx) against the
// in-memory mock adapter.
//
// The mock enforces the same rules as the backend engine, message for message
// (src/api/mock.ts, "Six Degrees"), so these are contract tests of the whole
// answering loop without a network: click a square, search, name an actor,
// and see what the server made of it.
//
// The rejections are the point of the mode, so each gets its own test. A
// player who names someone who does not bridge the pair, or re-uses an actor
// they have already spent, has to be told which of those two things happened,
// and told it against the square they clicked, not in a toast that has
// faded by the time they look up.
//
// The other thing under test is what replaced the autocomplete. There is no
// suggestion list, because a list of matching actors is a list of the cell's
// answers; the player types a whole name and the spelling is forgiven. So
// these also check that a misspelling lands and that nothing on screen offers
// a name before it is typed.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { createMockApi } from "../api/mock";
import type { Api } from "../api/client";
import { GridProvider } from "../state/GridContext";
import { GridScreen } from "./Grid";

/**
 * The fixture board (src/api/mock.ts). Each cell has an obvious route, worth
 * the floor, and a rarest one, worth 100:
 *
 *                  Hanks                   Stone                Hopkins
 *   Weaver         Tim Allen  / Cusack     Murray  / Rogen      Hemsworth / Ryder
 *   Ford           Craig      / Griffith   Gosling / McAdams    Pitt      / Baldwin
 *   Kidman         Streep     / Hoffman    Penn    / Firth      Moore     / Elwes
 *
 * No actor down the side has ever worked with one across the top, and that
 * is what makes the middle worth finding. The cell a test clicks is named by its
 * two actors, exactly as the accessible label does.
 */
const WEAVER = "Sigourney Weaver";
const HANKS = "Tom Hanks";
const HOPKINS = "Anthony Hopkins";

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
  await screen.findByRole("heading", { name: "Name the actor who connects them" });
  return { api };
}

/** The empty square where `row` meets `column`, found by its label. */
function emptyCell(rowActor: string, columnActor: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Name an actor who connects ${rowActor} and ${columnActor}`,
  });
}

/** Open a square, type a name into its box, and submit it. */
async function answerWith(rowActor: string, columnActor: string, name: string) {
  fireEvent.click(emptyCell(rowActor, columnActor));
  const box = await screen.findByRole("textbox", { name: /Type the actor/ });
  fireEvent.change(box, { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
}

/**
 * The cell this suite fills, by the label it takes once answered.
 *
 * Joan Cusack is the *rarest* link for Weaver and Hanks, so she is worth the
 * full 100 where Tim Allen, the obvious route, would be worth 60. The label
 * carries the whole chain because that is what a screen reader has to hear.
 */
const CUSACK_CELL =
  `${WEAVER} and ${HANKS}: connected by Joan Cusack, ` +
  `Working Girl with ${WEAVER} and Toy Story 2 with ${HANKS}, 100 points`;

describe("GridScreen", () => {
  it("draws the board: three actors each way and nine empty squares", async () => {
    await setup();

    expect(screen.getByText(WEAVER)).toBeInTheDocument();
    expect(screen.getByText(HANKS)).toBeInTheDocument();
    // Nine cells, all offering to be named.
    expect(screen.getAllByRole("button", { name: /^Name an actor who connects / })).toHaveLength(9);
    // The clock is the server's, rendered as M:SS. The exact figure is the
    // server's business: a three-minute round that has already been running
    // for a few milliseconds reads 2:59, and that is correct.
    expect(screen.getByRole("timer").textContent).toMatch(/^[0-3]:[0-5]\d$/);
  });

  it("fills a square and scores it when the actor really does connect the pair", async () => {
    await setup();

    await answerWith(WEAVER, HANKS, "Joan Cusack");

    // Cusack is the deepest cut on that cell's list, so it takes the full 100,
    // and the square now carries the whole chain in its own label (the name
    // and the two films that prove it) rather than only in its pixels.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: CUSACK_CELL })).toBeInTheDocument(),
    );
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
    expect(screen.getByText("100 points")).toBeInTheDocument();
    // The evidence is on the board, not held back for the reveal.
    const cell = screen.getByRole("button", { name: CUSACK_CELL });
    expect(within(cell).getByText("Working Girl")).toBeInTheDocument();
    expect(within(cell).getByText("Toy Story 2")).toBeInTheDocument();
    // A filled square stops taking answers; the server would 409 anyway.
    expect(cell).toBeDisabled();
  });

  it("shows the server's own words against someone who does not connect the pair", async () => {
    await setup();

    // Denzel Washington connects nobody on this board. The roster knows him
    // on purpose: being told why he is wrong is the feedback the mode gives.
    await answerWith(WEAVER, HANKS, "Denzel Washington");

    const cell = await waitFor(() => {
      const found = emptyCell(WEAVER, HANKS);
      expect(within(found).getByText("that actor does not connect those two")).toBeInTheDocument();
      return found;
    });

    // The square is still empty and still answerable: the rejection is an
    // invitation to try again, not the end of the cell.
    expect(cell).toBeEnabled();
    expect(screen.getByText("0 of 9")).toBeInTheDocument();

    // And it really is answerable. The right name still goes in.
    await answerWith(WEAVER, HANKS, "Joan Cusack");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: CUSACK_CELL })).toBeInTheDocument(),
    );
  });

  it("pays less for the connection everybody would reach for", async () => {
    await setup();

    // Tim Allen tops that cell's list, so he is the obvious route and worth
    // the floor. That gap is the whole point of the scale: anyone who can name
    // the pair can find him, so finding him is not what the mode rewards.
    await answerWith(WEAVER, HANKS, "Tim Allen");
    await waitFor(() => expect(screen.getByText("60 points")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: new RegExp(`connected by Tim Allen.*60 points`) }),
    ).toBeInTheDocument();
  });

  it("refuses an actor who has already been used on this board", async () => {
    await setup();

    // Alec Baldwin legally answers three cells on this board, since Working
    // Girl puts him with both Weaver and Ford, but a board only gets one of him.
    await answerWith(WEAVER, HOPKINS, "Alec Baldwin");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /connected by Alec Baldwin/ })).toBeInTheDocument(),
    );

    await answerWith(WEAVER, "Emma Stone", "Alec Baldwin");

    await waitFor(() =>
      expect(
        within(emptyCell(WEAVER, "Emma Stone")).getByText("you have already used that actor"),
      ).toBeInTheDocument(),
    );
    // The refusal is specific: this is a different message from the "does not
    // connect those two" one, because it is a different mistake.
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
  });

  it("hands the board in and reveals the best connection for every pairing", async () => {
    await setup();

    await answerWith(WEAVER, HANKS, "Joan Cusack");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: CUSACK_CELL })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Hand it in" }));

    await screen.findByRole("heading", { name: "Cell by cell" });
    // 100 of a possible 900, one square of nine.
    expect(screen.getByText("/ 900")).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    // Nine pairings, each showing both ends of its range.
    expect(screen.getAllByText("Most would say")).toHaveLength(9);
    expect(screen.getAllByText("Rarest link")).toHaveLength(9);
    // And each route is proved by two films rather than asserted as a name.
    expect(
      screen.getByLabelText("Tim Allen and Sigourney Weaver were both in Galaxy Quest, 1999"),
    ).toBeInTheDocument();
  });

  it("offers no suggestions, because a suggestion list is the answer key", async () => {
    await setup();
    fireEvent.click(emptyCell(WEAVER, HANKS));

    const box = await screen.findByRole("textbox", { name: /Type the actor/ });
    // The browser's own suggestions are as much of a giveaway as ours.
    expect(box).toHaveAttribute("autocomplete", "off");

    // Typing most of a valid connector's name must not put it on screen.
    fireEvent.change(box, { target: { value: "Bill Pax" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText("Bill Paxton")).toBeNull();
    // Nor any other list of names to pick from.
    const panel = screen.getByRole("form", { name: /Name an actor who connects/ });
    expect(within(panel).queryByRole("list")).toBeNull();
  });

  it("forgives a misspelling rather than making the player type it exactly", async () => {
    await setup();

    // A dropped letter and a lost middle initial both have to land, or a mode
    // with no autocomplete is just a spelling test.
    await answerWith(WEAVER, HANKS, "joan cusak");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: CUSACK_CELL })).toBeInTheDocument(),
    );

    await answerWith(WEAVER, HOPKINS, "chris hemsworth");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /connected by Chris Hemsworth/ }),
      ).toBeInTheDocument(),
    );
  });

  it("refuses to guess between two people who share a name", async () => {
    await setup();

    // "Bill" fits Paxton and Murray. Picking the more famous silently would
    // score a cell the player did not actually answer.
    await answerWith(WEAVER, HANKS, "Bill");
    await waitFor(() =>
      expect(
        within(emptyCell(WEAVER, HANKS)).getByText("several actors share that name; type it in full"),
      ).toBeInTheDocument(),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Arriving with no board yet                                          */
/* ------------------------------------------------------------------ */

/**
 * "/grid" and "/grid/:id" are one route (`/grid/:gameId?`), so the page is
 * not torn down on the hop between them. Landing on the first, it creates a
 * board and replaces the URL with the second, which is what makes a board
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

    await screen.findByRole("heading", { name: "Name the actor who connects them" });
    expect(screen.getAllByRole("button", { name: /^Name an actor who connects / })).toHaveLength(9);
    // A fresh board, not a daily one: nothing says otherwise on the header.
    expect(screen.queryByText(/daily ·/)).toBeNull();
  });

  it("passes ?seed= through, which is what makes the daily board shared", async () => {
    const api = createMockApi({ latencyMs: 0 });
    renderAt("/grid?seed=2026-09-07", api);

    await screen.findByRole("heading", { name: "Name the actor who connects them" });
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
 * guarantees the real generator provides have to be asserted here instead:
 * no pairing on the board has worked together, every cell has at least three
 * connectors, and nine *distinct* actors exist to fill the nine cells.
 * Otherwise the one-actor-per-board rule would make a full board impossible
 * and `VITE_API_MOCK=true` would be a demo you cannot finish.
 */
describe("the mock's fixture board", () => {
  /** The *rarest* connector for each cell: nine different people, all 100s. */
  const SOLUTION = [
    ["Joan Cusack", "Seth Rogen", "Winona Ryder"],
    ["Melanie Griffith", "Rachel McAdams", "Alec Baldwin"],
    ["Philip Seymour Hoffman", "Colin Firth", "Cary Elwes"],
  ];

  it("can be filled completely, and only then gives up its results", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const game = await api.createGridGame();

    // Results are refused while the board is still in play.
    await expect(api.getGridResults(game.id)).rejects.toThrow("the board is still in play");

    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        // Typed the way a player types it, since that is the only way in.
        await api.answerGrid(game.id, { row, column, name: SOLUTION[row][column] });
      }
    }

    // A full board is finished by itself: no hand-in needed.
    const results = await api.getGridResults(game.id);
    expect(results.filled).toBe(9);
    expect(results.total).toBe(9);
    expect(results.game.status).toBe("complete");
    // Those nine were each cell's rarest, so the board is perfect and maxed.
    // That it is reachable at all is the guarantee: a connector can be played
    // once, so nine distinct rarest links are what make 900 possible.
    expect(results.perfect).toBe(true);
    expect(results.score).toBe(900);

    // And the reveal names two connectors per pairing, never the list between
    // them, each with the two films that prove it.
    expect(results.cells).toHaveLength(9);
    const rarest = new Set<string>();
    for (const cell of results.cells) {
      expect(cell.n_possible).toBeGreaterThanOrEqual(3);
      expect(cell.rarest.score).toBe(100);
      expect(cell.obvious.score).toBe(60);
      for (const route of [cell.obvious, cell.rarest]) {
        expect(route.actor.person_id).toBeTruthy();
        expect(route.films).toHaveLength(2);
      }
      rarest.add(cell.rarest.actor.person_id);
      expect(cell).not.toHaveProperty("possible_answers");
    }
    expect(rarest.size, "the nine rarest links must be nine different people").toBe(9);
  });

  it("puts nobody opposite someone they have worked with", async () => {
    // The rule that makes a cell worth answering: if the two heading it share
    // a film, that film's whole cast answers it and the puzzle evaporates.
    // The fixture cannot check a graph, so it checks the next best thing:
    // no connector is one of the six on the board.
    const api = createMockApi({ latencyMs: 0 });
    const game = await api.createGridGame();
    const results = await api.completeGrid(game.id);

    const headers = new Set([...game.rows, ...game.columns].map((a) => a.person_id));
    expect(headers.size).toBe(6);
    for (const cell of results.cells) {
      expect(headers.has(cell.obvious.actor.person_id)).toBe(false);
      expect(headers.has(cell.rarest.actor.person_id)).toBe(false);
    }
  });

  it("knows actors who connect nobody, so the rejection is reachable", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const game = await api.createGridGame();

    // Denzel Washington is on the roster and bridges nothing here, which is
    // a different failure from a name the catalog has never heard of.
    await expect(
      api.answerGrid(game.id, { row: 0, column: 0, name: "Denzel Washington" }),
    ).rejects.toThrow("that actor does not connect those two");
    await expect(
      api.answerGrid(game.id, { row: 0, column: 0, name: "Zxqv Nonsuch" }),
    ).rejects.toThrow("no actor in the catalog goes by that name");
  });

  it("resolves a typed name the way the server does", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const game = await api.createGridGame();

    // Punctuation, case and a dropped middle initial all reach the same
    // person; the mock mirrors resolve_actor so the UI cannot grow around
    // behaviour the backend does not have.
    for (const typed of ["Joan Cusack", "joan cusack", "JOAN CUSACK", "joan cusak"]) {
      const fresh = await api.createGridGame();
      const state = await api.answerGrid(fresh.id, { row: 0, column: 0, name: typed });
      expect(state.cells[0].link?.actor.name, `"${typed}" did not resolve`).toBe("Joan Cusack");
    }

    // But it will not choose between two people who share a name.
    await expect(api.answerGrid(game.id, { row: 0, column: 0, name: "Bill" })).rejects.toThrow(
      "several actors share that name",
    );
  });
});
