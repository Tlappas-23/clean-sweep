// Tests for the countdown (src/components/grid/GridClock.tsx).
//
// Two things are worth pinning. The format, because "0:07" and "0:7" are not
// the same glance; and the urgency threshold, because the last thirty seconds
// are the whole reason a timed mode is timed, and because that urgency has
// to survive `prefers-reduced-motion` as colour and words when the motion
// itself is taken away.

import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridClock, URGENT_SECONDS, formatClock } from "./GridClock";

/** Swap in a matchMedia that answers a given reduced-motion verdict. */
function stubReducedMotion(matches: boolean) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => stubReducedMotion(false));

describe("formatClock", () => {
  it("pads the seconds and drops nothing", () => {
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(127)).toBe("2:07");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
  });

  it("never renders a negative clock", () => {
    // The server clamps at zero; a display copy that briefly overshot must
    // not print "-0:01" in the corner of the board.
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("GridClock", () => {
  it("shows the remaining time as a timer, not a live region", () => {
    render(<GridClock seconds={127} roundSeconds={180} />);

    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("2:07");
    // A number that changes every second must not interrupt a screen reader
    // every second, so it is named rather than announced.
    expect(timer).toHaveAttribute("aria-label", "127 seconds remaining");
    expect(timer).not.toHaveAttribute("aria-live");
  });

  it("turns urgent for the last thirty seconds", () => {
    render(<GridClock seconds={URGENT_SECONDS} roundSeconds={180} />);

    expect(screen.getByRole("timer").className).toContain("text-loss");
  });

  it("stays calm above the threshold", () => {
    render(<GridClock seconds={URGENT_SECONDS + 1} roundSeconds={180} />);

    expect(screen.getByRole("timer").className).not.toContain("text-loss");
  });

  it("keeps the urgent colour but drops the pulse under reduced motion", () => {
    stubReducedMotion(true);
    const { container } = render(<GridClock seconds={5} roundSeconds={180} />);

    // The colour still carries the warning...
    expect(screen.getByRole("timer").className).toContain("text-loss");
    // ...but nothing on the page is animating.
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("animates the last seconds when motion is welcome", () => {
    stubReducedMotion(false);
    const { container } = render(<GridClock seconds={5} roundSeconds={180} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("a finished board reads as spent time rather than a warning", () => {
    render(<GridClock seconds={0} roundSeconds={180} finished />);

    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByRole("timer").className).not.toContain("text-loss");
  });
});
