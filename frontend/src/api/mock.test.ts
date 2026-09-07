// Contract tests for the mock adapter (src/api/mock.ts + src/api/mockCatalog.ts).
//
// The mock is what the UI runs against in `VITE_API_MOCK=true` mode and in
// every component test, so a mock that disagrees with the backend produces
// tests that pass against a contract nobody serves. These pin the three facts
// that changed most recently and are easiest to let drift back:
//
//   1. prestige is not scored — it is absent from `metric_breakdown` and from
//      `/api/meta`'s metric list, while still arriving on the card;
//   2. box office comes in two columns, an estimate never overwriting a
//      measurement, and the estimate never entering the scored metric;
//   3. the validation report is served, and 404s where the offline harness
//      has never run.

import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";
import { FIXTURE_YEARS, buildYear } from "./mockCatalog";
import { ApiError } from "./client";
import { BALLOT_SLOTS } from "../lib/labels";
import type { GameResults } from "./types";

const api = createMockApi({ latencyMs: 0 });

/** Draft a full eight-slot ballot, taking the first candidate every round. */
async function playThrough(): Promise<GameResults> {
  const game = await api.createGame({ mode: "classic" });
  for (let round = 0; round < BALLOT_SLOTS; round++) {
    await api.spin(game.id);
    const candidates = await api.getCandidates(game.id);
    await api.pick(game.id, candidates[0].contender_id);
  }
  return api.getResults(game.id);
}

describe("mock adapter: the scored metrics", () => {
  it("lists the four scored metrics on /api/meta, without prestige", async () => {
    const meta = await api.getMeta();

    expect(meta.metrics.map((m) => m.id)).toEqual([
      "academy",
      "acclaim",
      "box_office",
      "popularity",
    ]);
  });

  it("leaves prestige out of every metric breakdown", async () => {
    const results = await playThrough();

    for (const pick of results.picks) {
      expect(Object.keys(pick.metric_breakdown).sort()).toEqual([
        "academy",
        "acclaim",
        "box_office",
        "popularity",
      ]);
      // Still on the contender, though: the reveal shows it as an estimate.
      expect(pick.pick.contender.metrics).toHaveProperty("prestige");
    }
  });
});

describe("mock catalog: measured versus estimated box office", () => {
  const films = FIXTURE_YEARS.flatMap((fixture) =>
    buildYear(fixture).map((entry) => entry.contender),
  );

  it("never carries a measurement and an estimate at once", () => {
    for (const c of films) {
      expect(c.stats.box_office_usd === null || c.stats.box_office_est_usd === null).toBe(true);
    }
  });

  it("estimates some of the films with no measured revenue", () => {
    const estimated = films.filter((c) => c.stats.box_office_est_usd !== null);

    expect(estimated.length).toBeGreaterThan(0);
    // The point of the fixture: an estimate exists *and* the scored metric is
    // still blank, which is the combination the card has to explain.
    for (const c of estimated) {
      expect(c.stats.box_office_usd).toBeNull();
      expect(c.metrics.box_office).toBeNull();
    }
  });

  it("keeps a few films with neither figure, so the em-dash case stays real", () => {
    const neither = films.filter(
      (c) => c.stats.box_office_usd === null && c.stats.box_office_est_usd === null,
    );

    expect(neither.length).toBeGreaterThan(0);
  });

  it("scores box office only where revenue was measured", () => {
    for (const c of films) {
      expect(c.metrics.box_office === null).toBe(c.stats.box_office_usd === null);
    }
  });
});

describe("mock adapter: the validation report", () => {
  it("serves a report whose numbers support its verdict", async () => {
    const report = await api.getValidation();

    expect(report.verdict).toBe("signal confirmed");
    expect(report.leakage_audit.clean).toBe(true);
    expect(report.permutation_test.p_value).toBeLessThan(0.05);
    // The point estimate has to sit inside its own interval, and the whole
    // interval clear of a coin flip.
    const [low, high] = report.held_out_auc.ci95;
    expect(report.held_out_auc.point).toBeGreaterThanOrEqual(low);
    expect(report.held_out_auc.point).toBeLessThanOrEqual(high);
    expect(low).toBeGreaterThan(0.5);
    // And it has to beat every baseline it is compared against.
    const others = Object.entries(report.baselines)
      .filter(([name]) => name !== "model")
      .map(([, stats]) => stats.roc_auc);
    expect(Math.max(...others)).toBeLessThan(report.baselines.model.roc_auc);
  });

  it("404s when the offline harness has never run", async () => {
    const untrained = createMockApi({ latencyMs: 0, analyticsTrained: false });

    await expect(untrained.getValidation()).rejects.toBeInstanceOf(ApiError);
  });
});
