// The three modes as the front of house describes them.
//
// Lives in src/lib next to labels.ts and for the same reason: two surfaces —
// the landing page (src/pages/Home.tsx) and the How to Play dialog
// (src/components/layout/HowToPlayModal.tsx) — need the same vocabulary, and
// neither should own it.
//
// Two things live here, and the split matters:
//
//   MODE_FALLBACK is *copy of last resort*. The menu is served by
//   `GET /api/modes` and the server stays the authority, because only it
//   knows whether a mode's seed tables were built (`ModeCard.available`).
//   These entries exist so the landing page paints a complete, correct front
//   door on the very first frame — before that request resolves, and still if
//   it never does. The page prefers the server's list whenever it has one.
//
//   MODE_STEPS / MODE_SCORING / MODE_NOTES are the rules, which the API does
//   not serve at all. One line per step, in the order a player meets them.

import type { ModeCard } from "../api/types";
import type { IconName } from "../components/ui/Icon";

/** The mode ids the client knows how to launch, in menu order. */
export const MODE_IDS = ["oscars", "recast", "grid"] as const;

export type ModeId = (typeof MODE_IDS)[number];

/**
 * First-paint copy for the menu. Shape-identical to what the server sends so
 * the page can treat the two interchangeably.
 *
 * `available: true` is an optimistic guess that lasts only until the request
 * lands, and the cost of guessing wrong is deliberately small: the two side
 * modes answer a 503 with a page that explains exactly which seed step is
 * missing, which is a better thing to click into for a hundred milliseconds
 * than a button that is dead on arrival.
 */
export const MODE_FALLBACK: Record<ModeId, ModeCard> = {
  oscars: {
    id: "oscars",
    label: "The Oscars",
    tagline: "Build the best ballot in history",
    description:
      "Three years are dealt each round and you draft one contender per category, then the ballot runs a thirty-stop awards season.",
    available: true,
    path: "/",
  },
  recast: {
    id: "recast",
    label: "Recast",
    tagline: "Who else could have played the part?",
    description:
      "A film comes up with its principal roles. Replace each one from a shortlist of actors of the same casting type.",
    available: true,
    path: "/recast",
  },
  grid: {
    id: "grid",
    label: "Six Degrees",
    tagline: "Name the actor who connects them",
    description:
      "Three actors down the side, three across the top, none of whom have worked together, and three minutes to find the actor who bridges every pairing.",
    available: true,
    path: "/grid",
  },
};

/** One rule, one line, one glyph. */
export interface HowToStep {
  icon: IconName;
  text: string;
}

/**
 * How to play each mode: four or five steps, in the order they happen.
 *
 * The discipline here is one sentence per step. Anything that needs a
 * paragraph belongs in docs/GAME_DESIGN.md, not in a dialog someone opened
 * because they wanted to start playing.
 */
export const MODE_STEPS: Record<ModeId, HowToStep[]> = {
  oscars: [
    { icon: "deal", text: "Three years are dealt each round, alongside the next category on your ballot." },
    { icon: "draft", text: "Draft one contender for that category from any of the three years — the whole year is in play, not just the nominees." },
    { icon: "reroll", text: "Or spend the round's one reroll: all three years go back for a single fresh year, and that one you have to use." },
    { icon: "skip", text: "One category skip per game pushes an awkward slot to the end of the ballot." },
    { icon: "trophy", text: "Eight categories fill the ballot, then it runs a thirty-stop awards season — win all thirty for a 30–0 clean sweep." },
  ],
  recast: [
    { icon: "film", text: "A film comes up with its principal roles laid out beside it." },
    { icon: "cast", text: "Each role offers a shortlist of actors of the same casting type, clustered from how they actually get cast." },
    { icon: "draft", text: "Lock in a replacement for every role." },
    { icon: "score", text: "Each choice is scored on stature, role size, era and genre." },
    { icon: "reveal", text: "Then the round shows you the best casting that was on offer." },
  ],
  grid: [
    { icon: "grid", text: "Three actors down the side, three across the top, and none of them have ever worked with anybody opposite them." },
    { icon: "cast", text: "Every cell wants a third actor who has worked with both — one film with the row, another film with the column." },
    { icon: "draft", text: "Every pairing is checked to have at least three actors who bridge it, and no two cells share a rarest link, so a perfect board is always reachable." },
    { icon: "clock", text: "Three minutes on the clock, and each connecting actor can only be used once per board." },
    { icon: "draft", text: "Type the name in full — there are no suggestions, since a list of them would be the answer key. Spelling is forgiven." },
    { icon: "reveal", text: "The rarer the link, the more it scores — the obvious connection is worth the least. Every answer shows the two films that prove it." },
  ],
};

/** The one line about scoring each mode's dialog ends on. */
export const MODE_SCORING: Record<ModeId, string> = {
  oscars:
    "Every pick scores 0–100: sixty per cent is the Academy result, the rest is acclaim, box office and popularity measured against the pick's own year.",
  recast:
    "A role scores on how close the replacement is to the original in standing, in how much film they carry, and in the era and genre they work in.",
  grid: "Any actor who genuinely connects the pair is worth at least 60, but the obvious one stops there — the most obscure actor who still links them is worth 100.",
};

/**
 * The caveat each mode needs, where it has one. Only the Oscars does: two of
 * its eight slots are not Academy Awards, and a player who does not know that
 * will read their result wrongly (docs/GAME_DESIGN.md §1).
 */
export const MODE_NOTES: Partial<Record<ModeId, string>> = {
  oscars:
    "Best Horror and Best Comedy are not Academy Awards. Those two slots are judged against a genre crown taken from the data — the year's top-rated film of that genre.",
};
