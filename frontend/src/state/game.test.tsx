// Flow tests for the game store (src/state/GameContext.tsx) plus a couple of
// unit tests for the pure reducer underneath it (src/state/gameReducer.ts).
//
// The store is driven against the in-memory mock adapter with zero latency,
// which enforces the same rules as the backend (docs/API.md, "Rules enforced
// by the server"). That makes "create → spin → pick" a real integration test
// of the contract without a network or a running FastAPI process.

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMockApi } from "../api/mock";
import type { Api } from "../api/client";
import { GameProvider, useGame } from "./GameContext";
import { gameReducer, initialGameUiState } from "./gameReducer";

/** Render `useGame()` wired to a fresh, instantaneous mock server. */
function setup(api: Api = createMockApi({ latencyMs: 0 })) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GameProvider api={api}>{children}</GameProvider>
  );
  return renderHook(() => useGame(), { wrapper });
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
    expect(result.current.game?.current_spin?.category).toBe("picture");

    // The provider fetches the pool for the new spin on its own.
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0));

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

  it("decrements the skip counters and keeps the game playable", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    await act(async () => {
      await result.current.spin();
    });
    expect(result.current.game?.skips_remaining).toEqual({ year: 1, category: 1 });

    const firstCategory = result.current.game?.current_spin?.category;

    // A year skip spends the year allowance only.
    await act(async () => {
      await result.current.skip("year");
    });
    expect(result.current.game?.skips_remaining).toEqual({ year: 0, category: 1 });
    expect(result.current.game?.status).toBe("picking");
    expect(result.current.game?.current_spin?.category).toBe(firstCategory);

    // A category skip defers the category to the end of the ballot.
    await act(async () => {
      await result.current.skip("category");
    });
    expect(result.current.game?.skips_remaining).toEqual({ year: 0, category: 0 });
    expect(result.current.game?.current_spin?.category).not.toBe(firstCategory);
    expect(result.current.game?.category_order.at(-1)).toBe(firstCategory);
  });

  it("surfaces the server's `detail` string when a rule is broken", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createGame("classic");
    });
    // Skipping before the first spin is a 409 in both adapters.
    await act(async () => {
      await result.current.skip("year");
    });

    expect(result.current.error).toBe("Skips are only valid while picking.");
    expect(result.current.game?.skips_remaining.year).toBe(1);
  });
});

describe("gameReducer", () => {
  it("drops the pool and the highlight when a new spin arrives", () => {
    const base = gameReducer(initialGameUiState, {
      type: "game",
      game: {
        id: "g1",
        mode: "classic",
        seed: null,
        status: "picking",
        round: 1,
        category_order: ["picture", "director", "actor", "actress", "supporting_actor", "supporting_actress"],
        current_spin: { year: 1994, category: "picture", decade: "1990s" },
        skips_remaining: { year: 1, category: 1 },
        picks: [],
        created_at: "2026-09-06T00:00:00Z",
      },
    });
    const withSelection = gameReducer(
      { ...base, candidates: [], selectedId: "picture:tt0111161" },
      { type: "select", id: "picture:tt0111161" },
    );

    const afterSpin = gameReducer(withSelection, {
      type: "game",
      fromSpin: true,
      game: {
        ...withSelection.game!,
        current_spin: { year: 1975, category: "picture", decade: "1970s" },
      },
    });

    expect(afterSpin.selectedId).toBeNull();
    expect(afterSpin.candidates).toEqual([]);
    expect(afterSpin.spinSerial).toBe(withSelection.spinSerial + 1);
  });

  it("falls back to a title sort in cinephile mode, where metrics are null", () => {
    const next = gameReducer(
      { ...initialGameUiState, sort: "prestige" },
      {
        type: "game",
        game: {
          id: "g2",
          mode: "cinephile",
          seed: null,
          status: "spinning",
          round: 1,
          category_order: ["picture", "director", "actor", "actress", "supporting_actor", "supporting_actress"],
          current_spin: null,
          skips_remaining: { year: 1, category: 1 },
          picks: [],
          created_at: "2026-09-06T00:00:00Z",
        },
      },
    );

    expect(next.sort).toBe("title");
  });
});
