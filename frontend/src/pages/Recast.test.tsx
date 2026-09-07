// Flow tests for the Recast screen (src/pages/Recast.tsx) against the
// in-memory mock adapter.
//
// The mock enforces the same rules as the backend engine, message for message
// (src/api/mock.ts, "Recast"), so these are contract tests of the whole
// casting loop without a network: read the part, pick a name off its
// shortlist, lock it in, and see what the round made of the four choices.
//
// Three of these tests exist because of a rule the mode would be pointless
// without. A shortlist is drawn from the original actor's casting type and
// never offers somebody already cast, so the fixture's two lead roles share a
// casting type on purpose — cast one and the exclusion is observable in the
// next. The server refuses anyone off the shortlist, and that refusal has to
// reach the player in the server's own words. And the reveal has to show both
// halves of its argument: the four components the fit is made of, and the
// best casting the shortlist actually offered.
//
// The fixture film (src/api/mock.ts): Heat (1995), four roles —
//   #1 Neil McCauley  Robert De Niro  lead        Marquee Lead
//   #2 Vincent Hanna  Al Pacino       lead        Marquee Lead
//   #3 Chris Shiherlis Val Kilmer     supporting  Leading Player
//   #4 Nate           Jon Voight      supporting  Working Actor

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { createMockApi, type MockOptions } from "../api/mock";
import type { Api } from "../api/client";
import { RecastProvider } from "../state/RecastContext";
import { RecastScreen } from "./Recast";

