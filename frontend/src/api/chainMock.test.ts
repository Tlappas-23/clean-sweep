// Contract tests for The Chain half of the mock adapter (src/api/mock.ts).
//
// The mock is what the UI runs against in `VITE_API_MOCK=true` mode and in
// every Chain component test, so a mock that disagrees with the backend
// produces tests that pass against a contract nobody serves.
//
// This mode needs the checking more than the other two, because its answers
// are *searched for* rather than looked up in a table. These pin the rules
// the engine enforces (backend/app/engine/chain.py, and the "Rules the server
// enforces" list under "The Chain" in docs/API.md):
//
//   * a dealt pair is exactly `TARGET_STEPS` apart, and genuinely reachable;
//   * a seed deals the same pair, and reveals the same shortest route, twice;
//   * a move needs a shared cast member, and says which one carried you;
//   * the two 400s are different mistakes and say different things;
//   * a film already visited is refused, so a route cannot be padded;
//   * results are 409 until the chain has ended;
//   * the leaderboard ranks arrived, then fewest films, then fastest.

import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";
import { ApiError } from "./client";
import type { ChainResults } from "./types";

/** Every board is built to this length. Matches `TARGET_STEPS` in the engine. */
const PAR = 3;

const api = createMockApi({ latencyMs: 0 });

/** Start a chain and take its answer key from a throwaway round on the same seed. */
async function dealt(seed: string): Promise<{ id: string; key: ChainResults }> {
  const game = await api.createChainGame(seed);
  const twin = await api.createChainGame(seed);
  return { id: game.id, key: await api.giveUpChain(twin.id) };
}

describe("mock adapter: dealing a chain", () => {
  it("deals two different films with nothing walked yet", async () => {
    const game = await api.createChainGame();

    expect(game.status).toBe("playing");
    expect(game.start.film_id).not.toBe(game.target.film_id);
    // You begin standing on the start film, not nowhere.
    expect(game.here.film_id).toBe(game.start.film_id);
    expect(game.route).toEqual([]);
    expect(game.steps).toBe(0);
    expect(game.max_seconds).toBeGreaterThan(0);
  });

  it("never leaks the answer into a chain that is still being played", async () => {
    const game = await api.createChainGame("no-leak");
    // The shape has nowhere to put a route, which is the structural reason
    // the answer cannot arrive early. Checked on the object as served.
    expect(game).not.toHaveProperty("shortest");
    expect(game).not.toHaveProperty("par");
  });

  it("deals a pair exactly three steps apart, over and over", async () => {
    // Twenty draws rather than one: rejection sampling that mostly worked
    // would still pass a single check, and "mostly" is the failure that
    // matters here.
    for (let i = 0; i < 20; i++) {
      const key = await api.giveUpChain((await api.createChainGame(`spread-${i}`)).id);
      expect(key.par).toBe(PAR);
      expect(key.shortest).toHaveLength(PAR);
      // The revealed route has to end where the board said it would.
      expect(key.shortest[PAR - 1].film.film_id).toBe(key.game.target.film_id);
    }
  });

  it("deals the same pair, and reveals the same route, for the same seed", async () => {
    const [left, right] = [await dealt("2026-09-08"), await dealt("2026-09-08")];
    expect(left.key.game.start.film_id).toBe(right.key.game.start.film_id);
    expect(left.key.game.target.film_id).toBe(right.key.game.target.film_id);
    // The route matters as much as the pair. A neighbour set iterates in
    // whatever order it likes, and a player reloading a finished daily to a
    // different "shortest route" would rightly call it a bug.
    expect(left.key.shortest.map((s) => s.film.film_id)).toEqual(
      right.key.shortest.map((s) => s.film.film_id),
    );
  });

  it("deals a different pair without a seed", async () => {
    const pairs = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const key = await api.giveUpChain((await api.createChainGame()).id);
      pairs.add(`${key.game.start.film_id}>${key.game.target.film_id}`);
    }
    expect(pairs.size).toBeGreaterThan(1);
  });
});

