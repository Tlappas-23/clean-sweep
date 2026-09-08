// In-memory implementation of the `Api` interface (src/api/client.ts).
//
// Lets the whole UI run without the FastAPI backend (VITE_API_MOCK=true) and
// gives the tests a deterministic server. It enforces the same state rules
// listed at the bottom of docs/API.md: spin only while "spinning", skip
// only while "picking" with a count left, reroll only once per round, a pick
// that has to come from a year on the board, candidates only for a year on
// the board, results only when complete. It throws `ApiError` with the same
// `detail` shape the backend would, so error handling is exercised end to end.
//
// The round loop it implements is the one in docs/GAME_DESIGN.md §2: a spin
// deals three distinct years, the player may draft from any of them, and the
// round's single reroll trades all three for one year that must then be used.
//
// The season simulation here is a *simplified* stand-in for
// backend/app/engine (the thresholds and emphasis vectors are guesses); only
// the shapes are contractual. The pick-score weights are the real ones, read
// off `SCORED_METRICS` in src/lib/labels.ts, so the mock cannot quietly score
// a metric the backend dropped. Prestige in particular is shown on cards but
// never enters `metric_breakdown` or the score.

import type { Api } from "./client";
import { ApiError } from "./client";
import type {
  BrowseContender,
  CandidatesQuery,
  Category,
  CeremonyResult,
  ClusterSummary,
  Contender,
  CreateGameBody,
  GameResults,
  GameState,
  LeaderboardEntry,
  LeaderboardQuery,
  Meta,
  Mode,
  Pick,
  PickResult,
  RankerSummary,
  SkipKind,
  Spin,
  ValidationReport,
  YearOption,
} from "./types";
import { ARCHETYPES, FIXTURE_YEARS, buildYear, type FixtureContender } from "./mockCatalog";
import {
  BALLOT_SLOTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MODE_LABELS,
  SCORED_METRICS,
  decadeOf,
} from "../lib/labels";

/** Years a spin puts on the board, matching the backend's YEARS_PER_ROUND. */
const YEARS_PER_ROUND = 3;

/* ---- Seeded randomness ------------------------------------------------ */

/** cyrb-style string hash → 32-bit integer seed. */
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 PRNG: tiny, deterministic, good enough for a slot machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Season simulation constants ------------------------------------- */

/** 30 stops on the circuit, early critics' circles → Academy Awards. */
const CEREMONY_NAMES = [
  "New York Film Critics Circle",
  "Los Angeles Film Critics Association",
  "National Board of Review",
  "Boston Society of Film Critics",
  "Chicago Film Critics Association",
  "San Francisco Film Critics Circle",
  "Washington D.C. Area Film Critics",
  "Toronto Film Critics Association",
  "Southeastern Film Critics Association",
  "Florida Film Critics Circle",
  // Two genre bodies, so the horror and comedy slots have ceremonies that
  // actually care about them (docs/GAME_DESIGN.md §4).
  "Saturn Awards",
  "Fangoria Chainsaw Awards",
  "Critics' Choice Awards",
  "Golden Globe Awards",
  "AFI Awards",
  "Satellite Awards",
  "National Society of Film Critics",
  "London Film Critics' Circle",
  "Producers Guild of America",
  "Screen Actors Guild Awards",
  "Directors Guild of America",
  "Writers Guild of America",
  "Art Directors Guild",
  "American Cinema Editors",
  "Costume Designers Guild",
  "Casting Society of America",
  "BAFTA Awards",
  "Independent Spirit Awards",
  "Cinema Audio Society",
  "Academy Awards",
];

/** Convex threshold curve on the 0-800 ballot scale: 280 → ~766. */
function thresholdFor(index: number): number {
  const t = (index - 1) / 29;
  return Math.round(280 + 486 * Math.pow(t, 1.8));
}

/** Emphasis vectors: acting bodies weight actors, guilds weight their craft. */
function emphasisFor(index: number): Record<Category, number> {
  const name = CEREMONY_NAMES[index - 1];
  const base: Record<Category, number> = {
    picture: 1, director: 1, actor: 1, actress: 1, supporting_actor: 1, supporting_actress: 1, horror: 1, comedy: 1,
  };
  if (name.includes("Screen Actors") || name.includes("Casting")) {
    base.actor = 2; base.actress = 2; base.supporting_actor = 1.6; base.supporting_actress = 1.6; base.picture = 0.6; base.director = 0.4;
  } else if (name.includes("Directors Guild")) {
    base.director = 3; base.picture = 1.5;
  } else if (name.includes("Saturn") || name.includes("Fangoria")) {
    // The genre stops are the mirror image of the guilds: they live or die on
    // the two slots the Academy never created.
    base.horror = 3; base.comedy = 2.2; base.director = 0.5; base.supporting_actor = 0.5; base.supporting_actress = 0.5;
  } else if (name.includes("Producers Guild") || name.includes("Editors") || name.includes("Art Directors") || name.includes("Audio") || name.includes("Costume")) {
    base.picture = 2.5; base.director = 1.3;
  } else if (index % 3 === 0) {
    base.actress = 1.4; base.supporting_actress = 1.3; base.comedy = 1.2;
  } else if (index % 3 === 1) {
    base.actor = 1.4; base.supporting_actor = 1.3; base.horror = 1.2;
  }
  return base;
}

/**
 * Pick score weights; renormalised over whatever metrics are non-null.
 *
 * These are the backend's five (backend/app/engine/scoring.py). Prestige is
 * absent on purpose: it is a model estimate, so it is shown on a card and in
 * the reveal but never scored, and it never appears in `metric_breakdown`.
 */
const WEIGHTS: Record<string, number> = Object.fromEntries(
  SCORED_METRICS.map((m) => [m.id, m.weight]),
);

function pickScore(breakdown: Record<string, number | null>): number {
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const v = breakdown[k];
    if (v === null || v === undefined) continue;
    num += w * v;
    den += w;
  }
  return den === 0 ? 0 : Math.round((num / den) * 10) / 10;
}

/* ---- Masking --------------------------------------------------------- */

/**
 * Cinephile mode hides every number. `poster_url` deliberately survives: the
 * poster is identity, not a metric, and picking a film out of a wall of
 * posters is the skill that mode is testing (docs/API.md, `Contender`).
 */
function maskForMode(c: Contender, mode: Mode): Contender {
  if (mode === "classic") return c;
  return {
    ...c,
    archetype: null,
    metrics: { audience: null, critics: null, popularity: null, box_office: null, prestige: null },
    stats: { imdb_rating: null, imdb_votes: null, box_office_usd: null, box_office_est_usd: null, budget_usd: null, rt_critic: null, rt_audience: null, metascore: null },
    career: { prior_nominations: 0, prior_wins: 0, billing: null },
  };
}

/* ======================================================================= *
 * Game-mode menu + Six Degrees                                            *
 *                                                                         *
 * One contiguous block, module level, so the Oscars mock above is left     *
 * exactly as it was. Everything here is pure data plus pure functions; the *
 * per-round state lives inside `createMockApi` with the Oscars games.      *
 *                                                                         *
 * The board                                                               *
 * ---------                                                               *
 * The real backend *searches* for a board: it walks the co-star graph      *
 * looking for three rows and three columns where no pair has worked        *
 * together and every intersection has several actors in common             *
 * (backend/app/engine/grid.py, `build_board`). A fixture has no graph to   *
 * walk, so the board below is hand-built to the same guarantees, which     *
 * are listed on `GRID_CONNECTORS`.                                        *
 *                                                                         *
 * Every credit asserted here is real. That matters more in this mode than  *
 * it looks: the reveal shows the two films that prove a connection, so a   *
 * chain the fixture invented would teach a player something false. The     *
 * lists are a hand-picked slice of real filmographies, ordered best-known  *
 * first the way the engine orders them; they are not exhaustive and are    *
 * not claimed to be.                                                      *
 * ======================================================================= */

import type {
  ActorCard,
  FilmCard,
  GridAnswerBody,
  GridCell,
  GridCellResult,
  GridHint,
  GridHintBody,
  GridLink,
  GridResults,
  GridState,
  ModeCard,
} from "./types";

/** Board size and clock, matching GRID_SIZE / ROUND_SECONDS in the engine. */
const GRID_SIZE = 3;
const GRID_ROUND_SECONDS = 180;

/**
 * Floor for a correct answer, matching `MIN_CELL_SCORE` in the engine.
 * Naming any genuine collaboration is worth most of the marks; the ranking
 * separates a good answer from the best one rather than deciding the round.
 */
const GRID_MIN_CELL_SCORE = 60;

/**
 * What a cell is docked once hints have been taken on it, indexed by how
 * many. Mirrors `HINT_COSTS` in the engine.
 *
 * A cell has two sides, so there are two hints and three states. The costs
 * rise faster than they need to: one hint is a fair trade when a player
 * already has half the answer, two is meant to feel like giving up on the
 * cell. Both hints plus the obvious connector leaves 25 of a possible 100,
 * which is worth more than an empty square and much less than solving it.
 */
const GRID_HINT_COSTS: readonly number[] = [0, 15, 35];

interface GridFixtureFilm {
  film_id: string; // IMDb-style tconst
  title: string;
  year: number;
  genres: string[];
}

/**
 * The mock film catalog, keyed by a short alias so the link table below reads
 * as a list of films rather than a list of ids.
 *
 * These are only the films needed to *prove* the connections on this board:
 * two per connector, one to each side of the cell they answer. Every pairing
 * asserted here is a real credit; the point of the reveal is that the chain
 * can be checked, so a fixture that invented one would be worse than useless.
 */
