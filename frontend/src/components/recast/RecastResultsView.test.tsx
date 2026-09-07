// Unit tests for the reveal (src/components/recast/RecastResultsView.tsx).
//
// The flow tests in src/pages/Recast.test.tsx walk a real round through the
// mock, which covers the ordinary case. What they cannot reach are the two
// edges of the comparison — a player who took the best casting on offer, and
// a shortlist with nobody left to offer at all (`best_available: null` on the
// wire) — so those are built here from fixed data.
//
// They are worth pinning because they are the three different things the
// reveal has to say, and saying the wrong one is silent: a round where the
// player found the best answer must not print "0 points ahead of yours", and
// an empty shortlist must not print a comparison at all.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ActorCard, CastingResult, RecastResults, RecastState } from "../../api/types";
import { RecastResultsView, CastingReveal } from "./RecastResultsView";

function actor(name: string, id: string): ActorCard {
  return {
    person_id: id,
    name,
    n_films: 24,
    first_year: 1980,
    last_year: 2020,
    lead_share: 0.6,
    top_genres: ["Drama", "Crime"],
    casting_type: "Marquee Lead",
  };
}

const ORIGINAL = actor("Robert De Niro", "nm0000134");
const REPLACEMENT = actor("Tom Hanks", "nm0000158");
const BETTER = actor("Harrison Ford", "nm0000148");

function casting(overrides: Partial<CastingResult> = {}): CastingResult {
  return {
    billing: 1,
    character: "Neil McCauley",
    original: ORIGINAL,
    replacement: REPLACEMENT,
    fit: 71.2,
    breakdown: { stature: 88, role_fit: 64, genre: 66.67, era: 92.5 },
    best_available: BETTER,
    best_fit: 79.4,
    ...overrides,
  };
}

describe("CastingReveal", () => {
  it("draws the four components and the name that beat the player's", () => {
    render(<CastingReveal casting={casting()} delayMs={0} />);

    const bars = screen.getAllByRole("meter");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Stature",
      "Role fit",
      "Genre",
      "Era",
    ]);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "88");

    // The swap, then the comparison, then how far apart they were: 79 - 71.
    expect(screen.getByText("Robert De Niro")).toBeInTheDocument();
    expect(screen.getByText("Tom Hanks")).toBeInTheDocument();
    expect(screen.getByText("Harrison Ford")).toBeInTheDocument();
    expect(screen.getByText(/8 points ahead of yours/)).toBeInTheDocument();
  });

  it("says so when the player took the best casting on offer", () => {
    // Compared by id rather than by fit: two actors can tie, and only one of
    // them was actually chosen.
    render(
      <CastingReveal
        casting={casting({ best_available: REPLACEMENT, best_fit: 71.2 })}
        delayMs={0}
      />,
    );

    expect(screen.getByText(/Nobody on that shortlist fitted the part better/)).toBeInTheDocument();
    expect(screen.queryByText(/points ahead of yours/)).toBeNull();
    // Said twice on purpose: the chip in the header flags the panel at a
    // glance, the label inside it heads the explanation.
    expect(screen.getAllByText("Best available")).toHaveLength(2);
  });

  it("offers no comparison when the shortlist had nobody else", () => {
    render(
      <CastingReveal casting={casting({ best_available: null, best_fit: null })} delayMs={0} />,
    );

    expect(screen.getByText(/nothing to compare this against/)).toBeInTheDocument();
    expect(screen.queryByText(/points ahead of yours/)).toBeNull();
  });

  it("uses the singular for a one-point gap", () => {
    render(<CastingReveal casting={casting({ fit: 78.4, best_fit: 79.4 })} delayMs={0} />);

    expect(screen.getByText(/1 point ahead of yours/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* The headline                                                        */
/* ------------------------------------------------------------------ */

function results(castings: CastingResult[]): RecastResults {
  const game: RecastState = {
    id: "r1",
    seed: null,
    status: "complete",
    film: {
      film_id: "tt0113277",
      title: "Heat",
      year: 1995,
      poster_url: null,
      genres: ["Action", "Crime", "Drama"],
    },
    roles: [],
    current_role: castings.length,
    picks: [],
    created_at: "2026-09-07T00:00:00Z",
  };
  const fits = castings.map((c) => c.fit);
  return {
    game,
    score: fits.reduce((a, b) => a + b, 0) / fits.length,
    castings,
    strongest: castings.reduce((a, b) => (b.fit > a.fit ? b : a)).billing,
    weakest: castings.reduce((a, b) => (b.fit < a.fit ? b : a)).billing,
  };
}

describe("RecastResultsView", () => {
  it("resolves strongest and weakest through billing, not array position", () => {
    // Deliberately out of fit order, and with billings that are not indexes,
    // so a lookup that confused the two would name the wrong role.
    const data = results([
      casting({ billing: 2, character: "Vincent Hanna", fit: 40 }),
      casting({ billing: 4, character: "Nate", fit: 90, replacement: BETTER }),
      casting({ billing: 7, character: "Trejo", fit: 66 }),
    ]);

    render(<RecastResultsView results={data} />);

    expect(screen.getByText(/^Strongest:/)).toHaveTextContent("Harrison Ford as Nate");
    expect(screen.getByText(/^Weakest:/)).toHaveTextContent("Tom Hanks as Vincent Hanna");
    // The mean of 40, 90 and 66, on the same 0-100 scale as each role — and
    // a figure none of the three roles carries, so it cannot be matched by
    // accident.
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText(/Mean fit across/)).toHaveTextContent("3");
  });

  it("staggers the panels so the reveal arrives in billing order", () => {
    const data = results([
      casting({ billing: 1 }),
      casting({ billing: 2 }),
      casting({ billing: 3 }),
    ]);

    render(<RecastResultsView results={data} />);

    // jsdom reports no reduced-motion preference (src/test/setup.ts), so the
    // delays are the real ones: nothing, then one gap, then two.
    const panels = within(screen.getByRole("list")).getAllByRole("article");
    expect(panels.map((p) => p.style.animationDelay)).toEqual(["0ms", "140ms", "280ms"]);
  });
});