describe("mock adapter: walking a chain", () => {
  it("moves you, and names the actor who carried you", async () => {
    const { id, key } = await dealt("walk");
    const step = key.shortest[0];

    const after = await api.moveChain(id, { title: step.film.title });

    expect(after.here.film_id).toBe(step.film.film_id);
    expect(after.steps).toBe(1);
    expect(after.route).toHaveLength(1);
    // The film is the player's answer; the actor is why it counted.
    expect(after.route[0].actor.name).toBe(step.actor.name);
    expect(after.status).toBe("playing");
  });

  it("plays a whole chain through to the reveal", async () => {
    const { id, key } = await dealt("through");
    for (const step of key.shortest) await api.moveChain(id, { title: step.film.title });

    const results = await api.getChainResults(id);
    expect(results.solved).toBe(true);
    expect(results.ended).toBe("solved");
    expect(results.steps).toBe(results.par);
    expect(results.route.map((s) => s.film.film_id)).toEqual(
      key.shortest.map((s) => s.film.film_id),
    );
    expect(results.game.status).toBe("complete");
  });

  it("forgives the spelling of a title", async () => {
    const { id, key } = await dealt("spelling");
    const title = key.shortest[0].film.title;

    // Lower-cased and a letter short: the kind of thing that happens when
    // someone is typing against a stopwatch.
    const after = await api.moveChain(id, { title: title.toLowerCase().slice(0, -1) });
    expect(after.here.title).toBe(title);
  });

  it("tells a title it cannot find apart from a film that does not connect", async () => {
    const { id, key } = await dealt("refusals");

    // A title nothing matches: a typing problem.
    await expect(api.moveChain(id, { title: "Zzzz Nonesuch" })).rejects.toMatchObject({
      status: 400,
    });
    const unknown = await api.moveChain(id, { title: "Zzzz Nonesuch" }).catch((e: ApiError) => e);

    // A real film with nobody in common: the game saying the idea was wrong.
    // Found by searching rather than assumed, since the pair depends on the
    // seed. Almost nothing connects, so the first few candidates suffice.
    const candidates = await api.searchChainFilms(id, "the", 40);
    const wrong = candidates.find(
      (film) =>
        film.film_id !== key.game.start.film_id &&
        film.film_id !== key.shortest[0].film.film_id,
    );
    const refused = await api
      .moveChain(id, { title: (wrong as { title: string }).title })
      .catch((e: ApiError) => e);

    expect((refused as ApiError).status).toBe(400);
    // Collapsing the two into one message would take away the only feedback
    // the mode gives.
    expect((refused as ApiError).detail).not.toBe((unknown as ApiError).detail);
  });

  it("refuses a film you have already been to, so a route cannot be padded", async () => {
    const { id, key } = await dealt("no-backtrack");
    await api.moveChain(id, { title: key.shortest[0].film.title });
    await api.moveChain(id, { title: key.shortest[1].film.title });

    await expect(
      api.moveChain(id, { title: key.shortest[0].film.title }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a move once the chain is finished", async () => {
    const { id, key } = await dealt("finished");
    for (const step of key.shortest) await api.moveChain(id, { title: step.film.title });

    await expect(api.moveChain(id, { title: key.shortest[0].film.title })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("withholds the results until the chain has ended", async () => {
    const game = await api.createChainGame("still-going");
    await expect(api.getChainResults(game.id)).rejects.toMatchObject({ status: 409 });
  });

  it("reveals a shortest route to a player who stops early", async () => {
    const game = await api.createChainGame("stopped");
    const results = await api.giveUpChain(game.id);

    expect(results.solved).toBe(false);
    expect(results.ended).toBe("gave_up");
    expect(results.route).toEqual([]);
    // Stopping is what the reveal is for: the route arrives anyway.
    expect(results.shortest).toHaveLength(PAR);
  });

  it("404s a chain that does not exist", async () => {
    await expect(api.getChainGame("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("mock adapter: the chain leaderboard", () => {
  it("ranks arriving first, then fewest films, then fastest", async () => {
    // A fresh adapter, so the board holds only what this test put on it.
    const board = createMockApi({ latencyMs: 0 });

    const solvedKey = await board.giveUpChain((await board.createChainGame("rank")).id);
    const winner = await board.createChainGame("rank");
    for (const step of solvedKey.shortest) {
      await board.moveChain(winner.id, { title: step.film.title });
    }
    const quitter = await board.createChainGame("rank");
    await board.giveUpChain(quitter.id);

    const rows = await board.getChainLeaderboard();
    const keys = rows.map((r) => [r.solved ? 0 : 1, r.steps, r.seconds]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]));
    // Arriving outranks not arriving, whatever the step counts say.
    expect(rows[0].solved).toBe(true);
    expect(rows[0].id).toBe(winner.id);
    expect(rows[rows.length - 1].solved).toBe(false);
  });

  it("records a chain once, however many times its results are read", async () => {
    const board = createMockApi({ latencyMs: 0 });
    const game = await board.createChainGame("once");
    await board.giveUpChain(game.id);
    await board.getChainResults(game.id);
    await board.getChainResults(game.id);

    expect((await board.getChainLeaderboard()).filter((r) => r.id === game.id)).toHaveLength(1);
  });
});

describe("mock adapter: searching for a film", () => {
  it("matches a fragment of a title", async () => {
    const game = await api.createChainGame("search");
    const hits = await api.searchChainFilms(game.id, "toy");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.title.toLowerCase().includes("toy"))).toBe(true);
  });

  it("answers nothing rather than everything for a fragment that matches nothing", async () => {
    const game = await api.createChainGame("search-miss");
    expect(await api.searchChainFilms(game.id, "qqqq")).toEqual([]);
  });

  it("404s a search against a chain that does not exist", async () => {
    await expect(api.searchChainFilms("nope", "toy")).rejects.toMatchObject({ status: 404 });
  });
});
