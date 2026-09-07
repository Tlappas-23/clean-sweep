// Contract tests for the Recast half of the mock adapter (src/api/mock.ts).
//
// The mock is what the UI runs against in `VITE_API_MOCK=true` mode and in
// every Recast component test, so a mock that disagrees with the backend
// produces tests that pass against a contract nobody serves. These pin the
// rules the engine enforces (backend/app/engine/recast.py, and the "Rules the
// server enforces" list under "Recast" in docs/API.md):
//
//   * a shortlist never offers the original actor or anyone already cast;
//   * shortlists are stable — the same round reloaded shows the same names;
//   * `cast` takes nobody else, with the server's own words;
//   * `shortlist` and `cast` are 409 once every role is filled, and `results`
//     is 409 until then;
//   * `best_available` is the best on the shortlist the player was *shown*,
//     not the best in the catalog;
//   * the mode 503s where its seed tables were never built.
//
// The fixture film is Heat (1995) with four roles, and its two leads share a
// casting type deliberately, so the "already cast" exclusion is reachable
// after a single pick rather than only against a real database.

import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";
import { ApiError } from "./client";
import type { ActorCard, RecastResults } from "./types";

const api = createMockApi({ latencyMs: 0 });

/** Every fit component, in the order the reveal draws them. */
const COMPONENTS = ["stature", "role_fit", "genre", "era"] as const;

/**
 * Cast every role, taking `choose` from each shortlist.
 *
 * Returns the results alongside the shortlists as they were actually offered,
 * which is what lets a test check that "best available" came from the list
 * the player saw rather than from the catalog.
 */
async function playThrough(
  choose: (shortlist: ActorCard[], role: number) => ActorCard = (s) => s[0],
): Promise<{ results: RecastResults; shortlists: ActorCard[][] }> {
  const game = await api.createRecastGame();
  const shortlists: ActorCard[][] = [];
  for (let role = 0; role < game.roles.length; role++) {
    const shortlist = await api.getRecastShortlist(game.id);
    shortlists.push(shortlist);
    await api.castRecast(game.id, choose(shortlist, role).person_id);
  }
  return { results: await api.getRecastResults(game.id), shortlists };
}

describe("mock adapter: the Recast round", () => {
  it("deals a film with roles in billing order and nothing cast yet", async () => {
    const game = await api.createRecastGame();

    expect(game.status).toBe("casting");
    expect(game.current_role).toBe(0);
    expect(game.picks).toEqual([]);
    // Three to five roles is the engine's range (MIN_ROLES / MAX_ROLES).
    expect(game.roles.length).toBeGreaterThanOrEqual(3);
    expect(game.roles.length).toBeLessThanOrEqual(5);
    const billings = game.roles.map((r) => r.billing);
    expect([...billings].sort((a, b) => a - b)).toEqual(billings);
    // `is_lead` is the server's judgement and matches the engine's threshold.
    for (const role of game.roles) expect(role.is_lead).toBe(role.billing <= 2);
  });

  it("never offers the original actor, or anyone already cast", async () => {
    const game = await api.createRecastGame();
    const used: string[] = [];

    for (let role = 0; role < game.roles.length; role++) {
      const shortlist = await api.getRecastShortlist(game.id);
      const offered = shortlist.map((a) => a.person_id);

      expect(offered).not.toContain(game.roles[role].original.person_id);
      for (const id of used) expect(offered).not.toContain(id);
      // Everyone offered does the same kind of work as the original — that
      // constraint is the mode (docs/GAME_DESIGN.md §8).
      for (const actor of shortlist) {
        expect(actor.casting_type).toBe(game.roles[role].original.casting_type);
      }

      used.push(shortlist[0].person_id);
      await api.castRecast(game.id, shortlist[0].person_id);
    }
  });

  it("shows the same names when the round is reloaded", async () => {
    const game = await api.createRecastGame();

    const first = await api.getRecastShortlist(game.id);
    await api.getRecastGame(game.id);
    const second = await api.getRecastShortlist(game.id);

    expect(second.map((a) => a.person_id)).toEqual(first.map((a) => a.person_id));
  });

  it("refuses anyone who is not on the current role's shortlist", async () => {
    const game = await api.createRecastGame();

    // The original of the part is the clearest case: a real person, in the
    // right casting type, and still not on offer for their own role.
    await expect(api.castRecast(game.id, game.roles[0].original.person_id)).rejects.toThrow(
      "that actor is not on this role's shortlist",
    );
    // And it is a 400, not a 500 — a refusal the UI is meant to render.
    await api.castRecast(game.id, game.roles[0].original.person_id).catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
    });
    // Nothing was cast, so the round has not moved.
    expect((await api.getRecastGame(game.id)).current_role).toBe(0);
  });

  it("closes the shortlist and opens the results only when every role is cast", async () => {
    const game = await api.createRecastGame();

    await expect(api.getRecastResults(game.id)).rejects.toThrow("there are still roles to cast");

    for (let role = 0; role < game.roles.length; role++) {
      const shortlist = await api.getRecastShortlist(game.id);
      await api.castRecast(game.id, shortlist[0].person_id);
    }

    const done = await api.getRecastGame(game.id);
    expect(done.status).toBe("complete");
    expect(done.current_role).toBe(done.roles.length);
    expect(done.picks).toHaveLength(done.roles.length);

    await expect(api.getRecastShortlist(game.id)).rejects.toThrow("every role is cast");
    await expect(api.castRecast(game.id, "nm0000158")).rejects.toThrow("every role is cast");
  });
});

