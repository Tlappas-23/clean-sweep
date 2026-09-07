// Tests for the poster-led contender card (src/components/play/ContenderCard.tsx).
//
// The card is where the contract's optional fields meet reality: posters are
// near-universal but not guaranteed, measured box office is missing for a
// quarter of the catalog, the critics' columns are sparser still, and the
// career block is zeroed for film categories and for cinephile mode. Each of
// those has a rendering that has to look deliberate, so each has a test.
//
// Two of the tests below are about honesty rather than layout, and they are
// the ones worth not breaking:
//   * an estimated box office must read as an estimate and never as a
//     measurement, even though it sits in the same slot on the line;
//   * prestige is a model estimate and not part of the score, so it must not
//     render as a fourth peer of the scored bars.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Category, Contender } from "../../api/types";
import { ContenderCard } from "./ContenderCard";

function contenderOf(overrides: Partial<Contender> = {}): Contender {
  const category: Category = overrides.category ?? "actor";
  return {
    contender_id: "actor:nm0000158:tt0109830",
    category,
    year: 1994,
    film_id: "tt0109830",
    film_title: "Forrest Gump",
    person_id: "nm0000158",
    person_name: "Tom Hanks",
    character: "Forrest Gump",
    genres: ["Drama", "Romance"],
    runtime_minutes: 142,
    archetype: "Crowd-Pleaser",
    poster_url: "https://image.tmdb.org/t/p/w342/example.jpg",
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

describe("ContenderCard", () => {
  it("leads with the poster, lazily and with the film named in the alt text", () => {
    render(<ContenderCard contender={contenderOf()} />);

    const poster = screen.getByRole("img", { name: "Poster for Forrest Gump (1994)" });
    expect(poster).toHaveAttribute("src", "https://image.tmdb.org/t/p/w342/example.jpg");
    expect(poster).toHaveAttribute("loading", "lazy");
  });

  it("falls back to a titled plate when there is no poster", () => {
    render(<ContenderCard contender={contenderOf({ poster_url: null })} />);

    expect(screen.queryByRole("img", { name: /^Poster for/ })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "No poster for Forrest Gump (1994)" })).toBeInTheDocument();
    expect(screen.getByText("No poster")).toBeInTheDocument();
  });

  it("falls back the same way when the poster fails to load", () => {
    render(<ContenderCard contender={contenderOf()} />);

    fireEvent.error(screen.getByRole("img", { name: /^Poster for/ }));

    expect(screen.getByRole("img", { name: "No poster for Forrest Gump (1994)" })).toBeInTheDocument();
  });

  it("shows the decision-useful stats, including the career line", () => {
    render(<ContenderCard contender={contenderOf()} />);

    expect(screen.getByText("2 prior nominations · 1 win · top billed")).toBeInTheDocument();
    expect(screen.getByText(/IMDb 8\.8/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3M votes/)).toBeInTheDocument();
    expect(screen.getByText(/\$678M/)).toBeInTheDocument();
    expect(screen.getByText(/142 min/)).toBeInTheDocument();
  });

  it("renders a box office with neither a measurement nor an estimate as an em dash", () => {
    render(
      <ContenderCard
        contender={contenderOf({
          stats: {
            ...contenderOf().stats,
            box_office_usd: null,
            box_office_est_usd: null,
            budget_usd: null,
          },
        })}
      />,
    );

    // Each stat is its own nowrap <span> inside a flex row, so assert against
    // the row's text content rather than any one element.
    const gross = screen.getByTitle("No box-office figure for this film");
    expect(gross).toHaveTextContent("—");

    const line = gross.parentElement;
    expect(line?.textContent).toContain("IMDb 8.8");
    expect(line?.textContent).toContain("2.3M votes");
  });

  it("marks an estimated box office as an estimate and never as a measurement", () => {
    render(
      <ContenderCard
        contender={contenderOf({
          // The shape the API sends where nothing was ever measured: the
          // estimate column filled, the measured column and the metric null.
          metrics: { ...contenderOf().metrics, box_office: null },
          stats: {
            ...contenderOf().stats,
            box_office_usd: null,
            box_office_est_usd: 12_000_000,
            budget_usd: null,
          },
        })}
      />,
    );

    // The figure itself says "est.", so the caveat survives being skimmed,
    // read aloud, or seen on a device with no hover.
    expect(screen.getByText("≈$12M est.")).toBeInTheDocument();
    // Nothing on the card may present it as measured.
    expect(screen.queryByTitle("Worldwide box office (measured)")).not.toBeInTheDocument();
    expect(screen.queryByText("$12M")).not.toBeInTheDocument();

    // The tooltip has to say where the number came from and that it is unscored.
    const gross = screen.getByText("≈$12M est.").closest("[title]");
    expect(gross?.getAttribute("title")).toMatch(/estimated from comparable films/i);
    expect(gross?.getAttribute("title")).toMatch(/not counted in the box office score/i);

    // The scored bar stays empty on purpose, and explains itself rather than
    // looking like a rendering failure.
    const bar = screen.getByRole("meter", { name: "Box Office" });
    expect(bar).toHaveAttribute("aria-valuetext", "not available");
    expect(bar.parentElement?.getAttribute("title")).toMatch(/never scored/i);
  });

  it("shows a measured box office plainly, with no estimate hedging", () => {
    render(<ContenderCard contender={contenderOf()} />);

    const gross = screen.getByTitle("Worldwide box office (measured)");
    expect(gross).toHaveTextContent("$678M");
    expect(gross.textContent).not.toContain("est.");
  });

  it("keeps prestige out of the scored bars and labels it as a model estimate", () => {
    render(<ContenderCard contender={contenderOf()} />);

    // The three scored metrics are on the card; Academy is results-only.
    for (const label of ["Acclaim", "Box Office", "Popularity"]) {
      expect(screen.getByRole("meter", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("meter", { name: "Academy" })).not.toBeInTheDocument();

    // Prestige is present but sits in its own block, captioned as unscored.
    const prestige = screen.getByRole("meter", { name: "Prestige" });
    expect(prestige).toHaveAttribute("aria-valuenow", "78");
    expect(screen.getByText("Model estimate · not scored")).toBeInTheDocument();

    // "Its own block" is the load-bearing part: the scored bars must not be
    // able to pick it up by iterating their container.
    const scoredBlock = screen.getByRole("meter", { name: "Acclaim" }).closest("div.flex-col");
    expect(scoredBlock).not.toBeNull();
    expect(scoredBlock?.contains(prestige)).toBe(false);
  });

  it("shows no prestige block when the model has no estimate for a contender", () => {
    render(
      <ContenderCard contender={contenderOf({ metrics: { ...contenderOf().metrics, prestige: null } })} />,
    );

    expect(screen.queryByRole("meter", { name: "Prestige" })).not.toBeInTheDocument();
    expect(screen.queryByText("Model estimate · not scored")).not.toBeInTheDocument();
  });

  it("renders a genre slot as a film: no person, no career line", () => {
    render(
      <ContenderCard
        contender={contenderOf({
          category: "horror",
          contender_id: "horror:tt0054215",
          year: 1960,
          film_id: "tt0054215",
          film_title: "Psycho",
          person_id: null,
          person_name: null,
          character: null,
          genres: ["Horror", "Mystery", "Thriller"],
          runtime_minutes: 109,
          career: { prior_nominations: 0, prior_wins: 0, billing: null },
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Psycho" })).toBeInTheDocument();
    expect(screen.getByText(/1960/)).toBeInTheDocument();
    expect(screen.getByText("Horror")).toBeInTheDocument();
    // Film categories have no person, so there is no career record to show.
    expect(screen.queryByText(/prior nomination/)).not.toBeInTheDocument();
  });

  it("keeps the poster but drops every number in cinephile mode", () => {
    render(
      <ContenderCard
        showMetrics={false}
        contender={contenderOf({
          archetype: null,
          metrics: { acclaim: null, popularity: null, box_office: null, prestige: null },
          stats: {
            imdb_rating: null,
            imdb_votes: null,
            box_office_usd: null,
            box_office_est_usd: null,
            budget_usd: null,
            rt_critic: null,
            rt_audience: null,
            metascore: null,
          },
          career: { prior_nominations: 0, prior_wins: 0, billing: null },
        })}
      />,
    );

    // The poster is identity, not a metric: recognising it is the skill the
    // mode is testing, so it survives the mask.
    expect(screen.getByRole("img", { name: /^Poster for/ })).toBeInTheDocument();
    expect(screen.getByText("Tom Hanks")).toBeInTheDocument();
    expect(screen.queryByText(/IMDb/)).not.toBeInTheDocument();
    expect(screen.queryByText(/prior nomination/)).not.toBeInTheDocument();
    expect(screen.queryByText("Crowd-Pleaser")).not.toBeInTheDocument();
  });

  it("reports its selected state so the grid can confirm a pick", () => {
    const onSelect = vi.fn();
    render(<ContenderCard contender={contenderOf()} selected onSelect={onSelect} />);

    const card = screen.getByRole("button", { pressed: true });
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("actor:nm0000158:tt0109830");
  });
});
