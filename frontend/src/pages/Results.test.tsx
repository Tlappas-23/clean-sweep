// Tests for the results page's two exported blocks (src/pages/Results.tsx).
//
// The record is the headline of the whole game, and 30-0 is the reason the
// game exists — it gets its own copy and its own gilded treatment, so both
// branches are pinned here.
//
// The reveal is pinned for a different reason: it is the one place the four
// scored metrics are shown together, and the prestige estimate has to appear
// beside them without appearing to be one of them.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Contender, PickResult } from "../api/types";
import { PickReveal, RecordHeader } from "./Results";

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

/* ------------------------------------------------------------------ */
/* PickReveal                                                          */
/* ------------------------------------------------------------------ */

/** An unmasked contender, as the reveal receives it. */
function contenderOf(overrides: Partial<Contender> = {}): Contender {
  return {
    contender_id: "actor:nm0000158:tt0109830",
    category: "actor",
    year: 1994,
    film_id: "tt0109830",
    film_title: "Forrest Gump",
    person_id: "nm0000158",
    person_name: "Tom Hanks",
    character: "Forrest Gump",
    genres: ["Drama", "Romance"],
    runtime_minutes: 142,
    archetype: "Crowd-Pleaser",
    poster_url: null,
    metrics: { acclaim: 92, popularity: 99, box_office: 97, prestige: 78 },
    stats: {
      imdb_rating: 8.8,
      imdb_votes: 2_300_000,
      box_office_usd: 678_000_000,
      box_office_est_usd: null,
      budget_usd: 55_000_000,
      rt_critic: null,
      rt_audience: null,
      metascore: null,
    },
    career: { prior_nominations: 2, prior_wins: 1, billing: 1 },
    ...overrides,
  };
}

/**
 * A winning pick result. Note the breakdown: four keys, no prestige — the
 * server stopped sending it there when it stopped being scored, so a reveal
 * that read prestige from the breakdown would silently show a dash.
 */
function resultOf(overrides: Partial<PickResult> = {}): PickResult {
  const contender = overrides.pick?.contender ?? contenderOf();
  return {
    pick: { round: 1, category: "actor", year: 1994, contender },
    academy: 100,
    nominated: true,
    won_oscar: true,
    actual_winner: contender,
    metric_breakdown: { academy: 100, acclaim: 92, box_office: 97, popularity: 99 },
    pick_score: 96.4,
    ...overrides,
  };
}

describe("PickReveal", () => {
  it("shows the four scored metrics, Academy first", () => {
    render(<PickReveal result={resultOf()} delayMs={0} />);

    for (const [label, value] of [
      ["Academy", "100"],
      ["Acclaim", "92"],
      ["Box Office", "97"],
      ["Popularity", "99"],
    ]) {
      expect(screen.getByRole("meter", { name: label })).toHaveAttribute("aria-valuenow", value);
    }
  });

  it("reads prestige off the contender and marks it as unscored", () => {
    render(<PickReveal result={resultOf()} delayMs={0} />);

    // It is not in `metric_breakdown`, so the value proves the reveal looked
    // in the right place rather than rendering an accidental dash.
    const prestige = screen.getByRole("meter", { name: "Prestige" });
    expect(prestige).toHaveAttribute("aria-valuenow", "78");
    expect(screen.getByText("Model estimate · not scored")).toBeInTheDocument();

    // And it lives outside the scored block, not as a fifth peer inside it.
    const scored = screen.getByRole("meter", { name: "Academy" }).closest("div.flex-col");
    expect(scored?.contains(prestige)).toBe(false);
  });

  it("omits the prestige block entirely when the model had no estimate", () => {
    const contender = contenderOf({
      metrics: { acclaim: 92, popularity: 99, box_office: 97, prestige: null },
    });
    render(
      <PickReveal
        result={resultOf({ pick: { round: 1, category: "actor", year: 1994, contender } })}
        delayMs={0}
      />,
    );

    expect(screen.queryByRole("meter", { name: "Prestige" })).not.toBeInTheDocument();
    // The scored metrics are untouched by its absence.
    expect(screen.getByRole("meter", { name: "Academy" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("says the Academy row is reading the genre crown for a crown slot", () => {
    const contender = contenderOf({
      category: "horror",
      contender_id: "horror:tt0054215",
      person_id: null,
      person_name: null,
      character: null,
      film_title: "Psycho",
    });
    render(
      <PickReveal
        result={resultOf({
          pick: { round: 7, category: "horror", year: 1960, contender },
          actual_winner: contender,
        })}
        delayMs={0}
      />,
    );

    const academy = screen.getByRole("meter", { name: "Academy" }).parentElement;
    expect(academy?.getAttribute("title")).toMatch(/genre crown/i);
    // The weight is worth stating here: 60% of a pick score is this one row.
    expect(academy?.getAttribute("title")).toContain("Weight 60%");
    expect(screen.getByText("You picked the crown.")).toBeInTheDocument();
  });
});
