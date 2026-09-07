// Tests for the pure formatting helpers (src/lib/format.ts).
//
// These cover the three things the UI would quietly get wrong: the en dash in
// a season record, the "null renders as an em dash, never as zero" rule that
// keeps masked cinephile metrics from looking like bad ones, and the rule that
// an estimated box office is never rendered as a measured one.

import { describe, expect, it } from "vitest";
import {
  boxOfficeFigure,
  formatMetric,
  formatRecord,
  formatUsd,
  formatVotes,
  humanise,
  todaySeed,
} from "./format";

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

describe("boxOfficeFigure", () => {
  it("renders a measured gross plainly", () => {
    const figure = boxOfficeFigure(678_000_000, null);

    expect(figure.text).toBe("$678M");
    expect(figure.estimated).toBe(false);
    expect(figure.title).toBe("Worldwide box office (measured)");
  });

  it("marks an estimate as an estimate, in the text and in the tooltip", () => {
    const figure = boxOfficeFigure(null, 12_000_000);

    // The caveat is in the string itself, not only in a tooltip nobody on a
    // touch screen can open.
    expect(figure.text).toBe("≈$12M est.");
    expect(figure.estimated).toBe(true);
    expect(figure.title).toMatch(/estimated from comparable films/i);
    expect(figure.title).toMatch(/not counted in the Box Office score/i);
  });

  it("prefers the measurement whenever there is one", () => {
    // The two columns are never both set in practice, but if they ever were,
    // the measured number is the one that must win.
    const figure = boxOfficeFigure(50_000_000, 12_000_000);

    expect(figure.text).toBe("$50M");
    expect(figure.estimated).toBe(false);
  });

  it("falls back to an em dash when neither number exists", () => {
    const figure = boxOfficeFigure(null, null);

    expect(figure.text).toBe("—");
    expect(figure.estimated).toBe(false);
    expect(figure.title).toBe("No box-office figure for this film");
  });
});
