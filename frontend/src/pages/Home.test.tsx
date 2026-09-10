// Tests for the home screen (src/pages/Home.tsx).
//
// Home is the Six Degrees board now, not a menu of games, and the tests are
// about the one decision that shaped it: nothing is fetched until Start.
//
// A Six Degrees round carries a three-minute clock that begins the moment the
// board is created. Dealing one on arrival would run it against somebody who
// is still reading the rules, and by the time they pressed Start the round
// could already be over. So the board on this screen is a placeholder, and
// the assertions below are as much about what does *not* happen as what does.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { HomePage } from "./Home";
import * as apiModule from "../api";
import { forget, remember } from "../lib/activeRound";
import { todaySeed } from "../lib/format";

/** Renders home, and reports wherever it navigates to. */
function setup() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

function Destination() {
  const location = useLocation();
  return <p data-testid="destination">{location.pathname}</p>;
}

describe("HomePage", () => {
  it("shows the board before anything is played", () => {
    setup();

    expect(
      screen.getByRole("heading", { name: "Name the actor who connects them" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("deals no board until Start is pressed", async () => {
    // The assertion the whole design rests on. A round created on arrival is
    // a clock running against somebody reading the rules.
    const create = vi.spyOn(apiModule.api, "createGridGame");
    setup();

    // Give any stray effect a chance to fire before concluding it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(create).not.toHaveBeenCalled();

    create.mockRestore();
  });

  it("deals a board on Start and goes to it", async () => {
    const create = vi
      .spyOn(apiModule.api, "createGridGame")
      .mockResolvedValue({ id: "board-1" } as never);
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByTestId("destination")).toHaveTextContent("/grid/board-1"),
    );
    // Undated: a fresh board, not the shared daily.
    expect(create).toHaveBeenCalledWith(undefined);
    create.mockRestore();
  });

  it("seeds the daily board with today's local date", async () => {
    // Local, not UTC: a player in Sydney and one in Los Angeles should each
    // get the board for the date on their own calendar.
    const create = vi
      .spyOn(apiModule.api, "createGridGame")
      .mockResolvedValue({ id: "daily-1" } as never);
    setup();

    // Matched on "daily board" alone: the copy uses a typographic
    // apostrophe, and pinning the exact character makes the test fail on a
    // punctuation change that no player would notice.
    fireEvent.click(screen.getByRole("button", { name: /daily board/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    expect(create).toHaveBeenCalledWith(expected);
    create.mockRestore();
  });

  it("deals only one board however many times Start is pressed", async () => {
    // Two boards would abandon one, and its clock would run out unwatched.
    const create = vi.spyOn(apiModule.api, "createGridGame").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: "once" } as never), 60)),
    );
    setup();

    const start = screen.getByRole("button", { name: "Start" });
    fireEvent.click(start);
    fireEvent.click(start);
    fireEvent.click(start);

    await waitFor(() => expect(screen.getByTestId("destination")).toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });

  it("says so when the board cannot be dealt, and lets you try again", async () => {
    const create = vi
      .spyOn(apiModule.api, "createGridGame")
      .mockRejectedValueOnce(new Error("the cast graph is too sparse"))
      .mockResolvedValueOnce({ id: "second-try" } as never);
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/too sparse/)).toBeInTheDocument();

    // A failed deal must not latch the button shut.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByTestId("destination")).toHaveTextContent("/grid/second-try"),
    );
    create.mockRestore();
  });

  it("points at the other games without listing them as equals", () => {
    // Home has one job. The other two modes are a menu away, and the link
    // says where, so the page is not a dead end for someone who wants them.
    setup();
    expect(screen.getByRole("link", { name: "Game modes" })).toHaveAttribute("href", "/modes");
  });

  /* ---- the two rules the front door enforces ------------------------- */

  it("resumes a live round instead of dealing a new one", async () => {
    // The exploit this closes: pressing Home during a round used to offer
    // Start, and Start dealt a fresh board with a fresh three minutes. The
    // clock is running on the board you already have.
    forget();
    remember({ id: "in-play", seed: null, secondsRemaining: 120, finished: false });
    const create = vi.spyOn(apiModule.api, "createGridGame");

    setup();

    expect(screen.getByRole("link", { name: /Resume your board/i })).toHaveAttribute(
      "href",
      "/grid/in-play",
    );
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: /daily board/i })).toBeNull();

    await new Promise((r) => setTimeout(r, 30));
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    forget();
  });

  it("offers a fresh board again once the round is over", () => {
    // A finished round must not lock the door: the rule is about a clock that
    // is still running, not about having played at all.
    forget();
    remember({ id: "done", seed: null, secondsRemaining: 0, finished: true });

    setup();

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Resume/i })).toBeNull();
    forget();
  });

  it("spends today's daily after one attempt, and says so", () => {
    // It is the same board for everybody, so a second go is a different game
    // from the one everyone else played. Random boards stay unlimited.
    forget();
    remember({ id: "daily", seed: todaySeed(), secondsRemaining: 0, finished: true });

    setup();

    expect(screen.queryByRole("button", { name: /daily board/i })).toBeNull();
    expect(screen.getByText(/played today/i)).toBeInTheDocument();
    // Told, not silently hidden, and a random board is still one press away.
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    forget();
  });

  it("does not spend today's daily because a random board was played", () => {
    forget();
    remember({ id: "random", seed: null, secondsRemaining: 0, finished: true });

    setup();

    expect(screen.getByRole("button", { name: /daily board/i })).toBeInTheDocument();
    forget();
  });
});
