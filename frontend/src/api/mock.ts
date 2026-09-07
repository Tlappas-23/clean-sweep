// In-memory implementation of the `Api` interface (src/api/client.ts).
//
// Lets the whole UI run without the FastAPI backend (VITE_API_MOCK=true) and
// gives the tests a deterministic server. It enforces the same state rules
// listed at the bottom of docs/API.md — spin only while "spinning", skip
// only while "picking" with a count left, reroll only once per round, a pick
// that has to come from a year on the board, candidates only for a year on
// the board, results only when complete — and throws `ApiError` with the same
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
// a metric the backend dropped — prestige in particular is shown on cards but
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
 * These are the backend's four (backend/app/engine/scoring.py). Prestige is
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
    metrics: { acclaim: null, popularity: null, box_office: null, prestige: null },
    stats: { imdb_rating: null, imdb_votes: null, box_office_usd: null, box_office_est_usd: null, budget_usd: null, rt_critic: null, rt_audience: null, metascore: null },
    career: { prior_nominations: 0, prior_wins: 0, billing: null },
  };
}

/* ======================================================================= *
 * Game-mode menu + Co-star Grid                                           *
 *                                                                         *
 * One contiguous block, module level, so the Oscars mock above is left     *
 * exactly as it was. Everything here is pure data plus pure functions; the *
 * per-round state lives inside `createMockApi` with the Oscars games.      *
 *                                                                         *
 * The board                                                               *
 * ---------                                                               *
 * The real backend *searches* for a board: it walks the co-star graph      *
 * until it finds three rows and three columns where all nine pairings have *
 * a shared film (backend/app/engine/grid.py, `build_board`). A fixture has *
 * no graph to walk, so the board below is hand-built — but it is built to  *
 * the same guarantee, and to two more that make it worth playing:          *
 *                                                                         *
 *   1. every one of the nine pairings really does share a film;            *
 *   2. the nine cells can be filled with nine *distinct* films, so the     *
 *      one-film-per-board rule cannot deadlock a full board;               *
 *   3. the catalog contains films that are valid for nobody, so naming a   *
 *      wrong one — the feedback the whole mode is built on — is reachable  *
 *      in mock mode and in the tests.                                      *
 *                                                                         *
 * The pair lists are a hand-picked slice of real filmographies, ordered    *
 * best-known first the way the engine orders them; they are not exhaustive *
 * and are not claimed to be.                                              *
 * ======================================================================= */