describe("mock adapter: what a finished recast scores", () => {
  it("scores each role on four components and means them into the round", async () => {
    const { results } = await playThrough();

    expect(results.castings).toHaveLength(results.game.roles.length);
    for (const casting of results.castings) {
      for (const key of COMPONENTS) {
        expect(casting.breakdown[key]).toBeGreaterThanOrEqual(0);
        expect(casting.breakdown[key]).toBeLessThanOrEqual(100);
      }
      // The fit is the weighted blend of exactly those four and nothing else.
      const blended =
        0.35 * casting.breakdown.stature +
        0.3 * casting.breakdown.role_fit +
        0.2 * casting.breakdown.genre +
        0.15 * casting.breakdown.era;
      expect(casting.fit).toBeCloseTo(blended, 1);
    }

    const mean =
      results.castings.reduce((sum, c) => sum + c.fit, 0) / results.castings.length;
    expect(results.score).toBeCloseTo(mean, 1);
  });

  it("names the strongest and weakest calls by billing, not by index", async () => {
    const { results } = await playThrough();

    const fits = new Map(results.castings.map((c) => [c.billing, c.fit]));
    expect(fits.get(results.strongest!)).toBe(Math.max(...fits.values()));
    expect(fits.get(results.weakest!)).toBe(Math.min(...fits.values()));
  });

  it("compares against the best on the shortlist the player was shown", async () => {
    // Take the *last* name on every shortlist, so the player's choice is
    // unlikely to be the best one and the comparison has something to say.
    const { results, shortlists } = await playThrough((s) => s[s.length - 1]);

    results.castings.forEach((casting, index) => {
      const offered = shortlists[index].map((a) => a.person_id);
      expect(casting.best_available).not.toBeNull();
      // The crucial part: it came off that role's own shortlist.
      expect(offered).toContain(casting.best_available!.person_id);
      // And it really is the best of them, so it can never trail the pick.
      expect(casting.best_fit!).toBeGreaterThanOrEqual(casting.fit);
    });
  });
});

describe("mock adapter: a checkout with no side-mode tables", () => {
  it("503s every Recast route with the commands to run", async () => {
    const unbuilt = createMockApi({ latencyMs: 0, recastSeeded: false });

    await expect(unbuilt.createRecastGame()).rejects.toThrow(/python -m ml\.actors/);
    await unbuilt.createRecastGame().catch((err: unknown) => {
      expect((err as ApiError).status).toBe(503);
    });
    // Every route, not just the first: the backend's guard is a dependency on
    // all of them, so a client cannot get past it by reloading a round.
    await expect(unbuilt.getRecastGame("anything")).rejects.toThrow(/side modes/);
    await expect(unbuilt.getRecastShortlist("anything")).rejects.toThrow(/side modes/);
    await expect(unbuilt.castRecast("anything", "nm0000158")).rejects.toThrow(/side modes/);
    await expect(unbuilt.getRecastResults("anything")).rejects.toThrow(/side modes/);
  });
});