const GRID_FILMS: Record<string, GridFixtureFilm> = {
  // Working Girl earns its keep: Sigourney Weaver and Harrison Ford are both
  // in it, so it proves one side of four different connectors on this board.
  workingGirl: { film_id: "tt0096463", title: "Working Girl", year: 1988, genres: ["Comedy", "Drama", "Romance"] },

  // Sigourney Weaver
  aliens: { film_id: "tt0090605", title: "Aliens", year: 1986, genres: ["Action", "Sci-Fi"] },
  galaxyQuest: { film_id: "tt0177789", title: "Galaxy Quest", year: 1999, genres: ["Adventure", "Comedy", "Sci-Fi"] },
  ghostbusters: { film_id: "tt0087332", title: "Ghostbusters", year: 1984, genres: ["Comedy", "Fantasy"] },
  cabinInTheWoods: { film_id: "tt1259521", title: "The Cabin in the Woods", year: 2011, genres: ["Horror", "Mystery"] },
  alienResurrection: { film_id: "tt0118583", title: "Alien Resurrection", year: 1997, genres: ["Action", "Horror", "Sci-Fi"] },
  paul: { film_id: "tt1092026", title: "Paul", year: 2011, genres: ["Adventure", "Comedy", "Sci-Fi"] },

  // Harrison Ford
  bladeRunner2049: { film_id: "tt1856101", title: "Blade Runner 2049", year: 2017, genres: ["Action", "Drama", "Sci-Fi"] },
  cowboysAndAliens: { film_id: "tt0409847", title: "Cowboys & Aliens", year: 2011, genres: ["Action", "Sci-Fi", "Western"] },
  morningGlory: { film_id: "tt1126618", title: "Morning Glory", year: 2010, genres: ["Comedy", "Drama", "Romance"] },
  airForceOne: { film_id: "tt0118571", title: "Air Force One", year: 1997, genres: ["Action", "Drama", "Thriller"] },
  theDevilsOwn: { film_id: "tt0118972", title: "The Devil's Own", year: 1997, genres: ["Action", "Crime", "Drama"] },

  // Nicole Kidman
  theHours: { film_id: "tt0274558", title: "The Hours", year: 2002, genres: ["Drama"] },
  coldMountain: { film_id: "tt0159365", title: "Cold Mountain", year: 2003, genres: ["Adventure", "Drama", "History"] },
  theRailwayMan: { film_id: "tt2058673", title: "The Railway Man", year: 2013, genres: ["Biography", "Drama"] },
  theNorthman: { film_id: "tt11138512", title: "The Northman", year: 2022, genres: ["Action", "Adventure", "Drama"] },
  theInterpreter: { film_id: "tt0373926", title: "The Interpreter", year: 2005, genres: ["Crime", "Drama", "Mystery"] },
  myLife: { film_id: "tt0107630", title: "My Life", year: 1993, genres: ["Drama"] },
  malice: { film_id: "tt0107476", title: "Malice", year: 1993, genres: ["Mystery", "Thriller"] },
  daysOfThunder: { film_id: "tt0099371", title: "Days of Thunder", year: 1990, genres: ["Action", "Drama", "Sport"] },

  // Tom Hanks
  apollo13: { film_id: "tt0112384", title: "Apollo 13", year: 1995, genres: ["Adventure", "Drama", "History"] },
  toyStory: { film_id: "tt0114709", title: "Toy Story", year: 1995, genres: ["Animation", "Adventure", "Comedy"] },
  toyStory2: { film_id: "tt0120363", title: "Toy Story 2", year: 1999, genres: ["Animation", "Adventure", "Comedy"] },
  bonfire: { film_id: "tt0099165", title: "The Bonfire of the Vanities", year: 1990, genres: ["Comedy", "Drama"] },
  roadToPerdition: { film_id: "tt0257044", title: "Road to Perdition", year: 2002, genres: ["Crime", "Drama", "Thriller"] },
  thePost: { film_id: "tt6294822", title: "The Post", year: 2017, genres: ["Biography", "Drama", "History"] },
  charlieWilson: { film_id: "tt0472062", title: "Charlie Wilson's War", year: 2007, genres: ["Biography", "Comedy", "Drama"] },

  // Emma Stone
  zombieland: { film_id: "tt1156398", title: "Zombieland", year: 2009, genres: ["Adventure", "Comedy", "Horror"] },
  aloha: { film_id: "tt1735898", title: "Aloha", year: 2015, genres: ["Comedy", "Drama", "Romance"] },
  superbad: { film_id: "tt0829482", title: "Superbad", year: 2007, genres: ["Comedy"] },
  laLaLand: { film_id: "tt3783958", title: "La La Land", year: 2016, genres: ["Comedy", "Drama", "Music"] },
  magicInTheMoonlight: { film_id: "tt3079380", title: "Magic in the Moonlight", year: 2014, genres: ["Comedy", "Drama", "Romance"] },
  poorThings: { film_id: "tt14230388", title: "Poor Things", year: 2023, genres: ["Comedy", "Drama", "Romance"] },
  gangsterSquad: { film_id: "tt1321870", title: "Gangster Squad", year: 2013, genres: ["Action", "Crime", "Drama"] },
  birdman: { film_id: "tt2562232", title: "Birdman", year: 2014, genres: ["Comedy", "Drama"] },

  // Anthony Hopkins
  thor: { film_id: "tt0800369", title: "Thor", year: 2011, genres: ["Action", "Adventure", "Fantasy"] },
  dracula: { film_id: "tt0103874", title: "Bram Stoker's Dracula", year: 1992, genres: ["Drama", "Fantasy", "Horror"] },
  theEdge: { film_id: "tt0119051", title: "The Edge", year: 1997, genres: ["Adventure", "Drama", "Thriller"] },
  hannibal: { film_id: "tt0212985", title: "Hannibal", year: 2001, genres: ["Crime", "Drama", "Thriller"] },
  meetJoeBlack: { film_id: "tt0119643", title: "Meet Joe Black", year: 1998, genres: ["Drama", "Fantasy", "Romance"] },
  fracture: { film_id: "tt0488120", title: "Fracture", year: 2007, genres: ["Crime", "Drama", "Mystery"] },
  nixon: { film_id: "tt0113987", title: "Nixon", year: 1995, genres: ["Biography", "Drama", "History"] },
};

/**
 * Every actor the mock roster knows, as a terse tuple so the table stays
 * readable: id, name, credits, first year, last year, lead share, genres,
 * casting type.
 *
 * The last block is deliberately unreachable. Those actors connect nobody on
 * this board, so searching for one and naming it is how a player (and a test)
 * meets the "that actor does not connect those two" rejection. The six board
 * headers are searchable for the same reason: naming one of them must be
 * refused, because a header is never its own cell's answer.
 */
type GridActorTuple = [string, string, number, number, number, number, string[], string];

const GRID_ACTOR_TUPLES: GridActorTuple[] = [
  // -- the six on the board --------------------------------------------
  ["nm0000244", "Sigourney Weaver", 78, 1977, 2024, 0.68, ["Sci-Fi", "Drama", "Comedy"], "Marquee Lead"],
  ["nm0000148", "Harrison Ford", 71, 1966, 2024, 0.74, ["Action", "Adventure", "Sci-Fi"], "Marquee Lead"],
  ["nm0000173", "Nicole Kidman", 89, 1983, 2024, 0.77, ["Drama", "Thriller", "Romance"], "Prestige Lead"],
  ["nm0000158", "Tom Hanks", 96, 1980, 2024, 0.81, ["Drama", "Comedy", "History"], "Marquee Lead"],
  ["nm1297015", "Emma Stone", 44, 2007, 2024, 0.73, ["Comedy", "Drama", "Romance"], "Prestige Lead"],
  ["nm0000164", "Anthony Hopkins", 132, 1967, 2024, 0.52, ["Drama", "Thriller", "Crime"], "Prestige Character Lead"],

  // -- the connectors ---------------------------------------------------
  ["nm0000200", "Bill Paxton", 88, 1975, 2017, 0.31, ["Action", "Drama", "Thriller"], "Working Character Actor"],
  ["nm0000741", "Tim Allen", 41, 1988, 2023, 0.66, ["Comedy", "Animation", "Family"], "Comic Lead"],
  ["nm0000350", "Joan Cusack", 55, 1980, 2022, 0.18, ["Comedy", "Drama", "Animation"], "Working Character Actor"],
  ["nm0000195", "Bill Murray", 91, 1975, 2024, 0.57, ["Comedy", "Drama"], "Comic Lead"],
  ["nm0000285", "Alec Baldwin", 118, 1984, 2023, 0.39, ["Drama", "Comedy", "Thriller"], "Working Character Actor"],
  ["nm0736622", "Seth Rogen", 73, 2001, 2024, 0.54, ["Comedy", "Animation", "Adventure"], "Comic Lead"],
  ["nm1165110", "Chris Hemsworth", 42, 2005, 2024, 0.69, ["Action", "Adventure", "Sci-Fi"], "Franchise Lead"],
  ["nm0000213", "Winona Ryder", 57, 1986, 2024, 0.61, ["Drama", "Fantasy", "Romance"], "Prestige Lead"],
  ["nm0000463", "Melanie Griffith", 62, 1969, 2019, 0.52, ["Drama", "Comedy", "Romance"], "Prestige Lead"],
  ["nm0185819", "Daniel Craig", 52, 1992, 2024, 0.63, ["Action", "Thriller", "Drama"], "Franchise Lead"],
  ["nm0331516", "Ryan Gosling", 45, 1996, 2024, 0.72, ["Drama", "Romance", "Thriller"], "Prestige Lead"],
  ["nm0005351", "Rachel McAdams", 38, 2001, 2024, 0.65, ["Romance", "Drama", "Comedy"], "Prestige Lead"],
  ["nm0000093", "Brad Pitt", 84, 1987, 2024, 0.70, ["Drama", "Action", "Crime"], "Marquee Lead"],
  ["nm0000198", "Gary Oldman", 96, 1982, 2024, 0.41, ["Drama", "Crime", "Thriller"], "Prestige Character Lead"],
  ["nm0000658", "Meryl Streep", 94, 1977, 2024, 0.78, ["Drama", "Comedy", "Romance"], "Prestige Lead"],
  ["nm0000438", "Ed Harris", 91, 1978, 2024, 0.44, ["Drama", "Thriller", "History"], "Prestige Character Lead"],
  ["nm0000179", "Jude Law", 71, 1989, 2024, 0.58, ["Drama", "Thriller", "Adventure"], "Prestige Lead"],
  ["nm0000450", "Philip Seymour Hoffman", 63, 1991, 2014, 0.33, ["Drama", "Comedy", "Crime"], "Prestige Character Lead"],
  ["nm0000353", "Willem Dafoe", 137, 1980, 2024, 0.35, ["Drama", "Thriller", "Crime"], "Working Character Actor"],
  ["nm0000576", "Sean Penn", 65, 1981, 2023, 0.62, ["Drama", "Crime", "Thriller"], "Prestige Lead"],
  ["nm0000474", "Michael Keaton", 68, 1982, 2024, 0.64, ["Comedy", "Drama", "Action"], "Marquee Lead"],
  ["nm0000147", "Colin Firth", 79, 1984, 2024, 0.60, ["Drama", "Romance", "Comedy"], "Prestige Lead"],
  ["nm0000194", "Julianne Moore", 88, 1990, 2024, 0.66, ["Drama", "Thriller", "Romance"], "Prestige Lead"],
  ["nm0000144", "Cary Elwes", 94, 1984, 2024, 0.29, ["Adventure", "Comedy", "Horror"], "Working Character Actor"],

  // -- valid for nobody on this board -----------------------------------
  ["nm0000243", "Denzel Washington", 58, 1977, 2024, 0.83, ["Drama", "Crime", "Thriller"], "Marquee Lead"],
  ["nm0000210", "Julia Roberts", 60, 1987, 2024, 0.79, ["Romance", "Comedy", "Drama"], "Marquee Lead"],
  ["nm0000008", "Marlon Brando", 40, 1950, 2001, 0.75, ["Drama", "Crime"], "Marquee Lead"],
  ["nm0000030", "Audrey Hepburn", 31, 1948, 1989, 0.80, ["Romance", "Comedy", "Drama"], "Marquee Lead"],
];