/** Render the screen on the app's own route pattern, starting at `entry`. */
function renderAt(entry: string, api: Api) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/recast/:gameId?"
          element={
            <RecastProvider api={api}>
              <RecastScreen />
            </RecastProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Start a round on the server, then render the page pointed at it. */
async function setup(options: MockOptions = {}): Promise<{ api: Api }> {
  const api = createMockApi({ latencyMs: 0, ...options });
  const game = await api.createRecastGame();
  renderAt(`/recast/${game.id}`, api);
  await screen.findByRole("heading", { name: "Heat", level: 1 });
  return { api };
}

/**
 * The shortlist panel, as a landmark.
 *
 * Everything is scoped through this rather than through the whole screen,
 * because the cast list on the left names the same actors — an assertion that
 * somebody is "not offered" has to mean not offered *here*.
 */
function shortlistPanel(): HTMLElement {
  return screen.getByRole("region", { name: /^Who plays/ });
}

/** The shortlist's cards, in the order the server sent them. */
async function shortlistCards(): Promise<HTMLElement[]> {
  return waitFor(() => {
    const cards = within(shortlistPanel()).getAllByRole("button", { pressed: false });
    expect(cards.length).toBeGreaterThan(0);
    return cards;
  });
}

/** Highlight the nth card and lock it in. Resolves with the name cast. */
async function castNth(index = 0): Promise<string> {
  const cards = await shortlistCards();
  const card = cards[index];
  // A card leads with the actor's name, so its first line is who is about to
  // be cast — which is what the exclusion test needs to go looking for next.
  const name = card.firstElementChild?.textContent ?? "";
  fireEvent.click(card);
  fireEvent.click(await screen.findByRole("button", { name: "Lock in" }));
  return name;
}

describe("RecastScreen", () => {
  it("shows the film, its cast in billing order, and the first role's shortlist", async () => {
    await setup();

    // The film is the subject of the page, so it is the h1.
    expect(screen.getByRole("heading", { name: "Heat", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("1995")).toBeInTheDocument();

    // Four roles, billing order, leads marked apart from supporting parts.
    const roles = within(screen.getByRole("region", { name: "The cast" })).getAllByRole("listitem");
    expect(roles).toHaveLength(4);
    expect(roles[0]).toHaveTextContent("Neil McCauley");
    expect(roles[0]).toHaveTextContent("Lead");
    expect(roles[3]).toHaveTextContent("Nate");
    expect(roles[3]).toHaveTextContent("Supporting");
    expect(screen.getByText("0 of 4")).toBeInTheDocument();

    // The shortlist is for the top-billed part, and it says where it came from.
    expect(
      screen.getByRole("heading", { name: "Who plays Neil McCauley?" }),
    ).toBeInTheDocument();
    const panel = shortlistPanel();
    expect(panel).toHaveTextContent("the same casting type as Robert De Niro");
    // Never the original: De Niro cannot be offered for his own part.
    expect(within(panel).queryByText("Robert De Niro")).toBeNull();
    // A card carries the four things the fit is actually made of.
    const first = (await shortlistCards())[0];
    expect(first).toHaveTextContent("Marquee Lead");
    expect(first).toHaveTextContent(/\d+ films/);
    expect(first).toHaveTextContent(/\d{4}–\d{4}/);
    expect(first).toHaveTextContent(/leads \d+% of the time/);
  });

  it("never offers an actor who has already been cast", async () => {
    await setup();

    // Both leads are drawn from the Marquee Lead pool, so whoever takes the
    // first part has to be gone from the second.
    const cast = await castNth(0);
    await screen.findByRole("heading", { name: "Who plays Vincent Hanna?" });

    await waitFor(() => {
      expect(within(shortlistPanel()).queryByText(cast)).toBeNull();
    });
    // They are still on the page — the cast list has them in the part they
    // took — which is exactly why this assertion is scoped to the panel.
    // `getAllByText` rather than `getByText` because both fixture leads share
    // a casting type: whoever takes the first part is also somebody's
    // original, so their name legitimately appears twice in that column.
    expect(
      within(screen.getByRole("region", { name: "The cast" })).getAllByText(cast, { exact: false })
        .length,
    ).toBeGreaterThan(0);
  });

  it("plays every role through to the reveal", async () => {
    await setup();

    await castNth(0);
    await screen.findByRole("heading", { name: "Who plays Vincent Hanna?" });
    await castNth(0);
    await screen.findByRole("heading", { name: "Who plays Chris Shiherlis?" });
    await castNth(0);
    await screen.findByRole("heading", { name: "Who plays Nate?" });
    await castNth(0);

    // The server turns the round complete on the last cast; the page fetches
    // the reveal off that rather than counting picks itself.
    await screen.findByRole("heading", { name: "Role by role" });
    // The headline is out of 100 and so is every role, which is the point of
    // a mean: the two numbers are on one scale and can be read against each
    // other without arithmetic.
    expect(screen.getAllByText("/ 100")).toHaveLength(1 + 4);
    expect(screen.getByText(/Mean fit across/)).toHaveTextContent("4");
    // One panel per role, and the two ends of the round named.
    expect(screen.getAllByText(/^#[1-4]$/)).toHaveLength(4);
    expect(screen.getByText(/^Strongest:/)).toBeInTheDocument();
    expect(screen.getByText(/^Weakest:/)).toBeInTheDocument();
  });

  it("shows the four fit components and the best available casting", async () => {
    await setup();

    for (let i = 0; i < 4; i++) {
      await castNth(0);
      if (i < 3) await shortlistCards();
    }
    await screen.findByRole("heading", { name: "Role by role" });

    // Four bars per role, always the same four, always in weight order.
    const bars = screen.getAllByRole("meter");
    expect(bars).toHaveLength(4 * 4);
    expect(bars.slice(0, 4).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Stature",
      "Role fit",
      "Genre",
      "Era",
    ]);
    // Every bar carries a real 0-100 value: the breakdown is never masked.
    for (const bar of bars) {
      const value = Number(bar.getAttribute("aria-valuenow"));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }

    // And every role has something to compare against — either the name that
    // beat the player's, or the note that they took the best on offer.
    const comparisons =
      screen.queryAllByText("Best available").length +
      screen.queryAllByText(/nothing to compare/).length;
    expect(comparisons).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/on the shortlist you were shown/).length).toBeGreaterThan(0);
  });

  it("shows the server's own words when the actor was not on the shortlist", async () => {
    // The UI only ever offers what the server sent, so the only way to reach
    // the 400 is a shortlist that has gone stale under it — here, one with the
    // original actor spliced in. That is the case the guard exists for: the
    // client's list is a snapshot, and the server's is the truth.
    const base = createMockApi({ latencyMs: 0 });
    const game = await base.createRecastGame();
    const api: Api = {
      ...base,
      async getRecastShortlist(id: string) {
        const real = await base.getRecastShortlist(id);
        return [game.roles[0].original, ...real];
      },
    };

    renderAt(`/recast/${game.id}`, api);
    await screen.findByRole("heading", { name: "Who plays Neil McCauley?" });

    // The spliced-in card is De Niro himself, first in the list.
    const cards = await shortlistCards();
    fireEvent.click(cards[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Lock in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("that actor is not on this role's shortlist");
    // The round did not move on, and the highlight survives: the player is
    // still mid-decision and the message is about the name they chose.
    expect(screen.getByRole("heading", { name: "Who plays Neil McCauley?" })).toBeInTheDocument();
    expect(screen.getByText("0 of 4")).toBeInTheDocument();
    expect(within(shortlistPanel()).getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("renders the empty state when the mode's seed tables were never built", async () => {
    // The 503 both side modes return is not a failure to retry — it is a
    // checkout that has not run a build step — so it gets the empty state and
    // the server's own message, which names the commands.
    const api = createMockApi({ latencyMs: 0, recastSeeded: false });
    renderAt("/recast", api);

    await screen.findByRole("heading", { name: "Recast has not been built yet" });
    expect(screen.getByText(/python -m ml\.actors/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to the modes" })).toBeInTheDocument();
    // No error banner: this is a destination, not a retryable failure.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Arriving with no round yet                                          */
/* ------------------------------------------------------------------ */

/**
 * "/recast" and "/recast/:id" are one route (`/recast/:gameId?`), so the page
 * survives the hop between them. Landing on the first, it starts a round and
 * replaces the URL with the second — which is what makes a round reloadable
 * and shareable rather than a session that dies with the tab.
 */
describe("RecastScreen with no round in the URL", () => {
  it("starts a round and lands on its own URL", async () => {
    const api = createMockApi({ latencyMs: 0 });
    renderAt("/recast", api);

    await screen.findByRole("heading", { name: "Heat", level: 1 });
    expect(screen.getByRole("heading", { name: "Who plays Neil McCauley?" })).toBeInTheDocument();
    // A fresh film, not a daily one — and the offer to play the daily instead.
    expect(screen.queryByText(/daily ·/)).toBeNull();
    expect(screen.getByRole("link", { name: /today’s daily film/ })).toBeInTheDocument();
  });

  it("passes ?seed= through, which is what makes the daily film shared", async () => {
    const api = createMockApi({ latencyMs: 0 });
    renderAt("/recast?seed=2026-09-07", api);

    await screen.findByRole("heading", { name: "Heat", level: 1 });
    // The seed is echoed by the server and shown, so a player can tell which
    // round they are on before comparing scores with anyone.
    expect(screen.getByText("daily · 2026-09-07")).toBeInTheDocument();
  });
});
