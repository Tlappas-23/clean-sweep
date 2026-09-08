// The game modes as the front of house describes them.
//
// Lives in src/lib next to labels.ts and for the same reason. Two surfaces
// need the same vocabulary: the landing page (src/pages/Home.tsx) and the
// How to Play dialog (src/components/layout/HowToPlayModal.tsx). Neither of
// them should own it.
//
// Two things live here, and the split matters:
//
//   MODE_FALLBACK is *copy of last resort*. The menu is served by
//   `GET /api/modes` and the server stays the authority, because only it
//   knows whether a mode's seed tables were built (`ModeCard.available`).
//   These entries exist so the landing page paints a complete, correct front
//   door on the very first frame, before that request resolves, and still if
//   it never does. The page prefers the server's list whenever it has one.
//
//   MODE_STEPS / MODE_SCORING / MODE_NOTES are the rules, which the API does
//   not serve at all. One line per step, in the order a player meets them.

import type { ModeCard } from "../api/types";
import type { IconName } from "../components/ui/Icon";

/**
 * The mode ids the client knows how to launch, in menu order.
 *
 * The order matches `_game_menu` in backend/app/api/meta.py, so the fallback
 * below and the served menu paint the tiles in the same places and the page
 * does not visibly reshuffle when the request lands.
 */
export const MODE_IDS = ["oscars", "recast", "chain", "grid"] as const;

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
  chain: {
    id: "chain",
    label: "The Chain",
    tagline: "Get from one film to another",
    description:
      "Two films, and a cast list between them. Move by naming a film that shares an actor with the one you are on, and keep going until you arrive, against a stopwatch.",
    available: true,
    path: "/chain",
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
 * How to play each mode: four to six steps, in the order they happen.
 *
 * The discipline here is one sentence per step. Anything that needs a
 * paragraph belongs in docs/GAME_DESIGN.md, not in a dialog someone opened
 * because they wanted to start playing.
 */
export const MODE_STEPS: Record<ModeId, HowToStep[]> = {
  oscars: [
    { icon: "deal", text: "Three years are dealt each round, alongside the next category on your ballot." },
    { icon: "draft", text: "Draft one contender for that category from any of the three years. The whole year is in play, nominees or not." },
    { icon: "reroll", text: "Or spend the round's one reroll: all three years go back for a single fresh year, and that one you have to use." },
    { icon: "skip", text: "One category skip per game pushes an awkward slot to the end of the ballot." },
    { icon: "score", text: "A pick that won its category scores 100 and a nominee 60. A pick that was neither is scored on what the Academy made of the film elsewhere, so a landmark film is never worth nothing." },
    { icon: "trophy", text: "Eight categories fill the ballot, then it runs a thirty-stop awards season. Win all thirty for a 30–0 clean sweep." },
  ],
  recast: [
    { icon: "film", text: "A film comes up with its principal roles laid out beside it." },
    { icon: "cast", text: "Each role offers a shortlist of actors of the same casting type, clustered from how they actually get cast." },
    { icon: "draft", text: "Lock in a replacement for every role." },
    { icon: "score", text: "Each choice is scored on stature, role size, era and genre." },
    { icon: "reveal", text: "Then the round shows you the best casting that was on offer." },
  ],
  chain: [
    { icon: "film", text: "Two films are dealt: one to start on, one to reach." },
    { icon: "chain", text: "Name a film that shares a cast member with the one you are standing on, and you move to it. The game tells you which actor made the link." },
    { icon: "draft", text: "A film you have already visited cannot be used twice, so a route can never be padded out." },
    { icon: "clock", text: "A stopwatch runs from the first film to the last. It never stops you playing; it is the tiebreak between two routes of the same length." },
    { icon: "reveal", text: "Stop whenever you like and the shortest route is revealed, laid out beside the one you walked." },
    { icon: "trophy", text: "Every finished chain is ranked: arriving first, then fewest films, then fastest." },
  ],
  grid: [
    { icon: "grid", text: "Three actors down the side, three across the top, and none of them have ever worked with anybody opposite them." },
    { icon: "cast", text: "Every cell wants a third actor who has worked with both: one film with the row, another film with the column." },
    { icon: "draft", text: "Every pairing is checked to have at least three actors who bridge it, and no two cells share a rarest link, so a perfect board is always reachable." },
    { icon: "clock", text: "Three minutes on the clock, and each connecting actor can only be used once per board." },
    { icon: "draft", text: "Type the name in full. There are no suggestions, since a list of them would be the answer key. Spelling is forgiven." },
    { icon: "reveal", text: "The rarer the link, the more it scores. The obvious connection is worth the least. Every answer shows the two films that prove it." },
  ],
};

/** The one line about scoring each mode's dialog ends on. */
export const MODE_SCORING: Record<ModeId, string> = {
  oscars:
    "Every pick scores 0–100: sixty per cent is what the Academy made of it, the rest is box office, critics, audience and popularity measured against the pick's own year.",
  recast:
    "A role scores on how close the replacement is to the original in standing, in how much film they carry, and in the era and genre they work in.",
  chain:
    "Nothing is scored out of a hundred here. A chain is ranked on three things kept deliberately apart: whether you arrived, how many films it took, and how long it took you. Every board is dealt exactly three steps apart, so three is the number to beat.",
  grid: "Any actor who genuinely connects the pair is worth at least 60, but the obvious one stops there. The most obscure actor who still links them is worth 100.",
};

/**
 * The caveat each mode needs, where it has one. Only the Oscars does: two of
 * its eight slots are not Academy Awards, and a player who does not know that
 * will read their result wrongly (docs/GAME_DESIGN.md §1).
 */
export const MODE_NOTES: Partial<Record<ModeId, string>> = {
  oscars:
    "Best Horror and Best Comedy are not Academy Awards. Those two slots are judged against a genre crown taken from the data: the year's top-rated film of that genre.",
};
