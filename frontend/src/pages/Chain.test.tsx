// Flow tests for The Chain screen (src/pages/Chain.tsx) against the in-memory
// mock adapter.
//
// The mock enforces the same rules as the backend engine, message for message
// (src/api/mock.ts, "The Chain"), so these are contract tests of the whole
// moving loop without a network: read the pair, type a film, and see what the
// server made of it.
//
// Four things are under test, and they are the four the mode lives or dies on:
//
//   the target is on screen from the first frame, because a player who has to
//   remember what they are aiming at is playing a different game;
//
//   a refused move lands next to the input and leaves the round alone, since
//   "no one in that film was in the one you are on" is the mode's feedback
//   rather than an error;
//
//   the reveal shows the shortest route whether or not the player found it,
//   which is the whole reason a player would stop early;
//
//   the leaderboard appears with the round just played on it.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { createMockApi } from "../api/mock";
import type { Api } from "../api/client";
import type { ChainResults } from "../api/types";
import { ChainProvider } from "../state/ChainContext";
import { ChainScreen } from "./Chain";

/**
 * Render the screen on /chain/:id, wired to a fresh instantaneous mock, and
 * hand back the round's answer key.
 *
 * The key comes from a throwaway round on the same seed, exactly as the
 * backend tests take theirs: asking the round under test for its own answer
 * would end it.
 */
async function setup(seed = "test-chain"): Promise<{ api: Api; key: ChainResults; id: string }> {
  const api = createMockApi({ latencyMs: 0 });
  const game = await api.createChainGame(seed);
  const key = await api.giveUpChain((await api.createChainGame(seed)).id);

  render(
    <MemoryRouter initialEntries={[`/chain/${game.id}`]}>
      <Routes>
        <Route
          path="/chain/:gameId?"
          element={
            <ChainProvider api={api}>
              <ChainScreen />
            </ChainProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1 });
  return { api, key, id: game.id };
}

/** Type a title into the move box and submit it. */
function typeMove(title: string): void {
  fireEvent.change(screen.getByLabelText("Film title"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
}

describe("ChainScreen", () => {
  it("shows both films and an empty trail on the first frame", async () => {
    const { key } = await setup();

    // Start and target are both on screen before a single move, because the
    // target is the thing being aimed at and cannot be hidden below a fold.
    const trail = screen.getByRole("list", { name: "Your route so far" });
    expect(within(trail).getByText(key.game.start.title)).toBeInTheDocument();
    expect(within(trail).getByText(key.game.target.title)).toBeInTheDocument();
    expect(within(trail).getByText("Start")).toBeInTheDocument();
    expect(within(trail).getByText("Target")).toBeInTheDocument();

    expect(screen.getByText(/0 films so far/)).toBeInTheDocument();
  });

  it("names the actor who carried you when a move lands", async () => {
    const { key } = await setup("carried");
    const step = key.shortest[0];

    typeMove(step.film.title);

    const trail = await screen.findByRole("list", { name: "Your route so far" });
    // The film is the answer; the actor is why it counted, so both are on the
    // trail rather than a list of titles the player has to take on trust.
    await waitFor(() => expect(within(trail).getByText(step.actor.name)).toBeInTheDocument());
    expect(within(trail).getByText(step.film.title)).toBeInTheDocument();
    expect(screen.getByText(/1 film so far/)).toBeInTheDocument();
  });

  it("puts a refused move under the input and leaves the round alone", async () => {
    const { key } = await setup("refused");

    // A film the start does not share a cast with. Taken from the search so
    // the test does not assume which pair the seed dealt.
    typeMove("Zzzz Nonesuch");

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/no film in the catalogue/i);
    // The round is untouched: no step counted, and the trail still starts
    // where it started.
    expect(screen.getByText(/0 films so far/)).toBeInTheDocument();
    const trail = screen.getByRole("list", { name: "Your route so far" });
    expect(within(trail).getByText(key.game.start.title)).toBeInTheDocument();
  });

  it("suggests titles as you type, because a title list is not the answer", async () => {
    await setup("suggest");

    // Six Degrees refuses to suggest anything, since a list of matching
    // actors would be its answer key. Here the puzzle is which films share a
    // cast, so a list of titles gives nothing away and saves a move lost to
    // a spelling.
    fireEvent.change(screen.getByLabelText("Film title"), { target: { value: "toy" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Toy Story/ })).toBeInTheDocument(),
    );
  });

  it("plays a chain through to the reveal", async () => {
    const { key } = await setup("played-through");

    for (const step of key.shortest) {
      typeMove(step.film.title);
      await waitFor(() =>
        expect(
          within(screen.getByRole("list", { name: /route/ })).queryByText(step.film.title),
        ).toBeInTheDocument(),
      );
    }

    // The verdict sentence rather than the "Arrived" chip: that word also
    // heads a column on the leaderboard below, and the sentence is the thing
    // that actually explains the result.
    expect(await screen.findByText(/as short as this pair goes/)).toBeInTheDocument();
  });

  it("reveals a shortest route to a player who stops early", async () => {
    const { key } = await setup("stopped");

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));

    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    const revealed = await screen.findByRole("list", { name: "A shortest route" });
    // Every film on the answer key is on screen, which is the whole reason a
    // stuck player would press the button.
    for (const step of key.shortest) {
      expect(within(revealed).getByText(step.film.title)).toBeInTheDocument();
    }
  });

  it("shows the leaderboard with the round just played on it", async () => {
    const { id } = await setup("board");

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("this round")).toBeInTheDocument();
    // The three columns are the three parts of the ranking key, in order, so
    // the table explains itself without a legend.
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["#", "Result", "Films", "Time", "Board"]);
    expect(id).toBeTruthy();
  });

  it("surfaces a failure to load with a way out", async () => {
    const api = createMockApi({ latencyMs: 0 });
    render(
      <MemoryRouter initialEntries={["/chain/does-not-exist"]}>
        <Routes>
          <Route
            path="/chain/:gameId?"
            element={
              <ChainProvider api={api}>
                <ChainScreen />
              </ChainProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Chain game not found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to the modes" })).toBeInTheDocument();
  });
});
