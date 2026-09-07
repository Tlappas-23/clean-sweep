// In-memory implementation of the `Api` interface (src/api/client.ts).
//
// Lets the whole UI run without the FastAPI backend (VITE_API_MOCK=true) and
// gives the tests a deterministic server. It enforces the same state rules
// listed at the bottom of docs/API.md — spin only while "spinning", skip
// only while "picking" with a count left, pick must be in the pool, results
// only when complete — and throws `ApiError` with the same `detail` shape
// the backend would, so error handling is exercised end to end.
//
// The scoring and season simulation here are a *simplified* stand-in for
// backend/app/engine (weights and thresholds are guesses); only the shapes
// are contractual.

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
} from "./types";
import { ARCHETYPES, FIXTURE_YEARS, buildYear, type FixtureContender } from "./mockCatalog";
import { ALL_METRICS, CATEGORY_LABELS, CATEGORY_ORDER, MODE_LABELS, decadeOf } from "../lib/labels";

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
  "Detroit Film Critics Society",
  "Online Film Critics Society",
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

/** Convex threshold curve on the 0-600 ballot scale: 210 → ~575. */
function thresholdFor(index: number): number {
  const t = (index - 1) / 29;
  return Math.round(210 + 365 * Math.pow(t, 1.8));
}

/** Emphasis vectors: acting bodies weight actors, guilds weight their craft. */
function emphasisFor(index: number): Record<Category, number> {
  const name = CEREMONY_NAMES[index - 1];
  const base: Record<Category, number> = {
    picture: 1, director: 1, actor: 1, actress: 1, supporting_actor: 1, supporting_actress: 1,
  };
  if (name.includes("Screen Actors") || name.includes("Casting")) {
    base.actor = 2; base.actress = 2; base.supporting_actor = 1.6; base.supporting_actress = 1.6; base.picture = 0.6; base.director = 0.4;
  } else if (name.includes("Directors Guild")) {
    base.director = 3; base.picture = 1.5;
  } else if (name.includes("Producers Guild") || name.includes("Editors") || name.includes("Art Directors") || name.includes("Audio") || name.includes("Costume")) {
    base.picture = 2.5; base.director = 1.3;
  } else if (index % 3 === 0) {
    base.actress = 1.4; base.supporting_actress = 1.3;
  } else if (index % 3 === 1) {
    base.actor = 1.4; base.supporting_actor = 1.3;
  }
  return base;
}

/** Pick score weights; renormalised over whatever metrics are non-null. */
const WEIGHTS: Record<string, number> = {
  academy: 0.5, prestige: 0.17, acclaim: 0.13, box_office: 0.12, popularity: 0.08,
};

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

function maskForMode(c: Contender, mode: Mode): Contender {
  if (mode === "classic") return c;
  return {
    ...c,
    archetype: null,
    metrics: { acclaim: null, popularity: null, box_office: null, prestige: null },
    stats: { imdb_rating: null, imdb_votes: null, box_office_usd: null, rt_critic: null, rt_audience: null, metascore: null },
  };
}

/* ---- The adapter ----------------------------------------------------- */

export interface MockOptions {
  /** Artificial delay per call so loading states are visible; 0 in tests. */
  latencyMs?: number;
  /** Simulate the analytics endpoints returning 404 (models not trained). */
  analyticsTrained?: boolean;
}

interface MockGame {
  state: GameState;
  random: () => number;
  results: GameResults | null;
}

export function createMockApi(options: MockOptions = {}): Api {
  const latency = options.latencyMs ?? 200;
  const analyticsTrained = options.analyticsTrained ?? true;

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

  /** Decade first, then a year inside it — mirrors docs/GAME_DESIGN.md. */
  const drawYear = (random: () => number, avoid?: number): number => {
    const candidates = years.filter((y) => y !== avoid);
    const decade = decades[Math.floor(random() * decades.length)];
    const inDecade = candidates.filter((y) => decadeOf(y) === decade);
    const from = inDecade.length ? inDecade : candidates;
    return from[Math.floor(random() * from.length)];
  };

  const snapshot = (g: MockGame): GameState => structuredClone(g.state);

  /** Run the 30-ceremony season once the sixth pick lands. */
  const computeResults = (g: MockGame): GameResults => {
    const picks: PickResult[] = g.state.picks.map((p) => {
      const entry = pool(p.year, p.category).find((c) => c.contender.contender_id === p.contender.contender_id);
      const full = entry?.contender ?? p.contender;
      const academy = entry?.academy ?? 0;
      const winner = pool(p.year, p.category).find((c) => c.academy === 100)?.contender ?? null;
      const breakdown = { academy, ...full.metrics };
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
      // Emphasis-weighted mean × 6 keeps the number on the same 0-600 scale.
      const weighted = (Object.keys(emphasis) as Category[]).reduce(
        (s, c) => s + (emphasis[c] / total) * (scoreByCategory[c] ?? 0), 0,
      ) * 6;
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

  return {
    async getMeta(): Promise<Meta> {
      return delay({
        categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
        modes: (Object.keys(MODE_LABELS) as Mode[]).map((id) => ({ id, ...MODE_LABELS[id] })),
        years: { min: 1927, max: 2025 },
        decades: ["1920s", "1930s", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
        ceremonies: CEREMONY_NAMES.map((name, i) => ({ index: i + 1, name, threshold: thresholdFor(i + 1) })),
        metrics: ALL_METRICS.map((m) => ({ ...m })),
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
          skips_remaining: { year: 1, category: 1 },
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
      const year = drawYear(g.random);
      const category = g.state.category_order[g.state.round - 1];
      g.state.current_spin = { year, category, decade: decadeOf(year) };
      g.state.status = "picking";
      return delay(snapshot(g));
    },

    async skip(id, kind: SkipKind): Promise<GameState> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Skips are only valid while picking.");
      const spin = s.current_spin!;
      if (kind === "year") {
        if (s.skips_remaining.year <= 0) fail(409, "No year skips remaining.");
        s.skips_remaining.year -= 1;
        const year = drawYear(g.random, spin.year);
        s.current_spin = { ...spin, year, decade: decadeOf(year) };
      } else if (kind === "category") {
        if (s.skips_remaining.category <= 0) fail(409, "No category skips remaining.");
        s.skips_remaining.category -= 1;
        // Move the current category to the end and take the next one.
        const idx = s.round - 1;
        const [current] = s.category_order.splice(idx, 1);
        s.category_order.push(current);
        s.current_spin = { ...spin, category: s.category_order[idx] };
      } else {
        fail(422, "Unknown skip kind.");
      }
      return delay(snapshot(g));
    },

    async getCandidates(id, query: CandidatesQuery = {}): Promise<Contender[]> {
      const g = getGameOrFail(id);
      const s = g.state;
      if (s.status !== "picking" || !s.current_spin) fail(409, "Candidates are only available while picking.");
      const spin = s.current_spin!;
      let list = pool(spin.year, spin.category).map((c) => maskForMode(c.contender, s.mode));

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
      const entry = pool(spin.year, spin.category).find((c) => c.contender.contender_id === contenderId);
      if (!entry) fail(404, "Contender is not in the current pool.");
      const pick: Pick = {
        round: s.round,
        category: spin.category,
        year: spin.year,
        contender: maskForMode(entry!.contender, s.mode),
      };
      s.picks.push(pick);
      if (s.picks.length >= 6) {
        s.status = "complete";
        s.round = 6;
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

    async health() {
      return delay({ status: "ok" as const });
    },
  };
}
