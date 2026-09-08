// Flow tests for the game store (src/state/GameContext.tsx) plus a couple of
// unit tests for the pure reducer underneath it (src/state/gameReducer.ts).
//
// The store is driven against the in-memory mock adapter with zero latency,
// which enforces the same rules as the backend (docs/API.md, "Rules enforced
// by the server"). That makes "create → spin → pick" a real integration test
// of the contract without a network or a running FastAPI process, including
// the two rules the round loop turns on: a pick may come from any of the three
// dealt years, and the reroll trades all of them for one that must be used.

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMockApi } from "../api/mock";
import type { Api } from "../api/client";
import type { GameState, Spin } from "../api/types";
import { GameProvider, useGame } from "./GameContext";
import { gameReducer, initialGameUiState } from "./gameReducer";

/** Render `useGame()` wired to a fresh, instantaneous mock server. */
function setup(api: Api = createMockApi({ latencyMs: 0 })) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GameProvider api={api}>{children}</GameProvider>
  );
  return renderHook(() => useGame(), { wrapper });
}

/** A spin with `years` on the board, for the reducer's board-change tests. */
function spinOf(years: number[], overrides: Partial<Spin> = {}): Spin {
  return {
    category: "picture",
    year_options: years.map((year) => ({ year, decade: `${Math.floor(year / 10) * 10}s` })),
    locked: false,
    reroll_available: true,
    ...overrides,
  };
}

/** A minimal GameState for reducer tests; the store never builds these itself. */
function gameOf(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "g1",
    mode: "classic",
    seed: null,
    status: "picking",
    round: 1,
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
    current_spin: spinOf([1994, 1975, 2008]),
    skips_remaining: { category: 1 },
    picks: [],
    created_at: "2026-09-06T00:00:00Z",
    ...overrides,
  };
}

describe("game store against the mock adapter", () => {
  it("walks create → spin → pick and advances the round", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    expect(result.current.game?.status).toBe("spinning");
    expect(result.current.game?.round).toBe(1);
    expect(result.current.game?.current_spin).toBeNull();

    await act(async () => {
      await result.current.spin();
    });
    expect(result.current.game?.status).toBe("picking");
    const spin = result.current.game!.current_spin!;
    expect(spin.category).toBe("picture");
    // Three distinct years on the board, and the reroll still in hand.
    expect(spin.year_options).toHaveLength(3);
    expect(new Set(spin.year_options.map((o) => o.year)).size).toBe(3);
    expect(spin.locked).toBe(false);
    expect(spin.reroll_available).toBe(true);
    // Nothing is narrowed yet: the grid opens on every year at once.
    expect(result.current.viewYear).toBeNull();

    // The provider fetches the pool for the new board on its own, and with no
    // year selected that pool spans all three years.
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0));
    const yearsInPool = new Set(result.current.candidates.map((c) => c.year));
    expect(yearsInPool.size).toBeGreaterThan(1);

    const choice = result.current.candidates[0];
    await act(async () => {
      await result.current.pick(choice.contender_id);
    });

    expect(result.current.game?.picks).toHaveLength(1);
    expect(result.current.game?.picks[0].contender.contender_id).toBe(choice.contender_id);
    // Picking closes the round: back to "spinning" for round 2.
    expect(result.current.game?.round).toBe(2);
    expect(result.current.game?.status).toBe("spinning");
  });

  it("drafts from the third dealt year, not just the first", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    await act(async () => {
      await result.current.spin();
    });

    const options = result.current.game!.current_spin!.year_options;
    const third = options[2].year;

    // Selecting a year re-scopes the pool through `?year=`.
    await act(async () => {
      result.current.setViewYear(third);
    });
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0));
    expect(result.current.candidates.every((c) => c.year === third)).toBe(true);

    const choice = result.current.candidates[0];
    await act(async () => {
      await result.current.pick(choice.contender_id);
    });

    // The pick records the year it actually came from, which is the third one.
    expect(result.current.game?.picks[0].year).toBe(third);
    expect(result.current.game?.picks[0].contender.year).toBe(third);
  });

  it("rejects a year that is not on the board", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const { result } = setup(api);

    await act(async () => {
      await result.current.createGame("classic");
    });
    await act(async () => {
      await result.current.spin();
    });

    const gameId = result.current.game!.id;
    const onBoard = result.current.game!.current_spin!.year_options.map((o) => o.year);
    expect(onBoard).not.toContain(1900);

    await expect(api.getCandidates(gameId, { year: 1900 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("locks the round to one year when the reroll is spent, then refuses a second", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const { result } = setup(api);

    await act(async () => {
      await result.current.createGame("classic");
    });
    await act(async () => {
      await result.current.spin();
    });
    const before = result.current.game!.current_spin!.year_options.map((o) => o.year);

    await act(async () => {
      await result.current.reroll();
    });

    const after = result.current.game!.current_spin!;
    // One year, it is a new one, and there is no way back.
    expect(after.year_options).toHaveLength(1);
    expect(before).not.toContain(after.year_options[0].year);
    expect(after.locked).toBe(true);
    expect(after.reroll_available).toBe(false);
    // A single-year board selects itself rather than offering "all years".
    expect(result.current.viewYear).toBe(after.year_options[0].year);
    // The round and category are untouched: this is not a skip.
    expect(result.current.game?.round).toBe(1);
    expect(after.category).toBe("picture");

    // Spending it twice is a 409. Asserted straight against the adapter: the
    // store clears `error` as soon as the next request starts, and selecting a
    // year has already queued a candidate refresh behind this call.
    await expect(api.reroll(result.current.game!.id)).rejects.toMatchObject({
      status: 409,
      detail: "This round's reroll has already been spent.",
    });
    expect(result.current.game?.current_spin?.year_options).toHaveLength(1);
  });

  it("decrements the category skip and keeps the round's reroll", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    await act(async () => {
      await result.current.spin();
    });
    expect(result.current.game?.skips_remaining).toEqual({ category: 1 });

    const firstCategory = result.current.game?.current_spin?.category;

    // A category skip defers the category to the end of the ballot and deals a
    // fresh set of years for the next one.
    await act(async () => {
      await result.current.skip("category");
    });
    expect(result.current.game?.skips_remaining).toEqual({ category: 0 });
    expect(result.current.game?.current_spin?.category).not.toBe(firstCategory);
    expect(result.current.game?.category_order.at(-1)).toBe(firstCategory);
    expect(result.current.game?.current_spin?.year_options).toHaveLength(3);
    // The skip changes what you are drafting, not how many chances you get.
    expect(result.current.game?.current_spin?.reroll_available).toBe(true);
  });

  it("plays a genre round, which deals horror like any other category", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });

    // Rounds 1-6 are the Academy slots; round 7 is Best Horror.
    for (let round = 1; round <= 7; round++) {
      await act(async () => {
        await result.current.spin();
      });
      expect(result.current.game?.current_spin?.category).toBe(
        result.current.game?.category_order[round - 1],
      );
      if (round === 7) break;
      await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0));
      const choice = result.current.candidates[0];
      await act(async () => {
        await result.current.pick(choice.contender_id);
      });
    }

    expect(result.current.game?.round).toBe(7);
    expect(result.current.game?.current_spin?.category).toBe("horror");
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0));
    // Horror is a film slot: no person, and every card is genuinely horror.
    expect(result.current.candidates.every((c) => c.person_name === null)).toBe(true);
    expect(result.current.candidates.every((c) => c.category === "horror")).toBe(true);
  });

  it("surfaces the server's `detail` string when a rule is broken", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    // Skipping before the first spin is a 409 in both adapters.
    await act(async () => {
      await result.current.skip("category");
    });

    expect(result.current.error).toBe("Skips are only valid while picking.");
    expect(result.current.game?.skips_remaining.category).toBe(1);
  });
});

