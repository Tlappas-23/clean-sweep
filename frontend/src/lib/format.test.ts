// Tests for the pure formatting helpers (src/lib/format.ts).
//
// These cover the two things the UI would quietly get wrong: the en dash in a
// season record, and the "null renders as an em dash, never as zero" rule that
// keeps masked cinephile metrics from looking like bad ones.

import { describe, expect, it } from "vitest";
import { formatMetric, formatRecord, formatUsd, formatVotes, humanise, todaySeed } from "./format";

describe("formatRecord", () => {
  it("joins wins and losses with an en dash", () => {
    expect(formatRecord(27, 3)).toBe("27–3");
  });

  it("renders the clean sweep as 30–0", () => {
    expect(formatRecord(30, 0)).toBe("30–0");
  });

  it("renders a shut-out season as 0–30", () => {
    expect(formatRecord(0, 30)).toBe("0–30");
  });
});

describe("todaySeed", () => {
  it("uses local-time YYYY-MM-DD, zero padded", () => {
    // 6 September 2026, local time — the daily seed for that day.
    expect(todaySeed(new Date(2026, 8, 6, 13, 45))).toBe("2026-09-06");
    // Late evening must not roll over to the next day (a UTC-based
    // implementation would fail this west of Greenwich).
    expect(todaySeed(new Date(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });
});

describe("null-safe formatters", () => {
  it("renders an em dash rather than a zero", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatVotes(null)).toBe("—");
    expect(formatUsd(null)).toBe("—");
    expect(formatMetric(0)).toBe("0");
  });

  it("compacts large numbers", () => {
    expect(formatVotes(2_300_000)).toBe("2.3M");
    expect(formatVotes(48_000)).toBe("48K");
    expect(formatUsd(476_000_000)).toBe("$476M");
  });

  it("humanises feature ids for the analytics charts", () => {
    expect(humanise("log_votes")).toBe("Log votes");
  });
});
