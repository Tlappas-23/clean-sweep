// Tests for the results page's two exported blocks (src/pages/Results.tsx).
//
// The headline is the ballot score, because that is what the game is played
// for: one number out of 800 that says how good the eight films you drafted
// were. What makes it a game rather than a fact is having something to beat,
// so the three states of that comparison are pinned here. They are genuinely
// different messages and none of them is a failure: a first game has no best
// yet, a game that beat one should say by how much, and a game that did not
// should say what is still standing.
//
// The circuit record is still shown, demoted to what it now is: evidence of
// how the ballot would have fared rather than the thing being scored.
//
// The reveal is pinned for a different reason: it is the one place the five
// scored metrics are shown together, and the prestige estimate has to appear
// beside them without appearing to be one of them.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Contender, PickResult } from "../api/types";
import { PickReveal, RecordHeader } from "./Results";

describe("RecordHeader", () => {
  it("leads with the score, not the win-loss record", () => {
    render(<RecordHeader score={612} wins={27} losses={3} cleanSweep={false} previousBest={580} />);

    expect(screen.getByText("612")).toBeInTheDocument();
    expect(screen.getByText("Ballot score")).toBeInTheDocument();
    // The circuit is still reported, as supporting evidence.
    expect(screen.getByText(/27 of 30/)).toBeInTheDocument();
  });

  it("says by how much a personal best was beaten", () => {
    render(<RecordHeader score={640} wins={28} losses={2} cleanSweep={false} previousBest={580} beaten />);

    expect(screen.getByText("New best")).toBeInTheDocument();
    // The delta is the reason to play again, so it is stated rather than left
    // for the player to work out.
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText(/Beat your best by/)).toBeInTheDocument();
  });

  it("treats a first game as a benchmark rather than a loss", () => {
    render(<RecordHeader score={500} wins={20} losses={10} cleanSweep={false} previousBest={null} />);

    expect(screen.getByText(/first ballot/i)).toBeInTheDocument();
    expect(screen.queryByText("New best")).not.toBeInTheDocument();
  });

  it("says what is still standing when the best was not beaten", () => {
    render(<RecordHeader score={520} wins={21} losses={9} cleanSweep={false} previousBest={580} />);

    expect(screen.getByText("580")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.queryByText("New best")).not.toBeInTheDocument();
  });

  it("still celebrates a clean sweep, as an achievement on top of a score", () => {
    render(<RecordHeader score={780} wins={30} losses={0} cleanSweep previousBest={700} beaten />);

    const score = screen.getByText("780");
    expect(score.className).toContain("text-silvered");
    expect(screen.getByText("Clean sweep")).toBeInTheDocument();
  });

  it("shows the mode and daily seed when they are supplied", () => {
    render(
      <RecordHeader
        score={430}
        wins={12}
        losses={18}
        cleanSweep={false}
        mode="cinephile"
        seed="2026-09-06"
      />,
    );

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
    metrics: { audience: 92, critics: 88, popularity: 99, box_office: 97, prestige: 78 },
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
 * A winning pick result. Note the breakdown: five keys, no prestige. The
 * server stopped sending it there when it stopped being scored, so a reveal
 * that read prestige from the breakdown would silently show a dash.
 *
 * `academy` is the contract's name for the ceremony metric. A win is still
 * 100, but the field is a 0-100 range now, not one of three fixed values, so
 * nothing here may assume otherwise.
 */
function resultOf(overrides: Partial<PickResult> = {}): PickResult {
  const contender = overrides.pick?.contender ?? contenderOf();
  return {
    pick: { round: 1, category: "actor", year: 1994, contender },
    academy: 100,
    nominated: true,
    won_oscar: true,
    actual_winner: contender,
    metric_breakdown: { ceremony: 100, box_office: 97, critics: 88, audience: 92, popularity: 99 },
    pick_score: 96.4,
    ...overrides,
  };
}

describe("PickReveal", () => {
  it("shows the five scored metrics, Ceremony first", () => {
    render(<PickReveal result={resultOf()} delayMs={0} />);

    for (const [label, value] of [
      ["Ceremony", "100"],
      ["Box Office", "97"],
      ["Critics", "88"],
      ["Audience", "92"],
      ["Popularity", "99"],
    ]) {
      expect(screen.getByRole("meter", { name: label })).toHaveAttribute("aria-valuenow", value);
    }
  });

  it("renders a ceremony value that is neither 0, 60 nor 100", () => {
    // The metric stopped being all-or-nothing: a pick nobody nominated is now
    // scored on what the Academy made of its film elsewhere, so the reveal has
    // to draw whatever number arrives rather than one of three known ones.
    render(
      <PickReveal
        result={resultOf({
          academy: 27,
          nominated: false,
          won_oscar: false,
          metric_breakdown: { ceremony: 27, box_office: 97, critics: 88, audience: 92, popularity: 99 },
          pick_score: 46.2,
        })}
        delayMs={0}
      />,
    );

    expect(screen.getByRole("meter", { name: "Ceremony" })).toHaveAttribute("aria-valuenow", "27");
    expect(screen.getByText("Not nominated")).toBeInTheDocument();
  });

  it("reads prestige off the contender and marks it as unscored", () => {
    render(<PickReveal result={resultOf()} delayMs={0} />);

    // It is not in `metric_breakdown`, so the value proves the reveal looked
    // in the right place rather than rendering an accidental dash.
    const prestige = screen.getByRole("meter", { name: "Prestige" });
    expect(prestige).toHaveAttribute("aria-valuenow", "78");
    expect(screen.getByText("Model estimate · not scored")).toBeInTheDocument();

    // And it lives outside the scored block, not as a sixth peer inside it.
    const scored = screen.getByRole("meter", { name: "Ceremony" }).closest("div.flex-col");
    expect(scored?.contains(prestige)).toBe(false);
  });

  it("omits the prestige block entirely when the model had no estimate", () => {
    const contender = contenderOf({
      metrics: { audience: 92, critics: 88, popularity: 99, box_office: 97, prestige: null },
    });
    render(
      <PickReveal
        result={resultOf({ pick: { round: 1, category: "actor", year: 1994, contender } })}
        delayMs={0}
      />,
    );

    expect(screen.queryByRole("meter", { name: "Prestige" })).not.toBeInTheDocument();
    // The scored metrics are untouched by its absence.
    expect(screen.getByRole("meter", { name: "Ceremony" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("says the Ceremony row is reading the genre crown for a crown slot", () => {
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

    const ceremony = screen.getByRole("meter", { name: "Ceremony" }).parentElement;
    expect(ceremony?.getAttribute("title")).toMatch(/genre crown/i);
    // The weight is worth stating here: 60% of a pick score is this one row.
    expect(ceremony?.getAttribute("title")).toContain("Weight 35%");
    expect(screen.getByText("You picked the crown.")).toBeInTheDocument();
  });
});
