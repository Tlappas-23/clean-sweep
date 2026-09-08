// Contract tests for the mock adapter (src/api/mock.ts + src/api/mockCatalog.ts).
//
// The mock is what the UI runs against in `VITE_API_MOCK=true` mode and in
// every component test, so a mock that disagrees with the backend produces
// tests that pass against a contract nobody serves. These pin the three facts
// that changed most recently and are easiest to let drift back:
//
//   1. prestige is not scored: it is absent from `metric_breakdown` and from
//      `/api/meta`'s metric list, while still arriving on the card;
//   2. box office comes in two columns, an estimate never overwriting a
//      measurement, and the estimate never entering the scored metric;
//   3. the validation report is served, and 404s where the offline harness
//      has never run;
//   4. the ceremony metric is a 0-100 range rather than three fixed values,
//      and film standing is capped so it can never beat a nomination.

import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";
import { FIXTURE_YEARS, buildYear } from "./mockCatalog";
import { ApiError } from "./client";
import { BALLOT_SLOTS, SCORED_METRICS } from "../lib/labels";
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
  it("lists the five scored metrics on /api/meta, without prestige", async () => {
    const meta = await api.getMeta();

    expect(meta.metrics.map((m) => m.id)).toEqual([
      "ceremony",
      "box_office",
      "critics",
      "audience",
      "popularity",
    ]);
  });

  it("leaves prestige out of every metric breakdown", async () => {
    const results = await playThrough();

    for (const pick of results.picks) {
      expect(Object.keys(pick.metric_breakdown).sort()).toEqual([
        "audience",
        "box_office",
        "ceremony",
        "critics",
        "popularity",
      ]);
      // Still on the contender, though: the reveal shows it as an estimate.
      expect(pick.pick.contender.metrics).toHaveProperty("prestige");
    }
  });

  it("weights the five the way the backend does", async () => {
    const meta = await api.getMeta();
    // Read off backend/app/engine/scoring.py. The mock is what the published
    // demo runs on, so a ballot scored here has to be the ballot the real
    // game would score.
    expect(Object.fromEntries(SCORED_METRICS.map((m) => [m.id, m.weight]))).toEqual({
      ceremony: 0.6,
      box_office: 0.12,
      critics: 0.1,
      audience: 0.1,
      popularity: 0.08,
    });
    expect(SCORED_METRICS.reduce((sum, m) => sum + m.weight, 0)).toBeCloseTo(1, 10);
    // And /api/meta advertises exactly that set, in that order.
    expect(meta.metrics.map((m) => m.id)).toEqual(SCORED_METRICS.map((m) => m.id));
  });
});

describe("mock catalog: the ceremony metric", () => {
  const entries = FIXTURE_YEARS.flatMap(buildYear);

  it("still pays 100 for a win and at least 60 for a nomination", () => {
    for (const e of entries) {
      if (e.academy === 100) expect(e.ceremony).toBe(100);
      if (e.academy === 60) expect(e.ceremony).toBeGreaterThanOrEqual(60);
    }
  });

  it("never lets film standing overtake a real nomination", () => {
    // The cap is the whole reason the rule is safe: an un-nominated pick can
    // be lifted off zero, but not past somebody the Academy actually named.
    for (const e of entries) {
      if (e.academy === 0) expect(e.ceremony).toBeLessThan(60);
    }
  });

  it("lifts an un-nominated pick whose film the Academy honoured elsewhere", () => {
    // Johnny Depp was not nominated for Ed Wood, but the film won Supporting
    // Actor that year. Under the old all-or-nothing metric he scored a flat
    // zero on 60% of the pick score.
    const depp = entries.find((e) => e.contender.person_name === "Johnny Depp");

    expect(depp?.academy).toBe(0);
    expect(depp?.ceremony).toBeGreaterThan(0);
  });

  it("still scores zero for a film with no Academy record at all", () => {
    // A zero has to remain reachable, or the metric would be saying the
    // Academy noticed every film ever made.
    expect(entries.some((e) => e.ceremony === 0)).toBe(true);
  });
});

describe("mock catalog: the critics metric", () => {
  const entries = FIXTURE_YEARS.flatMap(buildYear);

  it("is null exactly where neither critics' column was backfilled", () => {
    for (const { contender: c } of entries) {
      const hasFigure = c.stats.rt_critic !== null || c.stats.metascore !== null;
      expect(c.metrics.critics !== null).toBe(hasFigure);
    }
  });

  it("leaves most of the fixture without one, as the real catalog does", () => {
    // The columns are backfilled against a daily API quota, so a card that
    // only looks right with a critics score is a card designed against a
    // catalog nobody has.
    const scored = entries.filter((e) => e.contender.metrics.critics !== null);

    expect(scored.length).toBeGreaterThan(0);
    expect(scored.length).toBeLessThan(entries.length / 2);
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
