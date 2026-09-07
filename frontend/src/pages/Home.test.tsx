// Tests for the landing page (src/pages/Home.tsx).
//
// Home has one promise to keep, and it is the reason the page was rewritten:
// each of the three modes starts from a single press, and each has its daily
// variant one press away. So what is pinned here is where a press *lands* —
// the Oscars through `POST /api/games` and on to /play/:id, the two side
// modes straight onto their own route, and every daily carrying today's local
// date as its seed.
//
// The other half is the menu contract Home inherited from /modes: the server
// is the authority on which modes have their seed tables, and a mode it
// reports as unbuilt must not offer a start button at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { api } from "../api";
import type { GameState, ModeCard } from "../api/types";
import { todaySeed } from "../lib/format";
import { GameProvider } from "../state/GameContext";
import { SiteDialogProvider } from "../state/SiteDialogContext";
import { ToastProvider } from "../state/ToastContext";
import { HomePage } from "./Home";

/** The three cards the backend serves, with `available` under test control. */
function menu(overrides: Partial<Record<ModeCard["id"], boolean>> = {}): ModeCard[] {
  return [
    {
      id: "oscars",
      label: "The Oscars",
      tagline: "Build the best ballot in history",
      description: "Three years are dealt each round.",
      available: overrides.oscars ?? true,
      path: "/",
    },
    {
      id: "recast",
      label: "Recast",
      tagline: "Who else could have played the part?",
      description: "A film comes up with its principal roles.",
      available: overrides.recast ?? true,
      path: "/recast",
    },
    {
      id: "grid",
      label: "Six Degrees",
      tagline: "Name someone who connects them",
      description: "Three actors down the side, three across the top.",
      available: overrides.grid ?? true,
      path: "/grid",
    },
  ];
}

/**
 * Enough of a GameState for the store to accept it and for Home to navigate.
 *
 * The reducer only reads `id`, `mode` and `current_spin` on the way in, so a
 * full fixture would be forty fields of noise.
 */
const CREATED = {
  id: "game-1",
  mode: "classic",
  current_spin: null,
} as unknown as GameState;

/**
 * Anything Home navigates to renders this, so an assertion can read the URL
 * the press produced instead of mounting the real Play, Recast or Grid page.
 */
function Destination() {
  const location = useLocation();
  return <p data-testid="destination">{location.pathname + location.search}</p>;
}

/** Render Home under the providers it needs, with the menu stubbed. */
async function renderHome(modes: ModeCard[] = menu()) {
  vi.spyOn(api, "getModes").mockResolvedValue(modes);
  render(
    <ToastProvider>
      <GameProvider>
        <SiteDialogProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="*" element={<Destination />} />
            </Routes>
          </MemoryRouter>
        </SiteDialogProvider>
      </GameProvider>
    </ToastProvider>,
  );
  // Home paints from its fallback copy on the first frame and only knows the
  // real availability once /api/modes lands. Every assertion below is about
  // the settled page, so wait for it.
  await waitFor(() => expect(api.getModes).toHaveBeenCalled());
  await screen.findByRole("heading", { name: modes[0].label });
}

/** The URL the last press produced. */
async function landedOn(url: string) {
  await waitFor(() => expect(screen.getByTestId("destination")).toHaveTextContent(url));
}

beforeEach(() => {
  vi.spyOn(api, "createGame").mockResolvedValue(CREATED);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HomePage", () => {
  it("starts the Oscars in one press and hands the new game to /play", async () => {
    await renderHome();

    fireEvent.click(screen.getByRole("button", { name: "Play The Oscars" }));

    // The store POSTs, then Home routes to the game it got back — which is
    // the whole point of going through the store rather than the client:
    // /play/:id renders from context instead of re-fetching.
    await landedOn("/play/game-1");
    expect(api.createGame).toHaveBeenCalledWith({ mode: "classic", seed: undefined });
  });

  it("offers the Oscars' hard mode and its daily from the same tile", async () => {
    await renderHome();

    fireEvent.click(screen.getByRole("button", { name: "Play The Oscars in cinephile mode" }));
    await landedOn("/play/game-1");
    expect(api.createGame).toHaveBeenCalledWith({ mode: "cinephile", seed: undefined });
  });

  it("seeds the Oscars daily with today's local date", async () => {
    await renderHome();

    fireEvent.click(screen.getByRole("button", { name: "Play today's daily: The Oscars" }));
    await landedOn("/play/game-1");
    expect(api.createGame).toHaveBeenCalledWith({ mode: "classic", seed: todaySeed() });
  });

  it.each([
    ["Recast", "/recast"],
    ["Six Degrees", "/grid"],
  ])("starts %s on the route the server named", async (label, path) => {
    await renderHome();

    // The side modes create their own round on mount, so pressing Play only
    // has to move the browser — no POST from Home at all.
    fireEvent.click(screen.getByRole("button", { name: `Play ${label}` }));
    await landedOn(path);
    expect(api.createGame).not.toHaveBeenCalled();
  });

  it.each([
    ["Recast", "/recast"],
    ["Six Degrees", "/grid"],
  ])("hands %s's daily today's seed in the query string", async (label, path) => {
    await renderHome();

    fireEvent.click(screen.getByRole("button", { name: `Play today's daily: ${label}` }));
    await landedOn(`${path}?seed=${todaySeed()}`);
  });

  it("refuses to offer a mode the server says is not built", async () => {
    await renderHome(menu({ recast: false, grid: false }));

    // The fallback copy assumes every mode is available, so the tiles only
    // go dead once the server's answer lands.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Play Recast" })).toBeNull(),
    );

    for (const label of ["Recast", "Six Degrees"]) {
      const tile = screen.getByRole("heading", { name: label }).closest("[aria-disabled]");
      expect(tile).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByRole("button", { name: `Play today's daily: ${label}` })).toBeNull();
    }
    expect(screen.getAllByText("Not built")).toHaveLength(2);
    expect(screen.getAllByText(/needs its data built/i)).toHaveLength(2);

    // The Oscars needs no side-mode seed tables, so it is untouched.
    expect(screen.getByRole("button", { name: "Play The Oscars" })).toBeEnabled();
  });

  it("still paints a usable front door when the menu request fails", async () => {
    vi.spyOn(api, "getModes").mockRejectedValue(new Error("network down"));
    render(
      <ToastProvider>
        <GameProvider>
          <SiteDialogProvider>
            <MemoryRouter initialEntries={["/"]}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="*" element={<Destination />} />
              </Routes>
            </MemoryRouter>
          </SiteDialogProvider>
        </GameProvider>
      </ToastProvider>,
    );

    // The failure is stated, and the three tiles are still there from the
    // fallback copy rather than the page being a dead spinner.
    expect(await screen.findByRole("alert")).toHaveTextContent(/network down/i);
    for (const label of ["The Oscars", "Recast", "Six Degrees"]) {
      expect(screen.getByRole("button", { name: `Play ${label}` })).toBeInTheDocument();
    }
  });

  it("opens the rules on the mode whose tile was pressed", async () => {
    await renderHome();

    fireEvent.click(screen.getByRole("button", { name: "How to play Six Degrees" }));

    const dialog = await screen.findByRole("dialog", { name: "How to play" });
    // The grid's tab is the selected one, so the dialog opened on its rules
    // rather than on the default first mode.
    expect(
      within(dialog).getByRole("tab", { name: "Six Degrees", selected: true }),
    ).toBeInTheDocument();
  });
});
