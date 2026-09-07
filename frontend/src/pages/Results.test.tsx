// Tests for the results record header (src/pages/Results.tsx).
//
// The record is the headline of the whole game, and 30-0 is the reason the
// game exists — it gets its own copy and its own gilded treatment, so both
// branches are pinned here.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordHeader } from "./Results";

describe("RecordHeader", () => {
  it("formats an ordinary record with an en dash", () => {
    render(<RecordHeader wins={27} losses={3} cleanSweep={false} />);

    expect(screen.getByText("27–3")).toBeInTheDocument();
    expect(screen.getByText("Final record")).toBeInTheDocument();
    // The "Clean sweep" caption and the perfect-season eyebrow belong to 30-0
    // only (the explanatory line below the record does mention the phrase).
    expect(screen.queryByText("Clean sweep")).not.toBeInTheDocument();
    expect(screen.queryByText("A perfect season")).not.toBeInTheDocument();
  });

  it("celebrates a 30-0 clean sweep", () => {
    render(<RecordHeader wins={30} losses={0} cleanSweep />);

    const record = screen.getByText("30–0");
    expect(record).toBeInTheDocument();
    // Gilded gradient + glow are what make the sweep feel like a payoff.
    expect(record.className).toContain("text-gilded");
    expect(screen.getByText("Clean sweep")).toBeInTheDocument();
    expect(screen.getByText("A perfect season")).toBeInTheDocument();
  });

  it("shows the mode and daily seed when they are supplied", () => {
    render(<RecordHeader wins={12} losses={18} cleanSweep={false} mode="cinephile" seed="2026-09-06" />);

    expect(screen.getByText("cinephile")).toBeInTheDocument();
    expect(screen.getByText("daily 2026-09-06")).toBeInTheDocument();
  });
});
