// Tests for the banner that states the round (src/components/play/SpinBanner.tsx).
//
// Two things here are easy to get subtly wrong and expensive to get wrong:
//   * the two genre slots are NOT Academy Awards, and a banner that implies
//     they are sends the player hunting for nominees that never existed;
//   * the reroll has to state its stake *before* it is spent, because it
//     destroys the two years the player did not choose.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Category, GameState, Spin } from "../../api/types";
import { SpinBanner } from "./SpinBanner";

function spinOf(category: Category, years: number[], overrides: Partial<Spin> = {}): Spin {
  return {
    category,
    year_options: years.map((year) => ({ year, decade: `${Math.floor(year / 10) * 10}s` })),
    locked: false,
    reroll_available: true,
    ...overrides,
  };
}

function gameOf(spin: Spin, round: number): GameState {
  return {
    id: "g1",
    mode: "classic",
    seed: null,
    status: "picking",
    round,
    category_order: [
      "picture",
      "director",
      "actor",
      "actress",
      "supporting_actor",
      "supporting_actress",
      "horror",
      "comedy",
    ],
    current_spin: spin,
    skips_remaining: { category: 1 },
    picks: [],
    created_at: "2026-09-06T00:00:00Z",
  };
}

function renderBanner(spin: Spin, round = 1, overrides: Partial<Parameters<typeof SpinBanner>[0]> = {}) {
  const onReroll = vi.fn();
  const onSkip = vi.fn();
  render(
    <SpinBanner
      game={gameOf(spin, round)}
      disabled={false}
      rerolling={false}
      onSkip={onSkip}
      onReroll={onReroll}
      {...overrides}
    />,
  );
  return { onReroll, onSkip };
}

describe("SpinBanner", () => {
  it("names every year on the board and the round it belongs to", () => {
    renderBanner(spinOf("actor", [1939, 1975, 1994]), 3);

    expect(screen.getByText("1939 · 1975 · 1994")).toBeInTheDocument();
    expect(screen.getByText(/Round 3 of 8/)).toBeInTheDocument();
    expect(screen.getByText(/any of these 3 years/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Best Actor/ })).toBeInTheDocument();
  });

  it("renders a genre round as a crown, not an Academy Award", () => {
    renderBanner(spinOf("horror", [1960, 1986, 2008]), 7);

    expect(screen.getByRole("heading", { name: /Best Horror/ })).toBeInTheDocument();
    expect(screen.getByText(/Not an Academy Award/)).toBeInTheDocument();
    expect(screen.getByText(/genre crown/)).toBeInTheDocument();
    // A film slot, so the instruction asks for a film rather than a performance.
    expect(screen.getByText(/strongest film/)).toBeInTheDocument();
  });

  it("states the reroll's stake before it is spent", () => {
    const { onReroll } = renderBanner(spinOf("picture", [1939, 1975, 1994]));

    const button = screen.getByRole("button", {
      name: /trade all three years for one you must use/i,
    });
    expect(button).toBeEnabled();
    expect(screen.getByText(/no going back/i)).toBeInTheDocument();

    fireEvent.click(button);
    expect(onReroll).toHaveBeenCalledTimes(1);
  });

  it("shows the round as committed once the reroll is spent", () => {
    renderBanner(spinOf("picture", [1975], { locked: true, reroll_available: false }));

    expect(
      screen.queryByRole("button", { name: /trade all/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Reroll spent")).toBeInTheDocument();
    expect(screen.getByText(/This round is committed to/)).toBeInTheDocument();
    expect(screen.getByText(/locked to/)).toBeInTheDocument();
  });

  it("keeps the category skip and drops the old year skip", () => {
    const { onSkip } = renderBanner(spinOf("picture", [1939, 1975, 1994]));

    expect(screen.queryByRole("button", { name: /skip year/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skip category/i }));
    expect(onSkip).toHaveBeenCalledWith("category");
  });
});
