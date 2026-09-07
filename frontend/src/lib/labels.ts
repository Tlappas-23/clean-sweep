// Human-readable labels for contract enums (categories, modes, metrics).
//
// Lives in src/lib because both the UI and the mock adapter's `getMeta` need
// the same strings. The real backend returns its own labels via /api/meta;
// these are the fallbacks used before that request resolves.

import type { Category, Mode } from "../api/types";

/** Default ballot order — the slot machine randomises the years, not this. */
export const CATEGORY_ORDER: Category[] = [
  "picture",
  "director",
  "actor",
  "actress",
  "supporting_actor",
  "supporting_actress",
  "horror",
  "comedy",
];

/** How many slots a full ballot has; also the number of rounds in a game. */
export const BALLOT_SLOTS = CATEGORY_ORDER.length;

/** Ballot strength is the sum of `BALLOT_SLOTS` pick scores, each 0-100. */
export const MAX_BALLOT_STRENGTH = BALLOT_SLOTS * 100;

export const CATEGORY_LABELS: Record<Category, string> = {
  picture: "Best Picture",
  director: "Best Director",
  actor: "Best Actor",
  actress: "Best Actress",
  supporting_actor: "Best Supporting Actor",
  supporting_actress: "Best Supporting Actress",
  horror: "Best Horror",
  comedy: "Best Comedy",
};

/** Short form for tight spaces (ballot sidebar, table headers). */
export const CATEGORY_SHORT: Record<Category, string> = {
  picture: "Picture",
  director: "Director",
  actor: "Actor",
  actress: "Actress",
  supporting_actor: "Supp. Actor",
  supporting_actress: "Supp. Actress",
  horror: "Horror",
  comedy: "Comedy",
};

export const MODE_LABELS: Record<Mode, { label: string; description: string }> = {
  classic: {
    label: "Classic",
    description:
      "Acclaim, popularity, box office, prestige and archetype are shown on every card. Academy results stay hidden until the end.",
  },
  cinephile: {
    label: "Cinephile",
    description:
      "No numbers at all — just title, year, person and role. Pick from memory and taste.",
  },
};

/** The four card-visible metrics, in display order. Academy is results-only. */
export const CARD_METRICS = [
  { id: "acclaim", label: "Acclaim", description: "IMDb rating, percentile within the film year." },
  { id: "popularity", label: "Popularity", description: "IMDb vote count, percentile within the film year." },
  { id: "box_office", label: "Box Office", description: "Revenue percentile within the film year (falls back to popularity)." },
  { id: "prestige", label: "Prestige", description: "Ranker probability that this looks like an Oscar winner." },
] as const;

export const ALL_METRICS = [
  {
    id: "academy",
    label: "Academy",
    description:
      "100 win, 60 nomination, 0 otherwise. Best Horror and Best Comedy read the genre crown instead of an Oscar. Revealed at results.",
  },
  ...CARD_METRICS,
] as const;

export type CardMetricId = (typeof CARD_METRICS)[number]["id"];

/**
 * True for the two slots the Academy never created (docs/GAME_DESIGN.md §1).
 * They are scored against a genre crown computed from the data, so anywhere
 * the UI says "Oscar" it has to say something else for these.
 */
export function isGenreCategory(category: Category): boolean {
  return category === "horror" || category === "comedy";
}

/** True for the five categories where a person (not a film) is the pick. */
export function isPersonCategory(category: Category): boolean {
  return category !== "picture" && !isGenreCategory(category);
}

/**
 * The words a category uses for its answer key.
 *
 * Six categories are decided by an Academy Award; the two genre slots are
 * decided by the crown. Rather than sprinkle `isGenreCategory` ternaries
 * through the results and play screens, every piece of outcome copy is
 * resolved here once.
 */
export interface OutcomeWording {
  /** What the hidden Academy metric actually measures. */
  metric: string;
  /** Badge for a pick that scored 100. */
  won: string;
  /** Badge for a pick that scored 60. */
  nominated: string;
  /** Badge for a pick that scored 0. */
  missed: string;
  /** Lead-in when naming the contender that actually took the slot. */
  winnerPrefix: string;
}

export function outcomeWording(category: Category): OutcomeWording {
  if (isGenreCategory(category)) {
    return {
      metric: "the genre crown — the year's top-rated film of this genre, not an Academy Award",
      won: "Won the crown",
      nominated: "Crown runner-up",
      missed: "Outside the crown",
      winnerPrefix: "Took the crown:",
    };
  }
  return {
    metric: "the Academy Award for this year and category",
    won: "Won the Oscar",
    nominated: "Nominated",
    missed: "Not nominated",
    winnerPrefix: "Actually won:",
  };
}

export function decadeOf(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}
