// Tests for MetricBar (src/components/play/MetricBar.tsx).
//
// The one rule that matters here: a null metric is *hidden*, not zero. In
// cinephile mode every metric arrives null (docs/API.md, "Masking"), and a
// zero-width bar would read as "this contender is terrible" instead of
// "you don't get to see this".

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricBar } from "./MetricBar";

describe("MetricBar", () => {
  it("renders an em dash and no fill for a null value", () => {
    render(<MetricBar label="Prestige" value={null} />);

    expect(screen.getByText("–")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-fill")).not.toBeInTheDocument();

    const meter = screen.getByRole("meter", { name: "Prestige" });
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAttribute("aria-valuetext", "not available");
  });

  it("renders the rounded value and a proportional fill for a number", () => {
    render(<MetricBar label="Acclaim" value={72.4} />);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Acclaim" })).toHaveAttribute("aria-valuenow", "72.4");
    expect(screen.getByTestId("metric-fill")).toHaveStyle({ width: "72.4%" });
  });

  it("clamps values outside 0-100", () => {
    render(<MetricBar label="Popularity" value={140} />);

    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByTestId("metric-fill")).toHaveStyle({ width: "100%" });
  });
});
