// Tests for the reels (src/components/play/SlotMachine.tsx).
//
// The machine is not just decoration any more: the year reels are the control
// that chooses which of the dealt years the grid below is showing. What is
// pinned here is that behaviour — one reel per dealt year, the viewed one
// marked, an "all years" option beside them, and none of it offered when a
// reroll has cut the board down to a single year.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Spin } from "../../api/types";
import { SlotMachine } from "./SlotMachine";

function spinOf(years: number[], overrides: Partial<Spin> = {}): Spin {
  return {
    category: "horror",
    year_options: years.map((year) => ({ year, decade: `${Math.floor(year / 10) * 10}s` })),
    locked: false,
    reroll_available: true,
    ...overrides,
  };
}

function renderMachine(spin: Spin | null, viewYear: number | null) {
  const onViewYear = vi.fn();
  render(
    <SlotMachine
      spin={spin}
      upcomingCategory="horror"
      status={spin ? "picking" : "spinning"}
      spinSerial={1}
      yearRange={{ min: 1950, max: 2025 }}
      canSpin={spin === null}
      spinning={false}
      onSpin={vi.fn()}
      viewYear={viewYear}
      onViewYear={onViewYear}
      onSettled={vi.fn()}
    />,
  );
  return { onViewYear };
}

describe("SlotMachine", () => {
  it("offers one reel per dealt year plus an all-years view", () => {
    renderMachine(spinOf([1960, 1986, 2008]), null);

    const group = screen.getByRole("radiogroup", { name: "Year to draft from" });
    expect(group).toBeInTheDocument();
    // Three years and "All years" — four ways to scope the pool.
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "1986, 1980s" })).toBeInTheDocument();
    // Nothing narrowed yet, so the all-years option is the checked one.
    expect(screen.getByRole("radio", { name: "All years" })).toBeChecked();
  });

  it("marks the year being viewed and reports a change", () => {
    const { onViewYear } = renderMachine(spinOf([1960, 1986, 2008]), 2008);

    expect(screen.getByRole("radio", { name: "2008, 2000s" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "1960, 1960s" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "1960, 1960s" }));
    expect(onViewYear).toHaveBeenCalledWith(1960);

    fireEvent.click(screen.getByRole("radio", { name: "All years" }));
    expect(onViewYear).toHaveBeenCalledWith(null);
  });

  it("drops the choice entirely once a reroll has locked the board", () => {
    renderMachine(spinOf([1975], { locked: true, reroll_available: false }), 1975);

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Locked to this year")).toBeInTheDocument();
  });
});