const GRID_ACTORS: Record<string, ActorCard> = Object.fromEntries(
  GRID_ACTOR_TUPLES.map(([id, name, nFilms, first, last, leadShare, genres, castingType]) => [
    id,
    {
      person_id: id,
      name,
      n_films: nFilms,
      first_year: first,
      last_year: last,
      lead_share: leadShare,
      top_genres: [...genres],
      casting_type: castingType,
    },
  ]),
);

/** Look an actor up by name, so the link table below reads as names. */
const GRID_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  GRID_ACTOR_TUPLES.map(([id, name]) => [name, id]),
);

/** Three actors down the side of the board. */
const GRID_ROW_ACTORS: ActorCard[] = ["Sigourney Weaver", "Harrison Ford", "Nicole Kidman"].map(
  (name) => GRID_ACTORS[GRID_ID_BY_NAME[name]],
);

/** Three actors across the top. */
const GRID_COLUMN_ACTORS: ActorCard[] = ["Tom Hanks", "Emma Stone", "Anthony Hopkins"].map(
  (name) => GRID_ACTORS[GRID_ID_BY_NAME[name]],
);

/**
 * One valid answer: the connector, and the two films that prove it.
 *
 * `links` is ordered the way the reveal reads it: the film shared with the
 * *row* actor first, then the film shared with the *column* actor.
 */
interface GridConnector {
  name: string;
  links: [string, string];
}

/**
 * `[row][column]` → the actors who connect that pair, best known first.
 *
 * Best-first is what the cell score reads: index 0 is worth 100 and the last
 * entry is worth `GRID_MIN_CELL_SCORE`. It is also the single name the reveal
 * shows, which is why the ordering is a judgement about fame rather than an
 * arbitrary sort.
 *
 * The board is hand-built where the backend searches a graph, but it is built
 * to the same guarantees:
 *
 *   1. no row/column pair has ever worked together, so no cell answers itself;
 *   2. every cell has at least three connectors, matching `MIN_CONNECTORS`;
 *   3. the nine *last* entries are nine different people, matching
 *      `rarest_are_distinct`: since a connector may only be played once, a
 *      repeat would put a perfect 900 out of reach through no fault of the
 *      player;
 *   4. the nine *first* entries are nine different people too, so the board
 *      does not play as one question asked repeatedly;
 *   5. actors exist who connect nobody here, so the rejection the whole mode
 *      is built on is reachable in mock mode and in the tests.
 */
const GRID_CONNECTORS: GridConnector[][][] = [
  // Sigourney Weaver × Hanks / Stone / Hopkins
  [
    [
      { name: "Tim Allen", links: ["galaxyQuest", "toyStory"] },
      { name: "Bill Paxton", links: ["aliens", "apollo13"] },
      { name: "Joan Cusack", links: ["workingGirl", "toyStory2"] },
    ],
    [
      { name: "Bill Murray", links: ["ghostbusters", "zombieland"] },
      { name: "Alec Baldwin", links: ["workingGirl", "aloha"] },
      { name: "Seth Rogen", links: ["paul", "superbad"] },
    ],
    [
      { name: "Chris Hemsworth", links: ["cabinInTheWoods", "thor"] },
      { name: "Alec Baldwin", links: ["workingGirl", "theEdge"] },
      { name: "Winona Ryder", links: ["alienResurrection", "dracula"] },
    ],
  ],
  // Harrison Ford × Hanks / Stone / Hopkins
  [
    [
      { name: "Daniel Craig", links: ["cowboysAndAliens", "roadToPerdition"] },
      { name: "Joan Cusack", links: ["workingGirl", "toyStory2"] },
      { name: "Melanie Griffith", links: ["workingGirl", "bonfire"] },
    ],
    [
      { name: "Ryan Gosling", links: ["bladeRunner2049", "laLaLand"] },
      { name: "Alec Baldwin", links: ["workingGirl", "aloha"] },
      { name: "Rachel McAdams", links: ["morningGlory", "aloha"] },
    ],
    [
      { name: "Brad Pitt", links: ["theDevilsOwn", "meetJoeBlack"] },
      { name: "Ryan Gosling", links: ["bladeRunner2049", "fracture"] },
      { name: "Gary Oldman", links: ["airForceOne", "hannibal"] },
      { name: "Alec Baldwin", links: ["workingGirl", "theEdge"] },
    ],
  ],
  // Nicole Kidman × Hanks / Stone / Hopkins
  [
    [
      { name: "Meryl Streep", links: ["theHours", "thePost"] },
      { name: "Jude Law", links: ["coldMountain", "roadToPerdition"] },
      { name: "Ed Harris", links: ["theHours", "apollo13"] },
      { name: "Philip Seymour Hoffman", links: ["coldMountain", "charlieWilson"] },
    ],
    [
      { name: "Sean Penn", links: ["theInterpreter", "gangsterSquad"] },
      { name: "Michael Keaton", links: ["myLife", "birdman"] },
      { name: "Willem Dafoe", links: ["theNorthman", "poorThings"] },
      { name: "Colin Firth", links: ["theRailwayMan", "magicInTheMoonlight"] },
    ],
    [
      { name: "Julianne Moore", links: ["theHours", "hannibal"] },
      { name: "Alec Baldwin", links: ["malice", "theEdge"] },
      { name: "Ed Harris", links: ["theHours", "nixon"] },
      { name: "Cary Elwes", links: ["daysOfThunder", "dracula"] },
    ],
  ],
];

/**
 * A stand-in for the TMDB `w342` poster the real API returns.
 *
 * The Oscars fixture has its own version of this (src/api/mockCatalog.ts) but
 * does not export it, and that file is not the grid's to edit, so this is a
 * deliberately smaller sibling: same field, same 2:3 aspect ratio, same
 * offline-safe SVG data URI, sized for a thumbnail rather than a card.
 *
 * One film keeps a null poster on purpose, so the fallback plate in
 * src/components/grid/FilmPoster.tsx is on screen in mock mode rather than
 * only in a unit test.
 */