describe("gameReducer", () => {
  it("drops the pool and the highlight when a new board arrives", () => {
    const base = gameReducer(initialGameUiState, { type: "game", game: gameOf() });
    const withSelection = gameReducer(
      { ...base, candidates: [], selectedId: "picture:tt0111161" },
      { type: "select", id: "picture:tt0111161" },
    );

    const afterSpin = gameReducer(withSelection, {
      type: "game",
      fromSpin: true,
      game: { ...withSelection.game!, current_spin: spinOf([1939, 1960, 1986]) },
    });

    expect(afterSpin.selectedId).toBeNull();
    expect(afterSpin.candidates).toEqual([]);
    expect(afterSpin.spinSerial).toBe(withSelection.spinSerial + 1);
  });

  it("treats a reroll as a new board even though the category is unchanged", () => {
    const base = gameReducer(initialGameUiState, { type: "game", game: gameOf() });
    const viewing = gameReducer(base, { type: "viewYear", year: 1994 });
    expect(viewing.viewYear).toBe(1994);

    // Same round, same category, one year left and locked.
    const afterReroll = gameReducer(viewing, {
      type: "game",
      fromSpin: true,
      game: {
        ...viewing.game!,
        current_spin: spinOf([1975], { locked: true, reroll_available: false }),
      },
    });

    // The single remaining year is selected for the player: there is nothing
    // to choose between, and "all years" would be a lie.
    expect(afterReroll.viewYear).toBe(1975);
    expect(afterReroll.candidates).toEqual([]);
    expect(afterReroll.spinSerial).toBe(viewing.spinSerial + 1);
  });

  it("clears the highlight when the viewed year changes under the grid", () => {
    const base = gameReducer(initialGameUiState, { type: "game", game: gameOf() });
    const selected = gameReducer(base, { type: "select", id: "picture:tt0111161" });

    const switched = gameReducer(selected, { type: "viewYear", year: 2008 });

    expect(switched.viewYear).toBe(2008);
    expect(switched.selectedId).toBeNull();
  });

  it("falls back to a title sort in cinephile mode, where metrics are null", () => {
    const next = gameReducer(
      { ...initialGameUiState, sort: "prestige" },
      {
        type: "game",
        game: gameOf({ id: "g2", mode: "cinephile", status: "spinning", current_spin: null }),
      },
    );

    expect(next.sort).toBe("title");
  });
});
