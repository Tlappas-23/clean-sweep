// Tests for the game-mode menu (src/pages/Modes.tsx).
//
// The menu has exactly one non-obvious job, and it is the reason
// `ModeCard.available` is on the wire at all: a checkout that has only run
// `build_seed` has the Oscars data and neither side mode's, and the menu has
// to say so rather than offering a link that 503s. So the two things pinned
// here are that every mode the server sends reaches the screen, and that an
// unavailable one is rendered as a dead end: no link, marked disabled, with
// the reason on the card.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { api } from "../api";
import type { ModeCard } from "../api/types";
import { ModesPage } from "./Modes";

/** The three cards the backend serves, with `available` under test control. */
function menu(overrides: Partial<Record<ModeCard["id"], boolean>> = {}): ModeCard[] {
  return [
    {
      id: "oscars",
      label: "The Oscars",
      tagline: "Build the best ballot in history",
      description: "Three years are dealt each round and you draft one contender per category.",
      available: overrides.oscars ?? true,
      path: "/",
    },
    {
      id: "recast",
      label: "Recast",
      tagline: "Who else could have played the part?",
      description: "A film comes up with its principal roles. Replace each one from a shortlist.",
      available: overrides.recast ?? true,
      path: "/recast",
    },
    {
      id: "grid",
      label: "Six Degrees",
      tagline: "Name a film they were both in",
      description: "Three actors down the side, three across the top.",
      available: overrides.grid ?? true,
      path: "/grid",
    },
  ];
}

/** Render the page with `GET /api/modes` stubbed on the shared adapter. */
async function renderMenu(modes: ModeCard[]) {
  vi.spyOn(api, "getModes").mockResolvedValue(modes);
  render(
    <MemoryRouter>
      <ModesPage />
    </MemoryRouter>,
  );
  // The page opens on a loader; wait for the first card before asserting.
  await screen.findByRole("heading", { name: modes[0].label });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModesPage", () => {
  it("renders every mode the server sends, as a link to its own route", async () => {
    await renderMenu(menu());

    for (const mode of menu()) {
      expect(screen.getByRole("heading", { name: mode.label })).toBeInTheDocument();
      expect(screen.getByText(mode.tagline)).toBeInTheDocument();
    }

    // Each available card is a link across the whole tile, pointing at the
    // route the *server* named. The client does not decide where a mode lives.
    expect(screen.getByRole("link", { name: /The Oscars/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Recast/ })).toHaveAttribute("href", "/recast");
    expect(screen.getByRole("link", { name: /Six Degrees/ })).toHaveAttribute("href", "/grid");
  });

  it("offers the grid's shared daily board alongside a fresh one", async () => {
    await renderMenu(menu());

    // The seed is today's local date, the same one the Oscars daily uses.
    const daily = screen.getByRole("link", { name: /daily board/i });
    expect(daily.getAttribute("href")).toMatch(/^\/grid\?seed=\d{4}-\d{2}-\d{2}$/);
  });

  it("disables a mode whose data has not been built", async () => {
    await renderMenu(menu({ recast: false, grid: false }));

    // The Oscars mode still works: only the two side modes need seed tables.
    expect(screen.getByRole("link", { name: /The Oscars/ })).toBeInTheDocument();

    for (const label of ["Recast", "Six Degrees"]) {
      const card = screen.getByRole("heading", { name: label }).closest("[aria-disabled]");
      expect(card).not.toBeNull();
      expect(card).toHaveAttribute("aria-disabled", "true");
      // Nothing to click and nothing to focus: the tile is not a link at all.
      expect(within(card as HTMLElement).queryByRole("link")).toBeNull();
      expect(within(card as HTMLElement).getByText("Not built")).toBeInTheDocument();
      expect(
        within(card as HTMLElement).getByText(/needs its data built/i),
      ).toBeInTheDocument();
    }

    // And with the grid off, its daily shortcut goes with it.
    expect(screen.queryByRole("link", { name: /daily board/i })).toBeNull();
  });
});