function gridPoster(film: GridFixtureFilm): string | null {
  if (film.film_id === GRID_FILMS.malice.film_id) return null;
  // A hue per film, drawn from the whole circle: the chrome is cool and the
  // artwork is meant to be the colour in the room.
  let hue = 0;
  for (const ch of film.film_id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='228' height='342'>` +
    `<rect width='228' height='342' fill='hsl(${hue} 24% 10%)'/>` +
    `<rect x='8' y='8' width='212' height='326' fill='none' stroke='hsl(${hue} 55% 55%)' stroke-opacity='0.5'/>` +
    `<text x='114' y='176' fill='hsl(${hue} 60% 70%)' font-family='Georgia,serif' font-size='22' text-anchor='middle'>${film.year}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A fixture film on the wire. */
function gridFilmCard(alias: string): FilmCard {
  const film = GRID_FILMS[alias];
  return {
    film_id: film.film_id,
    title: film.title,
    year: film.year,
    poster_url: gridPoster(film),
    genres: [...film.genres],
  };
}

/** A cell's connectors as bare person ids, best known first. */
function gridConnectorIds(row: number, column: number): string[] {
  return GRID_CONNECTORS[row][column].map((c) => GRID_ID_BY_NAME[c.name]);
}

/**
 * Score a correct answer 0-100 by how *obscure* the connector is.
 *
 * Mirrors `score_answer` in the engine. A cell's connectors are ordered
 * best-known first and the scale runs against that order: the obvious route
 * pays the floor, the deepest cut pays 100. A cell with one connector scores
 * 100, because the only route through is also the rarest.
 */
function gridScoreFor(ids: string[], personId: string): number {
  if (ids.length === 1) return 100;
  const share = ids.indexOf(personId) / (ids.length - 1);
  return Math.round((GRID_MIN_CELL_SCORE + (100 - GRID_MIN_CELL_SCORE) * share) * 100) / 100;
}

/**
 * One route through a cell, as the wire carries it: who, the proof, the score.
 *
 * `score` overrides what the scale says, and a *played* link always passes it:
 * the stored figure is already net of the cell's hints, and recomputing it
 * here would quietly hand those points back. The reveal's obvious and rarest
 * routes pass nothing, because they are what the cell was worth rather than
 * what anybody scored on it.
 */
function gridLink(row: number, column: number, personId: string, score?: number): GridLink {
  const connector = GRID_CONNECTORS[row][column].find(
    (c) => GRID_ID_BY_NAME[c.name] === personId,
  )!;
  return {
    actor: structuredClone(GRID_ACTORS[personId]),
    films: connector.links.map(gridFilmCard),
    score: score ?? gridScoreFor(gridConnectorIds(row, column), personId),
  };
}

/**
 * The film a hint reveals for one side of a cell, mirroring `hint_film` in
 * the engine.
 *
 * Always the *first* connector on the cell's list. That list is ordered
 * best-known first, so index 0 is the lowest-scoring route through, and it is
 * the only one a hint may give away: a player who pays for a hint and is
 * handed the 100-point name has not been helped, they have been given the
 * cell. `links` reads row film first, column film second, so the side picks
 * the index.
 */
function gridHintFilm(row: number, column: number, side: "row" | "column"): FilmCard {
  const obvious = GRID_CONNECTORS[row][column][0];
  return gridFilmCard(side === "row" ? obvious.links[0] : obvious.links[1]);
}

/** What a cell is docked for the hints already taken on it. */
function gridHintPenalty(taken: number): number {
  return GRID_HINT_COSTS[Math.min(taken, GRID_HINT_COSTS.length - 1)];
}

/**
 * Turn a typed name into a person id, mirroring `resolve_actor` on the server
 * (backend/app/data/people.py).
 *
 * The mode has no autocomplete, since a list of matching actors is a list of
 * the cell's answers. The player types the whole name and the spelling is
 * forgiven instead. Three passes, strictest first: exact once case, accents
 * and punctuation are normalised away; then every word typed appearing in the
 * real name, which covers a dropped middle initial; then a similarity ratio,
 * which covers a slip of the fingers.
 *
 * Ambiguity is refused rather than guessed at, because silently picking the
 * more famous of two people who share a surname would score a cell the player
 * did not answer.
 */
function gridNormalise(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Similarity of two strings, 0-1, by the size of their common subsequence. */
function gridSimilarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  // Longest common subsequence over the mean length: cheap, dependency-free,
  // and close enough to the server's ratio for a fixture.
  const rows: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  return (2 * rows[a.length][b.length]) / (a.length + b.length);
}

/** Matches `_FUZZY_THRESHOLD` in backend/app/data/people.py. */
const GRID_FUZZY_THRESHOLD = 0.86;

function gridResolveActor(typed: string): { personId: string | null; ambiguous: boolean } {
  const needle = gridNormalise(typed);
  if (!needle) return { personId: null, ambiguous: false };

  const exact = GRID_ACTOR_TUPLES.filter(([, name]) => gridNormalise(name) === needle);
  if (exact.length) return { personId: exact[0][0], ambiguous: false };

  const words = needle.split(" ");
  const subset = GRID_ACTOR_TUPLES.filter(([, name]) => {
    const theirs = new Set(gridNormalise(name).split(" "));
    return words.every((w) => theirs.has(w));
  });
  if (subset.length === 1) return { personId: subset[0][0], ambiguous: false };
  if (subset.length > 1) return { personId: null, ambiguous: true };

  const scored = GRID_ACTOR_TUPLES.map(
    ([id, name]) => [gridSimilarity(needle, gridNormalise(name)), id] as const,
  ).filter(([score]) => score >= GRID_FUZZY_THRESHOLD);
  if (!scored.length) return { personId: null, ambiguous: false };
  const best = Math.max(...scored.map(([score]) => score));
  const closest = scored.filter(([score]) => score >= best - 1e-9);
  return closest.length === 1
    ? { personId: closest[0][1], ambiguous: false }
    : { personId: null, ambiguous: true };
}

/** A round in progress. Only the answers are stored; the board is a constant. */
interface MockGridRound {
  id: string;
  seed: string | null;
  startedAt: number; // epoch ms
  createdAt: string;
  /** "row,column" → the connector named there and what it scored. */
  answers: Map<string, { personId: string; score: number }>;
  /**
   * "row,column" → the sides hinted, in the order they were taken.
   *
   * Stored rather than derived, exactly as the backend stores it: which sides
   * were bought is a decision the player made, and the cell's score has to
   * remember it was paid for.
   */
  hints: Map<string, ("row" | "column")[]>;
  handedIn: boolean;
}

/* ======================================================================= *
 * Recast                                                                  *
 *                                                                         *
 * A second contiguous module-level block, appended after the grid's for    *
 * the same reason: nothing above it moves. Pure data plus pure functions;  *
 * a round's state lives inside `createMockApi` with the others.            *
 *                                                                         *
 * What is faithful and what is a fixture                                   *
 * -------------------------------------                                    *
 * The *maths* here is the engine's, not an approximation of it: the four   *
 * components, their weights, the stature and era tolerances and the        *
 * lead-share target a role is scored against are all copied from           *
 * backend/app/engine/recast.py. That matters more than it looks. The       *
 * whole mode is a scoring argument, and a mock that scored differently     *
 * would let the UI grow around numbers nobody serves.                      *
 *                                                                         *
 * What is invented is the *catalog*: one film, four roles, and three small *
 * casting types hand-built to stand in for the k-means clusters over the   *
 * real actor table (docs/GAME_DESIGN.md §8). Two properties of the real    *
 * shortlist survive the shrinking, and they are the ones worth testing:    *
 *                                                                         *
 *   1. a shortlist is drawn from the *original actor's casting type*, so   *
 *      everyone offered plausibly does that kind of work;                  *
 *   2. it never offers the original, and never offers anyone already cast. *
 *      This is why the film's two lead roles deliberately share one        *
 *      casting type. Cast someone in the first and they are gone from the  *
 *      second, and that exclusion is reachable in mock mode and in a test  *
 *      rather than only against a real database.                           *
 *                                                                         *
 * The clusters here hold seven to nine actors where the real ones hold     *
 * hundreds, so every shortlist comes back under `RECAST_SHORTLIST` and the *
 * engine's "return the whole cluster" branch is the one that runs. No      *
 * sampling, and therefore no shuffle, which is also why these shortlists   *
 * are stable across reloads without needing a seeded stream.               *
 * ======================================================================= */

import type {
  CastingResult,
  FitBreakdown,
  RecastResults,
  RecastState,
  RoleCard,
} from "./types";

/** Shortlist size, matching `SHORTLIST` in the engine. */
const RECAST_SHORTLIST = 18;

/** Billing at or above which a part counts as a lead (`LEAD_BILLING`). */
const RECAST_LEAD_BILLING = 2;

/** How the four components blend into one fit score (`FIT_WEIGHTS`). */
const FIT_WEIGHTS: Record<keyof FitBreakdown, number> = {
  stature: 0.35,
  role_fit: 0.3,
  genre: 0.2,
  era: 0.15,
};

/**
 * Reach difference, in log-votes, at which stature scores zero
 * (`STATURE_TOLERANCE`). Roughly two orders of magnitude of audience.
 */
const STATURE_TOLERANCE = 4;

/** Years apart at which the era term scores zero (`ERA_TOLERANCE`). */
const ERA_TOLERANCE = 40;

/**
 * An actor in the fixture: everything the wire carries, plus the one signal
 * it does not.
 *
 * `fame` is the engine's reach term, the log of a vote count, and it is
 * deliberately *not* part of `ActorCard`, because it is an input to the
 * score rather than something the player is shown. Keeping it here, off the
 * wire, is what stops the UI from quietly inventing a stature bar of its own.
 */
interface RecastFixtureActor extends ActorCard {
  /** Reach, as log votes: roughly 11 for a character player, 14 for a star. */
  fame: number;
}

/**
 * The casting types this fixture knows about, each a hand-built stand-in for
 * one k-means cluster. The label on an actor's `casting_type` is what points
 * at their pool, exactly as `cluster_id` does in the backend.
 */
const RECAST_CLUSTERS: Record<string, RecastFixtureActor[]> = {
  // The two leads of the fixture film both live here, which is what makes the
  // "already cast" exclusion visible after a single pick.
  "Marquee Lead": [
    { person_id: "nm0000134", name: "Robert De Niro", n_films: 41, first_year: 1973, last_year: 2023, lead_share: 0.73, top_genres: ["Crime", "Drama", "Comedy"], casting_type: "Marquee Lead", fame: 13.7 },
    { person_id: "nm0000199", name: "Al Pacino", n_films: 34, first_year: 1972, last_year: 2019, lead_share: 0.79, top_genres: ["Crime", "Drama", "Thriller"], casting_type: "Marquee Lead", fame: 13.6 },
    { person_id: "nm0000158", name: "Tom Hanks", n_films: 36, first_year: 1984, last_year: 2022, lead_share: 0.86, top_genres: ["Drama", "Comedy", "Adventure"], casting_type: "Marquee Lead", fame: 13.9 },
    { person_id: "nm0000148", name: "Harrison Ford", n_films: 33, first_year: 1977, last_year: 2023, lead_share: 0.81, top_genres: ["Action", "Adventure", "Sci-Fi"], casting_type: "Marquee Lead", fame: 13.8 },
    { person_id: "nm0000243", name: "Denzel Washington", n_films: 30, first_year: 1987, last_year: 2021, lead_share: 0.83, top_genres: ["Drama", "Crime", "Thriller"], casting_type: "Marquee Lead", fame: 13.4 },
    { person_id: "nm0000658", name: "Meryl Streep", n_films: 38, first_year: 1978, last_year: 2021, lead_share: 0.74, top_genres: ["Drama", "Comedy", "Romance"], casting_type: "Marquee Lead", fame: 13.3 },
    { person_id: "nm0000197", name: "Jack Nicholson", n_films: 31, first_year: 1969, last_year: 2010, lead_share: 0.77, top_genres: ["Drama", "Comedy", "Crime"], casting_type: "Marquee Lead", fame: 13.2 },
    { person_id: "nm0000244", name: "Sigourney Weaver", n_films: 27, first_year: 1979, last_year: 2022, lead_share: 0.62, top_genres: ["Sci-Fi", "Drama", "Action"], casting_type: "Marquee Lead", fame: 12.9 },
    { person_id: "nm0000198", name: "Gary Oldman", n_films: 32, first_year: 1986, last_year: 2022, lead_share: 0.48, top_genres: ["Drama", "Crime", "Action"], casting_type: "Marquee Lead", fame: 13.1 },
  ],
  "Leading Player": [
    { person_id: "nm0000174", name: "Val Kilmer", n_films: 24, first_year: 1984, last_year: 2021, lead_share: 0.54, top_genres: ["Action", "Drama", "Crime"], casting_type: "Leading Player", fame: 12.3 },
    { person_id: "nm0000126", name: "Kevin Costner", n_films: 28, first_year: 1985, last_year: 2022, lead_share: 0.71, top_genres: ["Drama", "Western", "Action"], casting_type: "Leading Player", fame: 12.5 },
    { person_id: "nm0000412", name: "Andy García", n_films: 22, first_year: 1986, last_year: 2022, lead_share: 0.5, top_genres: ["Crime", "Drama", "Thriller"], casting_type: "Leading Player", fame: 11.9 },
    { person_id: "nm0001557", name: "Viggo Mortensen", n_films: 26, first_year: 1985, last_year: 2022, lead_share: 0.58, top_genres: ["Drama", "Adventure", "Thriller"], casting_type: "Leading Player", fame: 12.4 },
    { person_id: "nm0000982", name: "Josh Brolin", n_films: 25, first_year: 1985, last_year: 2023, lead_share: 0.41, top_genres: ["Crime", "Drama", "Action"], casting_type: "Leading Player", fame: 12.2 },
    { person_id: "nm0000204", name: "Natalie Portman", n_films: 23, first_year: 1994, last_year: 2022, lead_share: 0.69, top_genres: ["Drama", "Action", "Adventure"], casting_type: "Leading Player", fame: 12.9 },
    { person_id: "nm0001497", name: "Tobey Maguire", n_films: 18, first_year: 1993, last_year: 2013, lead_share: 0.75, top_genres: ["Drama", "Action", "Adventure"], casting_type: "Leading Player", fame: 12.6 },
  ],
  "Working Actor": [
    { person_id: "nm0000685", name: "Jon Voight", n_films: 29, first_year: 1969, last_year: 2021, lead_share: 0.33, top_genres: ["Drama", "Crime", "Action"], casting_type: "Working Actor", fame: 11.6 },
    { person_id: "nm0000353", name: "Willem Dafoe", n_films: 32, first_year: 1985, last_year: 2024, lead_share: 0.28, top_genres: ["Drama", "Crime", "Action"], casting_type: "Working Actor", fame: 12.2 },
    { person_id: "nm0000663", name: "Stellan Skarsgård", n_films: 27, first_year: 1982, last_year: 2023, lead_share: 0.19, top_genres: ["Drama", "Thriller", "Adventure"], casting_type: "Working Actor", fame: 11.8 },
    { person_id: "nm0177933", name: "Chris Cooper", n_films: 21, first_year: 1987, last_year: 2019, lead_share: 0.16, top_genres: ["Drama", "Crime", "Thriller"], casting_type: "Working Actor", fame: 11.4 },
    { person_id: "nm0005049", name: "Allison Janney", n_films: 19, first_year: 1994, last_year: 2023, lead_share: 0.11, top_genres: ["Drama", "Comedy", "Crime"], casting_type: "Working Actor", fame: 11.2 },
    { person_id: "nm0000732", name: "Danny Aiello", n_films: 20, first_year: 1973, last_year: 2019, lead_share: 0.29, top_genres: ["Drama", "Crime", "Comedy"], casting_type: "Working Actor", fame: 11 },
    { person_id: "nm0740535", name: "Stephen Root", n_films: 22, first_year: 1989, last_year: 2022, lead_share: 0.05, top_genres: ["Comedy", "Drama", "Crime"], casting_type: "Working Actor", fame: 10.9 },
  ],
};

/** Every fixture actor by id, across all three casting types. */
const RECAST_ACTORS: Record<string, RecastFixtureActor> = Object.fromEntries(
  Object.values(RECAST_CLUSTERS).flatMap((members) => members.map((a) => [a.person_id, a] as const)),
);

/**
 * The film being recast.
 *
 * Typed structurally as the grid's fixture film so it can borrow that block's
 * poster helper: the two side modes send the same `FilmCard`, so they should
 * not grow two different ideas of what a missing poster looks like.
 */
const RECAST_FILM: GridFixtureFilm = {
  film_id: "tt0113277",
  title: "Heat",
  year: 1995,
  genres: ["Action", "Crime", "Drama"],
};

/** One part of the fixture film. `is_lead` is derived, never stored twice. */
interface RecastFixtureRole {
  billing: number;
  character: string;
  /** Whoever actually played it: the head of the shortlist's casting type. */
  personId: string;
}

/**
 * Four roles in billing order, inside the engine's 3-5 range.
 *
 * Billing 1 and 2 are the leads (`RECAST_LEAD_BILLING`) and both come from
 * the Marquee Lead pool; the two supporting parts come from a different pool
 * each, so a round exercises three casting types and one cross-role
 * exclusion.
 */
const RECAST_ROLES: RecastFixtureRole[] = [
  { billing: 1, character: "Neil McCauley", personId: "nm0000134" },
  { billing: 2, character: "Vincent Hanna", personId: "nm0000199" },
  { billing: 3, character: "Chris Shiherlis", personId: "nm0000174" },
  { billing: 4, character: "Nate", personId: "nm0000685" },
];

/** A part counts as a lead by its billing, exactly as the engine decides it. */
const recastIsLead = (role: RecastFixtureRole): boolean => role.billing <= RECAST_LEAD_BILLING;

/** Strip the fixture's private `fame` off: only `ActorCard` goes on the wire. */
function recastActorCard(actor: RecastFixtureActor): ActorCard {
  return {
    person_id: actor.person_id,
    name: actor.name,
    n_films: actor.n_films,
    first_year: actor.first_year,
    last_year: actor.last_year,
    lead_share: actor.lead_share,
    top_genres: [...actor.top_genres],
    casting_type: actor.casting_type,
  };
}

/** The midpoint of a career, standing in for the engine's `median_year`. */
const recastMedianYear = (actor: RecastFixtureActor): number =>
  (actor.first_year + actor.last_year) / 2;

/** Map a distance onto 0-100, hitting zero at `tolerance` (`_closeness`). */
const recastCloseness = (difference: number, tolerance: number): number =>
  Math.max(0, 100 * (1 - Math.abs(difference) / tolerance));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The four components of a candidate's fit for one role, each 0-100.
 *
 * A copy of `fit_breakdown` in the engine, including the one subtlety worth
 * spelling out: role fit is scored against the *role*, not against the
 * original actor. A supporting turn by a huge star therefore does not demand
 * another huge star. The part wants somebody who plays parts that size.
 *
 * Gender is not a term here, and its absence is deliberate rather than an
 * omission (docs/GAME_DESIGN.md §8).
 */
function recastFitBreakdown(
  candidate: RecastFixtureActor,
  original: RecastFixtureActor,
  role: RecastFixtureRole,
  filmGenres: string[],
): FitBreakdown {
  const stature = recastCloseness(candidate.fame - original.fame, STATURE_TOLERANCE);

  const wanted = recastIsLead(role) ? 1 : 0.35;
  const roleFit = 100 * (1 - Math.min(1, Math.abs(candidate.lead_share - wanted)));

  const era = recastCloseness(
    recastMedianYear(candidate) - recastMedianYear(original),
    ERA_TOLERANCE,
  );

  const overlap = candidate.top_genres.filter((g) => filmGenres.includes(g)).length;
  const genre = filmGenres.length
    ? (100 * overlap) / Math.max(1, Math.min(filmGenres.length, 3))
    : 50;

  return {
    stature: round2(stature),
    role_fit: round2(roleFit),
    genre: round2(Math.min(100, genre)),
    era: round2(era),
  };
}

/** Blend the components into a single 0-100 casting score (`fit_score`). */
function recastFitScore(
  candidate: RecastFixtureActor,
  original: RecastFixtureActor,
  role: RecastFixtureRole,
  filmGenres: string[],
): number {
  const parts = recastFitBreakdown(candidate, original, role, filmGenres);
  return round2(
    (Object.keys(FIT_WEIGHTS) as (keyof FitBreakdown)[]).reduce(
      (sum, key) => sum + FIT_WEIGHTS[key] * parts[key],
      0,
    ),
  );
}

/**
 * The actors offered for one role: the original's casting type, minus the
 * original and minus anyone already cast.
 *
 * The engine samples when a cluster is larger than `RECAST_SHORTLIST` and
 * returns the whole thing when it is not. Every fixture cluster is smaller,
 * so this is the second branch, which is why the order is simply the pool's
 * and a reload cannot reshuffle it.
 */
function recastShortlist(index: number, used: Set<string>): RecastFixtureActor[] {
  const role = RECAST_ROLES[index];
  const original = RECAST_ACTORS[role.personId];
  const pool = RECAST_CLUSTERS[original.casting_type ?? ""] ?? [];
  const members = pool.filter((a) => a.person_id !== original.person_id && !used.has(a.person_id));
  return members.slice(0, RECAST_SHORTLIST);
}

/** The strongest casting on a shortlist, revealed after the round. */
function recastBestAvailable(
  candidates: RecastFixtureActor[],
  original: RecastFixtureActor,
  role: RecastFixtureRole,
  filmGenres: string[],
): RecastFixtureActor | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, a) =>
    recastFitScore(a, original, role, filmGenres) > recastFitScore(best, original, role, filmGenres)
      ? a
      : best,
  );
}

