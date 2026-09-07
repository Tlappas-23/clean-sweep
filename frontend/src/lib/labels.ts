// Human-readable labels for contract enums (categories, modes, metrics).
//
// Lives in src/lib because both the UI and the mock adapter's `getMeta` need
// the same strings. The real backend returns its own labels via /api/meta;
// these are the fallbacks used before that request resolves.

import type { Category, Mode } from "../api/types";

/** Default ballot order — the slot machine randomises the year, not this. */
export const CATEGORY_ORDER: Category[] = [
  "picture",
  "director",
  "actor",
  "actress",
  "supporting_actor",
  "supporting_actress",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  picture: "Best Picture",
  director: "Best Director",
  actor: "Best Actor",
  actress: "Best Actress",
  supporting_actor: "Best Supporting Actor",
  supporting_actress: "Best Supporting Actress",
};

/** Short form for tight spaces (ballot sidebar, table headers). */
export const CATEGORY_SHORT: Record<Category, string> = {
  picture: "Picture",
  director: "Director",
  actor: "Actor",
  actress: "Actress",
  supporting_actor: "Supp. Actor",
  supporting_actress: "Supp. Actress",
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
  { id: "academy", label: "Academy", description: "100 win, 60 nomination, 0 otherwise. Revealed at results." },
  ...CARD_METRICS,
] as const;

export type CardMetricId = (typeof CARD_METRICS)[number]["id"];

/** True for the four categories where a person (not a film) is the pick. */
export function isPersonCategory(category: Category): boolean {
  return category !== "picture";
}

export function decadeOf(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}