import type {
  ActorCard,
  FilmCard,
  GridAnswerBody,
  GridCell,
  GridCellResult,
  GridResults,
  GridSearchQuery,
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

interface GridFixtureFilm {
  film_id: string; // IMDb-style tconst
  title: string;
  year: number;
  genres: string[];
}

/**
 * The mock film catalog, keyed by a short alias so the pair table below reads
 * as a list of films rather than a list of ids.
 *
 * The last block is deliberately unreachable: those films share no cell with
 * anybody on this board, so searching for them and picking one is how a
 * player (or a test) meets the "those two were never in that film together"
 * rejection.
 */
const GRID_FILMS: Record<string, GridFixtureFilm> = {
  ironMan: { film_id: "tt0371746", title: "Iron Man", year: 2008, genres: ["Action", "Sci-Fi"] },
  ironMan2: { film_id: "tt1228705", title: "Iron Man 2", year: 2010, genres: ["Action", "Sci-Fi"] },
  ironMan3: { film_id: "tt1300854", title: "Iron Man 3", year: 2013, genres: ["Action", "Sci-Fi"] },
  firstAvenger: { film_id: "tt0458339", title: "Captain America: The First Avenger", year: 2011, genres: ["Action", "Adventure"] },
  winterSoldier: { film_id: "tt1843866", title: "Captain America: The Winter Soldier", year: 2014, genres: ["Action", "Thriller"] },
  avengers: { film_id: "tt0848228", title: "The Avengers", year: 2012, genres: ["Action", "Sci-Fi"] },
  ultron: { film_id: "tt2395427", title: "Avengers: Age of Ultron", year: 2015, genres: ["Action", "Sci-Fi"] },
  infinityWar: { film_id: "tt4154756", title: "Avengers: Infinity War", year: 2018, genres: ["Action", "Sci-Fi"] },
  endgame: { film_id: "tt4154796", title: "Avengers: Endgame", year: 2019, genres: ["Action", "Drama"] },
  zodiac: { film_id: "tt0443706", title: "Zodiac", year: 2007, genres: ["Crime", "Drama", "Mystery"] },

  // Valid for no cell on this board — the wrong answers have to exist.
  pulpFiction: { film_id: "tt0110912", title: "Pulp Fiction", year: 1994, genres: ["Crime", "Drama"] },
  lostInTranslation: { film_id: "tt0335266", title: "Lost in Translation", year: 2003, genres: ["Drama", "Romance"] },
  spotlight: { film_id: "tt1895587", title: "Spotlight", year: 2015, genres: ["Crime", "Drama"] },
  knivesOut: { film_id: "tt8946378", title: "Knives Out", year: 2019, genres: ["Comedy", "Crime", "Mystery"] },
  theGodfather: { film_id: "tt0068646", title: "The Godfather", year: 1972, genres: ["Crime", "Drama"] },
  titanic: { film_id: "tt0120338", title: "Titanic", year: 1997, genres: ["Drama", "Romance"] },
};

/** Three actors down the side of the board. */
const GRID_ROW_ACTORS: ActorCard[] = [
  { person_id: "nm0000375", name: "Robert Downey Jr.", n_films: 92, first_year: 1970, last_year: 2024, lead_share: 0.62, top_genres: ["Action", "Comedy", "Drama"], casting_type: "Marquee Lead" },
  { person_id: "nm0424060", name: "Scarlett Johansson", n_films: 62, first_year: 1994, last_year: 2024, lead_share: 0.71, top_genres: ["Action", "Drama", "Sci-Fi"], casting_type: "Marquee Lead" },
  { person_id: "nm0262635", name: "Chris Evans", n_films: 48, first_year: 2000, last_year: 2024, lead_share: 0.58, top_genres: ["Action", "Adventure", "Comedy"], casting_type: "Franchise Lead" },
];

/** Three actors across the top. */
const GRID_COLUMN_ACTORS: ActorCard[] = [
  { person_id: "nm0000168", name: "Samuel L. Jackson", n_films: 156, first_year: 1972, last_year: 2024, lead_share: 0.44, top_genres: ["Action", "Crime", "Drama"], casting_type: "Working Character Actor" },
  { person_id: "nm0749263", name: "Mark Ruffalo", n_films: 74, first_year: 1989, last_year: 2024, lead_share: 0.49, top_genres: ["Drama", "Thriller", "Action"], casting_type: "Prestige Character Lead" },
  { person_id: "nm0000569", name: "Gwyneth Paltrow", n_films: 55, first_year: 1991, last_year: 2019, lead_share: 0.55, top_genres: ["Drama", "Romance", "Action"], casting_type: "Prestige Lead" },
];

/**
 * `[row][column]` → the films that pair shares, best-known first.
 *
 * Best-first is what the cell score reads: index 0 is worth 100 and the last
 * entry is worth `GRID_MIN_CELL_SCORE`. It is also the single film the reveal
 * shows, which is why the ordering is a judgement about fame rather than an
 * arbitrary sort.
 *
 * Every list is non-empty (rule 1) and a system of nine distinct films exists
 * across them (rule 2) — for instance Iron Man, The Avengers, Iron Man 3 /
 * The Winter Soldier, Age of Ultron, Iron Man 2 / The First Avenger, Infinity
 * War, Endgame.
 */
const GRID_PAIR_FILMS: string[][][] = [
  // Robert Downey Jr. × Jackson / Ruffalo / Paltrow
  [
    ["ironMan", "avengers", "endgame", "ironMan2", "ultron"],
    ["avengers", "endgame", "infinityWar", "ultron", "zodiac"],
    ["ironMan", "ironMan3", "avengers", "ironMan2", "endgame"],
  ],
  // Scarlett Johansson × Jackson / Ruffalo / Paltrow
  [
    ["winterSoldier", "avengers", "endgame", "ironMan2", "ultron"],
    ["avengers", "ultron", "endgame"],
    ["ironMan2", "endgame"],
  ],
  // Chris Evans × Jackson / Ruffalo / Paltrow
  [
    ["winterSoldier", "avengers", "firstAvenger", "endgame", "ultron"],
    ["avengers", "infinityWar", "endgame", "ultron"],
    ["endgame", "infinityWar"],
  ],
];

/**
 * A stand-in for the TMDB `w342` poster the real API returns.
 *
 * The Oscars fixture has its own version of this (src/api/mockCatalog.ts) but
 * does not export it, and that file is not the grid's to edit — so this is a
 * deliberately smaller sibling: same field, same 2:3 aspect ratio, same
 * offline-safe SVG data URI, sized for a thumbnail rather than a card.
 *
 * One film keeps a null poster on purpose, so the fallback plate in
 * src/components/grid/FilmPoster.tsx is on screen in mock mode rather than
 * only in a unit test.
 */
function gridPoster(film: GridFixtureFilm): string | null {
  if (film.film_id === GRID_FILMS.zodiac.film_id) return null;
  // A hue per film keeps the wall distinct but on-palette (amber → gold).
  let hue = 0;
  for (const ch of film.film_id) hue = (hue * 31 + ch.charCodeAt(0)) % 60;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='228' height='342'>` +
    `<rect width='228' height='342' fill='hsl(${hue + 15} 30% 8%)'/>` +
    `<rect x='8' y='8' width='212' height='326' fill='none' stroke='hsl(${hue + 15} 70% 45%)' stroke-opacity='0.5'/>` +
    `<text x='114' y='176' fill='hsl(${hue + 15} 70% 62%)' font-family='Georgia,serif' font-size='22' text-anchor='middle'>${film.year}</text>` +
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

/** Reverse index: wire id → fixture alias, for answers and search results. */
const GRID_ALIAS_BY_ID: Record<string, string> = Object.fromEntries(
  Object.entries(GRID_FILMS).map(([alias, film]) => [film.film_id, alias]),
);

/**
 * Score a correct answer 0-100 by how well known that collaboration is.
 *
 * Mirrors `score_answer` in the engine: the pair's films are ordered
 * best-first, so position in that list maps onto the scale. A pair with only
 * one shared film scores 100 — there was nothing better to have named.
 */
function gridScoreFor(films: string[], alias: string): number {
  if (films.length === 1) return 100;
  const share = 1 - films.indexOf(alias) / (films.length - 1);
  return Math.round((GRID_MIN_CELL_SCORE + (100 - GRID_MIN_CELL_SCORE) * share) * 100) / 100;
}

/** A round in progress. Only the answers are stored; the board is a constant. */
interface MockGridRound {
  id: string;
  seed: string | null;
  startedAt: number; // epoch ms
  createdAt: string;
  /** "row,column" → the alias named there and what it scored. */
  answers: Map<string, { alias: string; score: number }>;
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
 * backend/app/engine/recast.py. That matters more than it looks — the      *
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
 *   2. it never offers the original, and never offers anyone already cast  *
 *      — which is why the film's two lead roles deliberately share one     *
 *      casting type. Cast someone in the first and they are gone from the  *
 *      second, and that exclusion is reachable in mock mode and in a test  *
 *      rather than only against a real database.                           *
 *                                                                         *
 * The clusters here hold seven to nine actors where the real ones hold     *
 * hundreds, so every shortlist comes back under `RECAST_SHORTLIST` and the *
 * engine's "return the whole cluster" branch is the one that runs. No      *
 * sampling, and therefore no shuffle — which is also why these shortlists  *
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
 * `fame` is the engine's reach term — the log of a vote count — and it is
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
  /** Whoever actually played it — the head of the shortlist's casting type. */
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
 * another huge star — the part wants somebody who plays parts that size.
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
 * so this is the second branch — which is why the order is simply the pool's
 * and a reload cannot reshuffle it.
 */
function recastShortlist(index: number, used: Set<string>): RecastFixtureActor[] {
  const role = RECAST_ROLES[index];
  const original = RECAST_ACTORS[role.personId];
  const pool = RECAST_CLUSTERS[original.casting_type ?? ""] ?? [];
  const members = pool.filter((a) => a.person_id !== original.person_id && !used.has(a.person_id));
  return members.slice(0, RECAST_SHORTLIST);
}

/** The strongest casting on a shortlist — revealed after the round. */
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
 * rebuilt from the round as it stood *before* that pick — which is what makes
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
   * 404 — the state of a checkout where the offline scripts have never run.
   */
  analyticsTrained?: boolean;
  /**
   * Simulate the Recast endpoints returning 503 — the state of a checkout
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
   * Deal `count` distinct years, decade reel first — mirrors
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
      const winner = pool(p.year, p.category).find((c) => c.academy === 100)?.contender ?? null;
      // Only the scored metrics go in the breakdown — prestige is deliberately
      // not a key, exactly as the backend now sends it. The reveal reads the
      // estimate off the contender instead.
      const breakdown: Record<string, number | null> = {
        academy,
        acclaim: full.metrics.acclaim,
        box_office: full.metrics.box_office,
        popularity: full.metrics.popularity,
      };
      return {
        pick: { ...p, contender: full },
        academy,
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

  /* ---- Co-star Grid: per-instance state and presentation -------------- *
   * The board is a constant (GRID_PAIR_FILMS above), so a round stores only
   * its seed, its clock and its answers — exactly what the backend stores,
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

  const gridCells = (r: MockGridRound): GridCell[] => {
    const cells: GridCell[] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let column = 0; column < GRID_SIZE; column++) {
        const answer = r.answers.get(`${row},${column}`);
        cells.push({
          row,
          column,
          film: answer ? gridFilmCard(answer.alias) : null,
          score: answer ? answer.score : null,
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
        const films = GRID_PAIR_FILMS[row][column];
        const answer = r.answers.get(`${row},${column}`);
        const foundBest = Boolean(answer && answer.alias === films[0]);
        perfect = perfect && foundBest;
        cells.push({
          row,
          column,
          row_actor: GRID_ROW_ACTORS[row].name,
          column_actor: GRID_COLUMN_ACTORS[column].name,
          film: answer ? gridFilmCard(answer.alias) : null,
          score: answer ? answer.score : null,
          n_possible: films.length,
          // Only the best answer is revealed, never the whole list: the point
          // is the one collaboration worth remembering.
          best_answer: gridFilmCard(films[0]),
          found_best: foundBest,
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
      cells,
    };
  };

  /* ---- Recast: per-instance state ------------------------------------- *
   * As with the grid, the film and its roles are constants, so a round holds
   * nothing but its seed and its decisions — which is exactly what the
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
        // The scored four only. Prestige left this list when it stopped
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

      const sort = query.sort ?? (s.mode === "classic" ? "prestige" : "title");
      const byNum = (k: keyof Contender["metrics"]) => (a: Contender, b: Contender) =>
        (b.metrics[k] ?? -1) - (a.metrics[k] ?? -1);
      const sorters: Record<string, (a: Contender, b: Contender) => number> = {
        acclaim: byNum("acclaim"),
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
      // years on the board — picking by id alone would let a client draft any
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
          // outcome too — that is what lets Browse badge nominees and winners.
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
        ["prior_nominations", 0.21], ["acclaim", 0.17], ["imdb_rating", 0.14], ["log_votes", 0.11],
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
            { feature: "acclaim", auc: 0.7297 },
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
            "Three years are dealt each round and you draft one contender per category. Winning the Oscar is what scores highest, but the ballot is yours — if you think someone should have won, put them on it and see how the season judges the call.",
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
          label: "Co-star Grid",
          tagline: "Name a film they were both in",
          description:
            "Three actors down the side, three across the top. Every cell wants a film both of them appeared in, and every pairing on the board is checked to have one. Three minutes, or hand it in early.",
          available: true,
          path: "/grid",
        },
      ]);
    },

    /* ---- Co-star Grid --------------------------------------------------- */

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
        handedIn: false,
      };
      gridRounds.set(round.id, round);
      return delay(gridPresent(round));
    },

    async getGridGame(id: string): Promise<GridState> {
      return delay(gridPresent(getGridOrFail(id)));
    },

    /**
     * Searches the whole catalog rather than only the board's valid answers,
     * exactly as the backend does — a player has to be able to name a wrong
     * film and be told it is wrong.
     */
    async searchGridFilms(id: string, query: GridSearchQuery): Promise<FilmCard[]> {
      getGridOrFail(id); // 404 an unknown game before doing any work
      const q = query.q.trim().toLowerCase();
      if (q.length < 2) fail(422, "Search needs at least two characters.");
      const limit = query.limit ?? 12;
      const matches = Object.keys(GRID_FILMS)
        .filter((alias) => GRID_FILMS[alias].title.toLowerCase().includes(q))
        // Best-known-ish ordering: newest first is a stand-in for the real
        // catalog's popularity sort, and it keeps results stable.
        .sort((a, b) => GRID_FILMS[b].year - GRID_FILMS[a].year)
        .slice(0, limit)
        .map(gridFilmCard);
      return delay(matches);
    },

    /**
     * Name a film for one cell. Every rejection the engine can raise is
     * mirrored here, message for message, because those messages are the
     * mode: "those two were never in that film together" is the feedback the
     * UI has to put in front of the player verbatim.
     */
    async answerGrid(id: string, body: GridAnswerBody): Promise<GridState> {
      const r = getGridOrFail(id);
      if (gridIsOver(r)) fail(409, "this board is finished");
      const { row, column, film_id } = body;
      if (!(row >= 0 && row < GRID_SIZE && column >= 0 && column < GRID_SIZE)) {
        fail(400, "that cell is not on the board");
      }
      if (r.answers.has(`${row},${column}`)) fail(409, "that cell is already answered");
      // One film per board: otherwise a single ensemble film could fill a
      // whole row, which is not the knowledge the mode is testing.
      const alias = GRID_ALIAS_BY_ID[film_id];
      if (alias && [...r.answers.values()].some((a) => a.alias === alias)) {
        fail(409, "you have already used that film");
      }
      const films = GRID_PAIR_FILMS[row][column];
      // An unknown film id lands here too: it is not on the pair's list, so
      // the honest answer is the same one.
      if (!alias || !films.includes(alias)) {
        fail(400, "those two were never in that film together");
      }
      r.answers.set(`${row},${column}`, { alias: alias!, score: gridScoreFor(films, alias!) });
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
     * role's shortlist — the original, a name from another casting type, or
     * somebody already cast in an earlier part — is refused with the
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