/** A round in progress. Only the decisions are stored; the film is a constant. */
interface MockRecastRound {
  id: string;
  seed: string | null;
  createdAt: string;
  /** One entry per filled role, in billing order. */
  picks: { billing: number; character: string; originalId: string; replacementId: string }[];
}

/** Replacements already used, optionally as they stood before role `upto`. */
const recastUsed = (r: MockRecastRound, upto = r.picks.length): Set<string> =>
  new Set(r.picks.slice(0, upto).map((p) => p.replacementId));

const recastIsComplete = (r: MockRecastRound): boolean => r.picks.length >= RECAST_ROLES.length;

/** The film's roles on the wire, unchanged for the life of a round. */
const recastRoleCards = (): RoleCard[] =>
  RECAST_ROLES.map((role) => ({
    billing: role.billing,
    character: role.character,
    original: recastActorCard(RECAST_ACTORS[role.personId]),
    is_lead: recastIsLead(role),
  }));

function recastPresent(r: MockRecastRound): RecastState {
  return {
    id: r.id,
    seed: r.seed,
    status: recastIsComplete(r) ? "complete" : "casting",
    film: {
      film_id: RECAST_FILM.film_id,
      title: RECAST_FILM.title,
      year: RECAST_FILM.year,
      poster_url: gridPoster(RECAST_FILM),
      genres: [...RECAST_FILM.genres],
    },
    roles: recastRoleCards(),
    // The number of filled roles *is* the index of the one being cast, which
    // is why the server sends one field rather than two that could disagree.
    current_role: r.picks.length,
    picks: r.picks.map((p) => ({
      billing: p.billing,
      character: p.character,
      original: recastActorCard(RECAST_ACTORS[p.originalId]),
      replacement: recastActorCard(RECAST_ACTORS[p.replacementId]),
    })),
    created_at: r.createdAt,
  };
}

/**
 * Score a finished casting.
 *
 * Each role is scored against the shortlist the player was actually shown,
 * rebuilt from the round as it stood *before* that pick, which is what makes
 * "best available" mean best among the options offered rather than best in
 * the catalog.
 */
function recastPresentResults(r: MockRecastRound): RecastResults {
  const genres = RECAST_FILM.genres;
  const castings: CastingResult[] = r.picks.map((pick, index) => {
    const role = RECAST_ROLES[index];
    const original = RECAST_ACTORS[pick.originalId];
    const replacement = RECAST_ACTORS[pick.replacementId];
    const candidates = recastShortlist(index, recastUsed(r, index));
    const best = recastBestAvailable(candidates, original, role, genres);
    return {
      billing: role.billing,
      character: role.character,
      original: recastActorCard(original),
      replacement: recastActorCard(replacement),
      fit: recastFitScore(replacement, original, role, genres),
      breakdown: recastFitBreakdown(replacement, original, role, genres),
      best_available: best ? recastActorCard(best) : null,
      best_fit: best ? recastFitScore(best, original, role, genres) : null,
    };
  });

  const fits = castings.map((c) => c.fit);
  // `strongest` and `weakest` are billings, not indexes: the reveal names a
  // role by where it sits on the poster, not by where it sits in an array.
  return {
    game: recastPresent(r),
    score: fits.length ? round2(fits.reduce((a, b) => a + b, 0) / fits.length) : 0,
    castings,
    strongest: castings.length
      ? castings.reduce((a, b) => (b.fit > a.fit ? b : a)).billing
      : null,
    weakest: castings.length ? castings.reduce((a, b) => (b.fit < a.fit ? b : a)).billing : null,
  };
}

/* ---- The adapter ----------------------------------------------------- */

export interface MockOptions {
  /** Artificial delay per call so loading states are visible; 0 in tests. */
  latencyMs?: number;
  /**
   * Simulate the analytics endpoints (clusters, ranker, validation) returning
   * 404, the state of a checkout where the offline scripts have never run.
   */
  analyticsTrained?: boolean;
  /**
   * Simulate the Recast endpoints returning 503, the state of a checkout
   * that has run `build_seed` but not the side-mode seed steps.
   *
   * The sibling of `analyticsTrained`, and there for the same reason: the
   * "you have not built this yet" path is a real state of the app that has to
   * be reachable without dismantling a database. It is scoped to Recast
   * because the grid block above is not this change's to alter; the backend
   * raises the same 503 for both side modes, from one dependency
   * (`require_people` in backend/app/api/deps.py).
   */
  recastSeeded?: boolean;
}

