// Human-readable labels for contract enums (categories, modes, metrics).
//
// Lives in src/lib because both the UI and the mock adapter's `getMeta` need
// the same strings. The real backend returns its own labels via /api/meta;
// these are the fallbacks used before that request resolves.

import type { Category, Mode } from "../api/types";

/** Default ballot order. The slot machine randomises the years, not this. */
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
      "Critics, audience, box office, popularity and archetype are shown on every card. The ceremony result stays hidden until the end, and the model's prestige estimate is kept off the card entirely: it cannot change your score, so during a draft it would only read as a hint. It appears in the reveal.",
  },
  cinephile: {
    label: "Cinephile",
    description:
      "No numbers at all. Just title, year, person and role. Pick from memory and taste.",
  },
};

/**
 * The ceremony metric: ground truth, and the heaviest single weight.
 *
 * Heaviest because it is the only one of the five that is a verdict rather
 * than a measurement, not because the score is about awards. It held 0.60
 * when winning all 30 ceremonies was the goal and that rule needed a snub to
 * be fatal; the goal is the score now, so it carries 0.35 and a film is
 * judged on the whole of what it did.
 *
 * It is the only scored metric hidden while drafting, so it never appears on
 * a card. It appears only on the results reveal, where it is finally shown.
 *
 * It is not the old all-or-nothing academy metric under a new name. A pick
 * that was never nominated used to score a flat 0, which says nothing about
 * the contender and everything about one category: a film like Jurassic Park
 * could win three Oscars the game does not play and still be scored as a
 * nobody. So the metric now takes the better of two readings, the pick's own
 * result here and the film's standing across the whole Academy record, and
 * the second is capped below a nomination so it can never overtake one
 * (backend/app/engine/scoring.py, backend/pipeline/awards.py).
 */
export const CEREMONY_METRIC = {
  id: "ceremony",
  label: "Ceremony",
  description:
    "100 for winning this category, 60 for a nomination in it, and otherwise the film's standing across every Academy category, weighted by how senior the award is. Best Horror and Best Comedy read the genre crown instead of an Oscar. Revealed at results.",
  weight: 0.35,
} as const;

/**
 * The four scored metrics visible on a card, heaviest first.
 *
 * Critics and Audience are deliberately close. Neither is the
 * authority on whether a film is good, and putting one above the other would
 * be an opinion the data cannot support.
 *
 * Prestige is deliberately absent: it is a model estimate and no part of the
 * score (see `PRESTIGE_METRIC` below). Box Office reads *measured* revenue
 * only, which is why a film with an estimated gross still shows a dash here.
 */
export const CARD_METRICS = [
  { id: "box_office", label: "Box Office", description: "Measured revenue, percentile within the film year. Estimates are shown on the card but never scored.", weight: 0.15 },
  { id: "critics", label: "Critics", description: "Rotten Tomatoes critic score and Metascore averaged, percentile within the film year.", weight: 0.22 },
  { id: "audience", label: "Audience", description: "IMDb rating, percentile within the film year.", weight: 0.18 },
  { id: "popularity", label: "Popularity", description: "IMDb vote count, percentile within the film year.", weight: 0.1 },
] as const;

/**
 * Every metric that contributes to a pick score, heaviest first. The weights
 * sum to 1 and are renormalised over whichever metrics are non-null, so a
 * missing box-office figure never costs a pick points.
 *
 * This is the list the UI derives its scored-metric bars from, and it matches
 * what `/api/meta` returns. The backend dropped prestige from both when it
 * stopped being scored (backend/app/engine/scoring.py).
 */
export const SCORED_METRICS = [CEREMONY_METRIC, ...CARD_METRICS] as const;

/**
 * The model estimate that rides along with the scored metrics but is not one
 * of them.
 *
 * Prestige is the ranker's probability that a contender looks like a winner.
 * It used to carry 0.17 of the pick score; a player's record should not
 * depend on what a gradient-boosted tree guessed, so it is now reported
 * rather than counted. It is still worth showing, because the model is
 * genuinely predictive and `GET /api/analytics/validation` is the evidence.
 * But the UI has to render it as clearly separate from the five scored
 * metrics.
 */
export const PRESTIGE_METRIC = {
  id: "prestige",
  label: "Prestige",
  /** Short caption for the muted block the card and the reveal put it in. */
  note: "Model estimate · not scored",
  description:
    "The ranker's estimated probability that this looks like an Oscar winner. Informational only: it is not part of the pick score.",
} as const;

export type CardMetricId = (typeof CARD_METRICS)[number]["id"];

/** "0.60" → "60%", for the weight column in the metric glossary. */
export function formatWeight(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

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
  /** What the hidden ceremony metric actually measures. */
  metric: string;
  /** Badge for a pick that took the slot. */
  won: string;
  /** Badge for a pick that was nominated for it. */
  nominated: string;
  /** Badge for a pick that was neither. */
  missed: string;
  /** Lead-in when naming the contender that actually took the slot. */
  winnerPrefix: string;
}

export function outcomeWording(category: Category): OutcomeWording {
  if (isGenreCategory(category)) {
    return {
      metric: "the genre crown, the year's top-rated film of this genre rather than an Academy Award",
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