interface MockGame {
  state: GameState;
  random: () => number;
  results: GameResults | null;
}

export function createMockApi(options: MockOptions = {}): Api {
  const latency = options.latencyMs ?? 200;
  const analyticsTrained = options.analyticsTrained ?? true;
  const recastSeeded = options.recastSeeded ?? true;

  // Catalog indexes: by year, and by (year, category).
  const byYear = new Map<number, FixtureContender[]>();
  for (const fy of FIXTURE_YEARS) byYear.set(fy.year, buildYear(fy));
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const decades = [...new Set(years.map(decadeOf))];

  const games = new Map<string, MockGame>();
  const leaderboard: LeaderboardEntry[] = [];
  let counter = 0;

  const delay = <T>(value: T): Promise<T> =>
    latency > 0 ? new Promise((r) => setTimeout(() => r(value), latency)) : Promise.resolve(value);

  const fail = (status: number, detail: string): never => {
    throw new ApiError(status, detail);
  };

  const getGameOrFail = (id: string): MockGame => games.get(id) ?? fail(404, "Game not found.");

  const pool = (year: number, category: Category): FixtureContender[] =>
    (byYear.get(year) ?? []).filter((c) => c.contender.category === category);

  /**
   * Deal `count` distinct years, decade reel first, mirroring
   * docs/GAME_DESIGN.md §2. Drawing the decade before the year is what keeps
   * early cinema as likely as the streaming era; filtering to the years still
   * available before each draw is what makes the three distinct.
   *
   * `avoid` is how the reroll guarantees a year the player has not just seen:
   * trading three years for one of the same three would be no gamble at all.
   */
  const dealYears = (random: () => number, count: number, avoid: number[] = []): YearOption[] => {
    const taken = new Set(avoid);
    const dealt: YearOption[] = [];
    while (dealt.length < count) {
      const available = years.filter((y) => !taken.has(y));
      if (available.length === 0) break; // tiny fixture catalog; deal what we can
      const decadesLeft = decades.filter((d) => available.some((y) => decadeOf(y) === d));
      const decade = decadesLeft[Math.floor(random() * decadesLeft.length)];
      const inDecade = available.filter((y) => decadeOf(y) === decade);
      const year = inDecade[Math.floor(random() * inDecade.length)];
      taken.add(year);
      dealt.push({ year, decade: decadeOf(year) });
    }
    return dealt;
  };

  /** The years currently on the board, as plain numbers. */
  const boardYears = (spin: Spin): number[] => spin.year_options.map((o) => o.year);

  const snapshot = (g: MockGame): GameState => structuredClone(g.state);

  /** Run the 30-ceremony season once the eighth pick lands. */
  const computeResults = (g: MockGame): GameResults => {
    const picks: PickResult[] = g.state.picks.map((p) => {
      const entry = pool(p.year, p.category).find((c) => c.contender.contender_id === p.contender.contender_id);
      const full = entry?.contender ?? p.contender;
      const academy = entry?.academy ?? 0;
      // The 0/60/100 result says what happened; the ceremony metric is what
      // it scores, and since a film's standing elsewhere can lift an
      // un-nominated pick the two are no longer the same number.
      const ceremony = entry?.ceremony ?? 0;
      const winner = pool(p.year, p.category).find((c) => c.academy === 100)?.contender ?? null;
      // Only the scored metrics go in the breakdown. Prestige is deliberately
      // not a key, exactly as the backend now sends it. The reveal reads the
      // estimate off the contender instead.
      const breakdown: Record<string, number | null> = {
        ceremony,
        box_office: full.metrics.box_office,
        critics: full.metrics.critics,
        audience: full.metrics.audience,
        popularity: full.metrics.popularity,
      };
      return {
        pick: { ...p, contender: full },
        academy: ceremony,
        nominated: academy >= 60,
        won_oscar: academy === 100,
        actual_winner: winner,
        metric_breakdown: breakdown,
        pick_score: pickScore(breakdown),
      };
    });

    const scoreByCategory = Object.fromEntries(picks.map((p) => [p.pick.category, p.pick_score])) as Record<Category, number>;
    const ballotStrength = Math.round(picks.reduce((s, p) => s + p.pick_score, 0));

    const ceremonies: CeremonyResult[] = CEREMONY_NAMES.map((name, i) => {
      const index = i + 1;
      const emphasis = emphasisFor(index);
      const total = Object.values(emphasis).reduce((a, b) => a + b, 0);
      // Emphasis-weighted mean × 8 keeps the number on the same 0-800 scale
      // as the ballot strength it is compared against.
      const weighted = (Object.keys(emphasis) as Category[]).reduce(
        (s, c) => s + (emphasis[c] / total) * (scoreByCategory[c] ?? 0), 0,
      ) * BALLOT_SLOTS;
      const threshold = thresholdFor(index);
      return { name, index, threshold, weighted_strength: Math.round(weighted), emphasis, won: weighted >= threshold };
    });

    const wins = ceremonies.filter((c) => c.won).length;
    const weakest = picks.length
      ? picks.reduce((a, b) => (b.pick_score < a.pick_score ? b : a)).pick.category
      : null;

    return {
      game: snapshot(g),
      ballot_strength: ballotStrength,
      wins,
      losses: 30 - wins,
      clean_sweep: wins === 30,
      ceremonies,
      picks,
      weakest_category: weakest,
    };
  };

  /* ---- Six Degrees: per-instance state and presentation --------------- *
   * The board is a constant (GRID_CONNECTORS above), so a round stores only
   * its seed, its clock and its answers, exactly what the backend stores,
   * and the reason a stored round can never disagree with the generator.   */

  const gridRounds = new Map<string, MockGridRound>();
  let gridCounter = 0;

  const getGridOrFail = (id: string): MockGridRound =>
    gridRounds.get(id) ?? fail(404, "Grid game not found.");

  /** The authoritative clock, clamped at 0. */
  const gridSeconds = (r: MockGridRound): number =>
    Math.max(0, Math.floor(GRID_ROUND_SECONDS - (Date.now() - r.startedAt) / 1000));

  /** A round ends when it is handed in, filled, or the clock runs out. */
  const gridIsOver = (r: MockGridRound): boolean =>
    r.handedIn || r.answers.size === GRID_SIZE * GRID_SIZE || gridSeconds(r) === 0;

  /**
   * Why the round stopped, mirroring ``Round.ended_because`` in the engine.
   *
   * Checked in the same order, because a board that was handed in on its last
   * square is "filled" rather than "handed_in": the player finished it.
   */
  const gridEnded = (r: MockGridRound): "filled" | "handed_in" | "time" =>
    r.answers.size === GRID_SIZE * GRID_SIZE ? "filled" : r.handedIn ? "handed_in" : "time";

  /** The sides bought on a cell, in the order they were taken. */
  const gridHintsAt = (r: MockGridRound, row: number, column: number): ("row" | "column")[] =>
    r.hints.get(`${row},${column}`) ?? [];

  /**
   * The hints on a cell as the wire carries them, rebuilt from the sides
   * stored. The film is derived rather than saved for the same reason the
   * board is: a stored copy could disagree with the generator.
   */
  const gridCellHints = (r: MockGridRound, row: number, column: number): GridHint[] =>
    gridHintsAt(r, row, column).map((side) => ({
      side,
      actor: side === "row" ? GRID_ROW_ACTORS[row].name : GRID_COLUMN_ACTORS[column].name,
      film: gridHintFilm(row, column, side),
    }));

  const gridCells = (r: MockGridRound): GridCell[] => {
    const cells: GridCell[] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        const answer = r.answers.get(`${row},${column}`);
        // A correct answer carries its own proof from the moment it lands.
        cells.push({
          row,
          column,
          link: answer ? gridLink(row, column, answer.personId, answer.score) : null,
          hints: gridCellHints(r, row, column),
          hint_penalty: gridHintPenalty(gridHintsAt(r, row, column).length),
        });
      }
    }
    return cells;
  };

  const gridPresent = (r: MockGridRound): GridState => ({
    id: r.id,
    seed: r.seed,
    status: gridIsOver(r) ? "complete" : "playing",
    rows: structuredClone(GRID_ROW_ACTORS),
    columns: structuredClone(GRID_COLUMN_ACTORS),
    cells: gridCells(r),
    seconds_remaining: gridSeconds(r),
    round_seconds: GRID_ROUND_SECONDS,
    created_at: r.createdAt,
  });

  const gridPresentResults = (r: MockGridRound): GridResults => {
    const cells: GridCellResult[] = [];
    let perfect = true;
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        const ids = gridConnectorIds(row, column);
        const answer = r.answers.get(`${row},${column}`);
        const rarestId = ids[ids.length - 1];
        const foundRarest = Boolean(answer && answer.personId === rarestId);
        perfect = perfect && foundRarest;
        cells.push({
          row,
          column,
          row_actor: GRID_ROW_ACTORS[row].name,
          column_actor: GRID_COLUMN_ACTORS[column].name,
          played: answer ? gridLink(row, column, answer.personId, answer.score) : null,
          n_possible: ids.length,
          // Both ends of the range, never the list between them: the obvious
          // route is the one worth remembering, the rarest is the one that
          // was worth 100.
          obvious: gridLink(row, column, ids[0]),
          rarest: gridLink(row, column, rarestId),
          found_rarest: foundRarest,
        });
      }
    }
    const score = [...r.answers.values()].reduce((sum, a) => sum + a.score, 0);
    return {
      game: gridPresent(r),
      filled: r.answers.size,
      total: GRID_SIZE * GRID_SIZE,
      score: Math.round(score * 100) / 100,
      perfect,
      ended: gridEnded(r),
      cells,
    };
  };

  /* ---- Recast: per-instance state ------------------------------------- *
   * As with the grid, the film and its roles are constants, so a round holds
   * nothing but its seed and its decisions, which is exactly what the
   * backend stores, and the reason a reloaded round cannot disagree with the
   * one the player left.                                                    */

  const recastRounds = new Map<string, MockRecastRound>();
  let recastCounter = 0;

  /**
   * The 503 every Recast route raises when the side-mode seed tables are
   * missing, message included: it names the commands to run, so it is worth
   * showing to the player rather than translating into "something broke".
   */
  const requireRecastSeed = (): void => {
    if (!recastSeeded) {
      fail(503, "the side modes need `python -m pipeline.people_graph` and `python -m ml.actors`");
    }
  };

  const getRecastOrFail = (id: string): MockRecastRound =>
    recastRounds.get(id) ?? fail(404, "Recast game not found.");

  return {
    async getMeta(): Promise<Meta> {
      return delay({
        categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
        modes: (Object.keys(MODE_LABELS) as Mode[]).map((id) => ({ id, ...MODE_LABELS[id] })),
        years: { min: 1950, max: 2025 },
        decades: ["1920s", "1930s", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
        ceremonies: CEREMONY_NAMES.map((name, i) => ({ index: i + 1, name, threshold: thresholdFor(i + 1) })),
        // The scored five only. Prestige left this list when it stopped
        // counting, so anything deriving "what is scored" from /api/meta
        // keeps working without a hardcoded exception.
        metrics: SCORED_METRICS.map((m) => ({ id: m.id, label: m.label, description: m.description })),
      });
    },

    async createGame(body: CreateGameBody): Promise<GameState> {
      if (body.mode !== "classic" && body.mode !== "cinephile") fail(422, "Unknown mode.");
      counter += 1;
      const id = `mock-${counter}-${Math.random().toString(36).slice(2, 8)}`;
      const seed = body.seed ?? null;
      const random = rng(seed ? hashSeed(seed) : hashSeed(id));
      const game: MockGame = {
        random,
        results: null,
        state: {
          id,
          mode: body.mode,
          seed,
          status: "spinning",
          round: 1,
          category_order: [...CATEGORY_ORDER],
          current_spin: null,
          skips_remaining: { category: 1 },
          picks: [],
          created_at: new Date().toISOString(),
        },
      };
      games.set(id, game);
      return delay(snapshot(game));
    },

    async getGame(id): Promise<GameState> {
      return delay(snapshot(getGameOrFail(id)));
    },

    async spin(id): Promise<GameState> {
      const g = getGameOrFail(id);
      if (g.state.status !== "spinning") fail(409, "Spin is only valid while the game is waiting for a spin.");
      const category = g.state.category_order[g.state.round - 1];
      // Three years on the board, and the round's reroll still in hand.
      g.state.current_spin = {
        category,
        year_options: dealYears(g.random, YEARS_PER_ROUND),
        locked: false,
        reroll_available: true,
      };
      g.state.status = "picking";
      return delay(snapshot(g));
    },

    async reroll(id): Promise<GameState> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Reroll is only valid while picking.");
      const spin = s.current_spin!;
      if (!spin.reroll_available) fail(409, "This round's reroll has already been spent.");
      // The gamble: every year on the board is thrown away for one fresh one,
      // which is then the only year left to draft from.
      s.current_spin = {
        category: spin.category,
        year_options: dealYears(g.random, 1, boardYears(spin)),
        locked: true,
        reroll_available: false,
      };
      return delay(snapshot(g));
    },

    async skip(id, kind: SkipKind): Promise<GameState> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Skips are only valid while picking.");
      const spin = s.current_spin!;
      if (kind !== "category") fail(422, "Unknown skip kind.");
      if (s.skips_remaining.category <= 0) fail(409, "No category skips remaining.");
      s.skips_remaining.category -= 1;
      // Move the current category to the end and take the next one.
      const idx = s.round - 1;
      const [current] = s.category_order.splice(idx, 1);
      s.category_order.push(current);
      // Fresh years: a year playable for Best Horror need not be playable for
      // Best Supporting Actress, and keeping them would let a player shop one
      // strong year around every category. The round's reroll is untouched.
      s.current_spin = {
        category: s.category_order[idx],
        year_options: dealYears(g.random, YEARS_PER_ROUND),
        locked: false,
        reroll_available: spin.reroll_available,
      };
      return delay(snapshot(g));
    },

    async getCandidates(id, query: CandidatesQuery = {}): Promise<Contender[]> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Candidates are only available while picking.");
      const spin = s.current_spin!;
      const onBoard = boardYears(spin);
      // `?year=` narrows to one of the dealt years; omitting it returns every
      // year on the board in one list (the "all years" view).
      if (query.year !== undefined && !onBoard.includes(query.year)) {
        fail(400, `Year ${query.year} is not on the board (${onBoard.join(", ")}).`);
      }
      const wanted = query.year !== undefined ? [query.year] : onBoard;
      let list = wanted
        .flatMap((year) => pool(year, spin.category))
        .map((c) => maskForMode(c.contender, s.mode));

      const q = query.q?.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (c) =>
            c.film_title.toLowerCase().includes(q) ||
            (c.person_name?.toLowerCase().includes(q) ?? false) ||
            (c.character?.toLowerCase().includes(q) ?? false),
        );
      }

      // The backend's default is `audience` (backend/app/api/games.py). It
      // would 400 on that in cinephile mode, where every metric is null, so
      // the mock falls back to title there rather than refusing a request the
      // client never made a choice about.
      const sort = query.sort ?? (s.mode === "classic" ? "audience" : "title");
      const byNum = (k: keyof Contender["metrics"]) => (a: Contender, b: Contender) =>
        (b.metrics[k] ?? -1) - (a.metrics[k] ?? -1);
      const sorters: Record<string, (a: Contender, b: Contender) => number> = {
        audience: byNum("audience"),
        critics: byNum("critics"),
        popularity: byNum("popularity"),
        box_office: byNum("box_office"),
        prestige: byNum("prestige"),
        title: (a, b) => a.film_title.localeCompare(b.film_title),
        person: (a, b) => (a.person_name ?? a.film_title).localeCompare(b.person_name ?? b.film_title),
      };
      const sorter = sorters[sort];
      if (!sorter) fail(422, `Unknown sort "${sort}".`);
      list.sort(sorter);
      return delay(list);
    },

    async pick(id, contenderId): Promise<GameState> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Pick is only valid while picking.");
      const spin = s.current_spin!;
      // The contender has to be in the dealt category *and* in one of the
      // years on the board. Picking by id alone would let a client draft any
      // performance in history.
      const entry = boardYears(spin)
        .flatMap((year) => pool(year, spin.category))
        .find((c) => c.contender.contender_id === contenderId);
      if (!entry) fail(404, "Contender is not in the current pool.");
      const pick: Pick = {
        round: s.round,
        category: spin.category,
        year: entry!.contender.year,
        contender: maskForMode(entry!.contender, s.mode),
      };
      s.picks.push(pick);
      if (s.picks.length >= BALLOT_SLOTS) {
        s.status = "complete";
        s.round = BALLOT_SLOTS;
        s.current_spin = null;
        g.results = computeResults(g);
      } else {
        s.round += 1;
        s.status = "spinning";
        s.current_spin = null;
      }
      return delay(snapshot(g));
    },

    async getResults(id): Promise<GameResults> {
      const g = getGameOrFail(id);
      if (g.state.status !== "complete" || !g.results) fail(409, "Results are only available once the ballot is complete.");
      return delay(structuredClone(g.results!));
    },

    async submit(id, playerName): Promise<LeaderboardEntry> {
      const g = getGameOrFail(id);
      const name = playerName.trim();
      if (!name) fail(422, "Player name is required.");
      if (name.length > 40) fail(422, "Player name must be 40 characters or fewer.");
      if (g.state.status !== "complete" || !g.results) fail(409, "Only completed games can be submitted.");
      const r = g.results!;
      const entry: LeaderboardEntry = {
        id: `lb-${leaderboard.length + 1}`,
        player_name: name,
        mode: g.state.mode,
        seed: g.state.seed,
        wins: r.wins,
        ballot_strength: r.ballot_strength,
        clean_sweep: r.clean_sweep,
        created_at: new Date().toISOString(),
      };
      leaderboard.push(entry);
      return delay({ ...entry });
    },

    async getLeaderboard(query: LeaderboardQuery = {}): Promise<LeaderboardEntry[]> {
      const limit = query.limit ?? 50;
      const rows = leaderboard
        .filter((e) => (query.seed ? e.seed === query.seed : true))
        .sort((a, b) => b.wins - a.wins || b.ballot_strength - a.ballot_strength)
        .slice(0, limit);
      return delay(rows.map((e) => ({ ...e })));
    },

    async getCatalogYear(year, category): Promise<BrowseContender[]> {
      const rows = byYear.get(year);
      if (!rows) fail(404, `No contenders for ${year} in the mock catalog (try ${years.join(", ")}).`);
      const list = rows!
        .filter((c) => (category ? c.contender.category === category : true))
        .map((c) => {
          const contender = structuredClone(c.contender);
          // The catalog is the one unmasked view, so it carries the Academy
          // outcome too, which is what lets Browse badge nominees and winners.
          return {
            ...contender,
            academy: { nominated: c.academy >= 60, won: c.academy === 100 },
          };
        });
      return delay(list);
    },

    async getClusters(): Promise<ClusterSummary> {
      if (!analyticsTrained) fail(404, "Cluster model has not been trained yet.");
      const features = ["imdb_rating", "log_votes", "runtime_minutes", "year", "box_office"];
      const all = FIXTURE_YEARS.flatMap((fy) => fy.films);
      const random = rng(hashSeed("clusters"));
      // A fake PCA projection: rating on x, log votes on y, jittered per archetype.
      const points = all.map((f) => {
        const a = ARCHETYPES.indexOf(f.archetype as (typeof ARCHETYPES)[number]);
        return {
          film_id: f.id,
          title: f.title,
          year: FIXTURE_YEARS.find((fy) => fy.films.includes(f))?.year ?? 0,
          x: (f.rating - 7.5) * 2 + Math.cos(a) * 0.8 + (random() - 0.5),
          y: Math.log10(f.votesK + 1) - 1.5 + Math.sin(a) * 0.8 + (random() - 0.5),
          archetype: f.archetype,
        };
      });
      const archetypes = ARCHETYPES.map((label) => {
        const films = all.filter((f) => f.archetype === label);
        return {
          label,
          size: films.length * 37, // pretend the sample is a slice of a larger set
          centroid: Object.fromEntries(features.map((k, i) => [k, Math.round((0.5 + Math.sin(i + label.length) * 0.5) * 100) / 100])),
          examples: films.slice(0, 4).map((f) => f.title),
        };
      });
      return delay({ archetypes, points, features });
    },

    async getRanker(): Promise<RankerSummary> {
      if (!analyticsTrained) fail(404, "Prestige ranker has not been trained yet.");
      const feature_importances = [
        ["prior_nominations", 0.21], ["audience", 0.17], ["imdb_rating", 0.14], ["log_votes", 0.11],
        ["runtime_minutes", 0.08], ["prior_wins", 0.07], ["genre_drama", 0.06], ["billing", 0.05],
        ["year", 0.04], ["box_office", 0.03], ["metascore", 0.02], ["genre_biography", 0.02],
      ].map(([feature, importance]) => ({ feature: feature as string, importance: importance as number }));
      const calibration = Array.from({ length: 10 }, (_, i) => {
        const p = (i + 0.5) / 10;
        return { bin_mean_pred: Math.round(p * 100) / 100, bin_frac_pos: Math.round(Math.min(1, Math.max(0, p + Math.sin(i) * 0.06)) * 100) / 100, count: Math.round(1200 * Math.exp(-i / 2.5)) + 20 };
      });
      return delay({
        model: "HistGradientBoostingClassifier",
        metrics: { roc_auc: 0.87, average_precision: 0.41, brier: 0.062, n_train: 24_180, n_test: 1_935 },
        feature_importances,
        calibration,
      });
    },

    /**
     * The validation report, with the numbers the committed artifact actually
     * carries (data/models/validation.json). They are quoted rather than
     * invented because this section is an argument: a fabricated p-value or a
     * baseline table that flattered the model would make the mock demo say
     * something the real one does not.
     */
    async getValidation(): Promise<ValidationReport> {
      if (!analyticsTrained) fail(404, "Validation report has not been generated yet.");
      return delay({
        scope: "six Academy categories only; genre crowns excluded as circular",
        n_rows: 47_463,
        n_winners: 460,
        split: { train_below: 2019, n_train: 42_526, n_test: 4_937 },
        leakage_audit: {
          threshold: 0.9,
          n_features: 28,
          clean: true,
          strongest: [
            { feature: "billing", auc: 0.8105 },
            { feature: "metascore", auc: 0.7927 },
            { feature: "rt_critic", auc: 0.7337 },
            { feature: "imdb_rating", auc: 0.7323 },
            { feature: "audience", auc: 0.7297 },
            { feature: "genre_Drama", auc: 0.6727 },
            { feature: "runtime_minutes", auc: 0.6697 },
            { feature: "prior_nominations", auc: 0.6425 },
            { feature: "popularity", auc: 0.6417 },
            { feature: "box_office", auc: 0.606 },
          ],
          suspected_leaks: [],
        },
        held_out_auc: { point: 0.8904, ci95: [0.8364, 0.9379], resamples: 2000, n_positives: 43 },
        permutation_test: {
          observed_auc: 0.8904,
          null_mean_auc: 0.4324,
          null_max_auc: 0.7008,
          null_sd: 0.0931,
          rounds: 199,
          p_value: 0.005,
          beats_null: true,
        },
        baselines: {
          model: { roc_auc: 0.8904, average_precision: 0.2009, n: 4_937 },
          "acclaim (IMDb rating percentile)": { roc_auc: 0.7923, average_precision: 0.0292, n: 4_937 },
          "popularity (vote count percentile)": { roc_auc: 0.7248, average_precision: 0.0389, n: 4_937 },
          "prior Oscar nominations": { roc_auc: 0.6398, average_precision: 0.0214, n: 4_937 },
          "top billing": { roc_auc: 0.5516, average_precision: 0.0251, n: 4_937 },
        },
        beats_best_baseline_by: 0.0981,
        duration_seconds: 240.7,
        verdict: "signal confirmed",
      });
    },

    async health() {
      return delay({ status: "ok" as const });
    },

    /* ---- Game-mode menu ------------------------------------------------ *
     * The copy is the backend's (backend/app/api/meta.py, `_game_menu`) so
     * the mock menu and the real one read identically. Everything is
     * `available: true` here because the fixture *is* the seed table: the
     * mock has no unbuilt data to be missing.                              */
    async getModes(): Promise<ModeCard[]> {
      return delay([
        {
          id: "oscars" as const,
          label: "The Oscars",
          tagline: "Build the best ballot in history",
          description:
            "Three years are dealt each round and you draft one contender per category. Winning the Oscar is what scores highest, but the ballot is yours. If you think someone should have won, put them on it and see how the season judges the call.",
          available: true,
          path: "/",
        },
        {
          id: "recast" as const,
          label: "Recast",
          tagline: "Who else could have played the part?",
          description:
            "A film comes up with its principal roles. Replace each one from a shortlist drawn by clustering actors into casting types, and the round scores how defensible your casting is on stature, role size, era and genre.",
          available: true,
          path: "/recast",
        },
        {
          id: "grid" as const,
          label: "Six Degrees",
          tagline: "Name the actor who connects them",
          description:
            "Three actors down the side, three across the top, and none of them have ever worked together. Every cell wants a third actor who made a film with one and a film with the other. Three minutes, or hand it in early.",
          available: true,
          path: "/grid",
        },
      ]);
    },

    /* ---- Six Degrees ---------------------------------------------------- */

    async createGridGame(seed?: string): Promise<GridState> {
      gridCounter += 1;
      const round: MockGridRound = {
        id: `grid-${gridCounter}-${Math.random().toString(36).slice(2, 8)}`,
        // The seed is carried and echoed back so the daily board reads as one
        // in the UI. It does not vary the board here: the fixture has exactly
        // one hand-built board, where the backend has a graph to search.
        seed: seed ?? null,
        startedAt: Date.now(),
        createdAt: new Date().toISOString(),
        answers: new Map(),
        hints: new Map(),
        handedIn: false,
      };
      gridRounds.set(round.id, round);
      return delay(gridPresent(round));
    },

    async getGridGame(id: string): Promise<GridState> {
      return delay(gridPresent(getGridOrFail(id)));
    },

    /**
     * Type a name for one cell. Every rejection the backend can raise is
     * mirrored here, message for message, because those messages are the
     * mode: "that actor does not connect those two" is the feedback the UI
     * has to put in front of the player verbatim.
     *
     * The name is resolved before the rules run, exactly as the server does
     * it, so the two failures stay distinct. Not knowing who was meant is a
     * different problem from knowing and being wrong.
     */
    async answerGrid(id: string, body: GridAnswerBody): Promise<GridState> {
      const r = getGridOrFail(id);
      if (gridIsOver(r)) fail(409, "this board is finished");
      const { row, column, name } = body;
      if (!(row >= 0 && row < GRID_SIZE && column >= 0 && column < GRID_SIZE)) {
        fail(400, "that cell is not on the board");
      }
      if (r.answers.has(`${row},${column}`)) fail(409, "that cell is already answered");

      const resolved = gridResolveActor(name);
      if (!resolved.personId) {
        fail(
          400,
          resolved.ambiguous
            ? "several actors share that name; type it in full"
            : "no actor in the catalog goes by that name",
        );
      }
      const personId = resolved.personId!;

      // One connector per board: otherwise a single well-connected name could
      // fill a whole row, which is not the knowledge the mode is testing.
      if ([...r.answers.values()].some((a) => a.personId === personId)) {
        fail(409, "you have already used that actor");
      }
      const ids = gridConnectorIds(row, column);
      if (!ids.includes(personId)) {
        fail(400, "that actor does not connect those two");
      }
      // The hints taken on this cell are already paid for, so they come off
      // whatever the answer turns out to be worth. Never below zero: a hinted
      // right answer is still worth more than an empty square.
      const earned = gridScoreFor(ids, personId);
      const penalty = gridHintPenalty(gridHintsAt(r, row, column).length);
      const score = Math.max(0, Math.round((earned - penalty) * 100) / 100);
      r.answers.set(`${row},${column}`, { personId, score });
      return delay(gridPresent(r));
    },

    /**
     * Buy a hint for one side of a cell.
     *
     * Every refusal the backend can raise is mirrored here message for
     * message, in the same order it checks them, because the published demo
     * runs on this adapter and a hint that behaves differently offline is a
     * second set of rules to reason about.
     *
     * Asking again for a hint already bought is deliberately not an error. It
     * is free and hands back the same film, since charging twice for one film
     * would be a bug the player pays for.
     */
    async hintGrid(id: string, body: GridHintBody): Promise<GridState> {
      const r = getGridOrFail(id);
      if (gridIsOver(r)) fail(409, "this board is finished");
      const { row, column, side } = body;
      if (!(row >= 0 && row < GRID_SIZE && column >= 0 && column < GRID_SIZE)) {
        fail(400, "that cell is not on the board");
      }
      if (side !== "row" && side !== "column") {
        fail(400, "a hint is for the 'row' side or the 'column' side");
      }
      if (r.answers.has(`${row},${column}`)) fail(409, "that cell is already answered");

      const key = `${row},${column}`;
      const taken = r.hints.get(key) ?? [];
      if (!taken.includes(side)) {
        r.hints.set(key, [...taken, side]);
      }
      return delay(gridPresent(r));
    },

    async completeGrid(id: string): Promise<GridResults> {
      const r = getGridOrFail(id);
      r.handedIn = true;
      return delay(gridPresentResults(r));
    },

    async getGridResults(id: string): Promise<GridResults> {
      const r = getGridOrFail(id);
      if (!gridIsOver(r)) fail(409, "the board is still in play");
      return delay(gridPresentResults(r));
    },

    /* ---- Recast --------------------------------------------------------- */

    async createRecastGame(seed?: string): Promise<RecastState> {
      requireRecastSeed();
      recastCounter += 1;
      const round: MockRecastRound = {
        id: `recast-${recastCounter}-${Math.random().toString(36).slice(2, 8)}`,
        // Echoed back so the daily film reads as one in the UI. It does not
        // vary the film here: the fixture has a single hand-built cast where
        // the backend has a catalog to draw from.
        seed: seed ?? null,
        createdAt: new Date().toISOString(),
        picks: [],
      };
      recastRounds.set(round.id, round);
      return delay(recastPresent(round));
    },

    async getRecastGame(id: string): Promise<RecastState> {
      requireRecastSeed();
      return delay(recastPresent(getRecastOrFail(id)));
    },

    /**
     * The shortlist for the role currently being cast.
     *
     * There is no role parameter, here or on the wire: which part is open is
     * server state, so a client cannot ask for a shortlist it is not entitled
     * to and the two cannot drift apart mid-round.
     */
    async getRecastShortlist(id: string): Promise<ActorCard[]> {
      requireRecastSeed();
      const r = getRecastOrFail(id);
      if (recastIsComplete(r)) fail(409, "every role is cast");
      return delay(recastShortlist(r.picks.length, recastUsed(r)).map(recastActorCard));
    },

    /**
     * Cast the current role.
     *
     * The rejection is the one the mode is built on: anyone not on this
     * role's shortlist (the original, a name from another casting type, or
     * somebody already cast in an earlier part) is refused with the
     * backend's own words, which the UI shows verbatim.
     */
    async castRecast(id: string, personId: string): Promise<RecastState> {
      requireRecastSeed();
      const r = getRecastOrFail(id);
      if (recastIsComplete(r)) fail(409, "every role is cast");
      const index = r.picks.length;
      const allowed = new Set(recastShortlist(index, recastUsed(r)).map((a) => a.person_id));
      if (!allowed.has(personId)) fail(400, "that actor is not on this role's shortlist");
      const role = RECAST_ROLES[index];
      r.picks.push({
        billing: role.billing,
        character: role.character,
        originalId: role.personId,
        replacementId: personId,
      });
      return delay(recastPresent(r));
    },

    async getRecastResults(id: string): Promise<RecastResults> {
      requireRecastSeed();
      const r = getRecastOrFail(id);
      if (!recastIsComplete(r)) fail(409, "there are still roles to cast");
      return delay(recastPresentResults(r));
    },
  };
}
