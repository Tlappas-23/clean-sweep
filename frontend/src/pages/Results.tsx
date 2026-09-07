// Results: the season read-out. Route "/results/:gameId" (src/App.tsx).
//
// GET /api/games/{id}/results returns everything at once, so this page is a
// single fetch plus five presentational blocks:
//   RecordHeader      the 30-0 moment (exported; covered by Results.test.tsx)
//   ballot strength   0-800 with the eight pick scores that make it up
//   CeremonyTimeline  all 30 stops, weighted strength against the threshold
//   PickReveal        one card per pick, finally unmasked
//   submit + replay   leaderboard form and a fresh game
//
// The reveal cards stagger in with a per-index animation delay; with
// prefers-reduced-motion the delay collapses to zero (the CSS in
// src/index.css already flattens the animation itself).

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import type { CeremonyResult, GameResults, PickResult } from "../api/types";
import { useGame } from "../state/GameContext";
import { useToast } from "../state/ToastContext";
import { useAsync } from "../lib/useAsync";
import { useReducedMotion } from "../lib/useReducedMotion";
import { formatMetric, formatRecord } from "../lib/format";
import {
  CATEGORY_LABELS,
  CATEGORY_SHORT,
  MAX_BALLOT_STRENGTH,
  PRESTIGE_METRIC,
  SCORED_METRICS,
  formatWeight,
  isGenreCategory,
  outcomeWording,
} from "../lib/labels";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageLoader } from "../components/ui/Spinner";
import { MetricBar } from "../components/play/MetricBar";

/** Ballot strength is the sum of the eight 0-100 pick scores. */
const MAX_STRENGTH = MAX_BALLOT_STRENGTH;
/** Milliseconds between consecutive reveal cards. */
const STAGGER_MS = 90;

export function ResultsPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const { createGame } = useGame();
  const reduced = useReducedMotion();

  const { data, loading, error, status, reload } = useAsync<GameResults>(
    () => api.getResults(gameId),
    [gameId],
  );

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [replaying, setReplaying] = useState(false);

  // Scroll back to the top when a different game's results load — arriving
  // from Play the viewport is wherever the grid left it.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [gameId, reduced]);

  if (loading) return <PageLoader label="Running the season" />;

  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-16">
        <ErrorBanner message={error ?? "No results for that game."} onRetry={reload} />
        <div className="flex justify-center gap-3">
          {/* 409 means the ballot is not finished yet — offer the way back. */}
          {status === 409 && (
            <Link to={`/play/${gameId}`}>
              <Button variant="secondary">Finish the ballot</Button>
            </Link>
          )}
          <Link to="/">
            <Button>New game</Button>
          </Link>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const entry = await api.submit(gameId, name.trim());
      setSubmitted(true);
      push(`Submitted as ${entry.player_name}.`, "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not submit that score.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function playAgain() {
    setReplaying(true);
    // Same mode, fresh spins: a replay of a daily seed would repeat the ballot.
    const game = await createGame(data!.game.mode);
    setReplaying(false);
    if (game) navigate(`/play/${game.id}`);
  }

  const { game, ballot_strength, wins, losses, clean_sweep, ceremonies, picks, weakest_category } =
    data;

  return (
    <div className="flex flex-col gap-12">
      <RecordHeader wins={wins} losses={losses} cleanSweep={clean_sweep} mode={game.mode} seed={game.seed} />

      {/* ---- Ballot strength ------------------------------------------ */}
      <section aria-labelledby="strength" className="rounded-2xl border border-line bg-ink-2/70 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="strength" className="text-[11px] uppercase tracking-[0.25em] text-accent">
              Ballot strength
            </h2>
            <p className="mt-1 font-display text-4xl tabular-nums text-bone">
              {ballot_strength}
              <span className="ml-2 text-lg text-muted">/ {MAX_STRENGTH}</span>
            </p>
          </div>
          {weakest_category && (
            <p className="max-w-sm text-sm text-bone-dim">
              Weakest slot:{" "}
              <span className="text-loss">{CATEGORY_LABELS[weakest_category]}</span>. Every ceremony
              that leans on it is a ceremony you gave away.
            </p>
          )}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-deep via-accent to-accent-soft transition-[width] duration-700"
            style={{ width: `${(ballot_strength / MAX_STRENGTH) * 100}%` }}
          />
        </div>

        {/* The eight pick scores that add up to the number above. */}
        <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {picks.map((p) => (
            <li
              key={p.pick.category}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                p.pick.category === weakest_category ? "border-loss/40 bg-loss/5" : "border-line"
              }`}
            >
              <span className="truncate text-bone-dim">{CATEGORY_SHORT[p.pick.category]}</span>
              <span className="shrink-0 font-display tabular-nums text-bone">
                {formatMetric(p.pick_score, 1)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- The 30-ceremony season ----------------------------------- */}
      <section aria-labelledby="season">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 id="season" className="text-3xl">
            The season
          </h2>
          <p className="text-xs text-bone-dim">
            Thirty stops, thresholds rising. Each one weights the eight slots differently.
          </p>
        </div>
        <ol className="flex flex-col gap-1.5">
          {ceremonies.map((c) => (
            <CeremonyRow key={c.index} ceremony={c} />
          ))}
        </ol>
      </section>

      {/* ---- Per-pick reveals ----------------------------------------- */}
      <section aria-labelledby="reveals">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 id="reveals" className="text-3xl">
            Your ballot, unmasked
          </h2>
          <p className="text-xs text-bone-dim">
            The Academy metric was hidden while you drafted — the genre crown too. Here they are.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {picks.map((p, i) => (
            <PickReveal
              key={p.pick.category}
              result={p}
              delayMs={reduced ? 0 : i * STAGGER_MS}
            />
          ))}
        </div>
      </section>

      {/* ---- Leaderboard + replay -------------------------------------- */}
      <section className="grid gap-5 rounded-2xl border border-accent/30 bg-accent/5 p-6 sm:grid-cols-2">
        <div>
          <h2 className="text-xl text-bone">Submit to the leaderboard</h2>
          <p className="mt-1 text-sm text-bone-dim">
            {game.seed
              ? `This was the ${game.seed} daily — you are on the same spins as everyone else.`
              : "Unseeded games are ranked all-time."}
          </p>
          {submitted ? (
            <p className="mt-4 text-sm text-win">
              Score submitted.{" "}
              <Link to="/leaderboard" className="text-accent hover:underline">
                See where you landed
              </Link>
              .
            </p>
          ) : (
            <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => void submit(e)}>
              <label className="flex-1">
                <span className="sr-only">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="Your name"
                  className="w-full rounded-md border border-line bg-ink-2 px-3 py-2 text-sm text-bone placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <Button type="submit" loading={submitting} disabled={!name.trim()}>
                Submit
              </Button>
            </form>
          )}
        </div>

        <div className="flex flex-col items-start justify-center gap-3 sm:items-end">
          <Button size="lg" variant="secondary" onClick={() => void playAgain()} loading={replaying}>
            Play again
          </Button>
          <Link to="/browse" className="text-xs text-bone-dim hover:text-bone">
            Study the years you lost →
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record header                                                       */
/* ------------------------------------------------------------------ */

interface RecordHeaderProps {
  wins: number;
  losses: number;
  cleanSweep: boolean;
  mode?: GameResults["game"]["mode"];
  seed?: string | null;
}

/**
 * The headline "27–3". A clean sweep (30-0) gets the silvered gradient, the
 * glow animation and its own caption — it is the whole point of the game.
 * Exported so src/pages/Results.test.tsx can assert both treatments.
 */
export function RecordHeader({ wins, losses, cleanSweep, mode, seed }: RecordHeaderProps) {
  return (
    <header className="flex flex-col items-center pt-4 text-center">
      <p className="text-[11px] uppercase tracking-[0.4em] text-accent">
        {cleanSweep ? "A perfect season" : "Final record"}
      </p>
      <p
        className={`mt-3 font-display text-6xl tabular-nums leading-none sm:text-8xl ${
          cleanSweep ? "text-silvered animate-glow" : "text-bone"
        }`}
      >
        {formatRecord(wins, losses)}
      </p>
      {cleanSweep ? (
        <p className="mt-5 text-2xl uppercase tracking-[0.3em] text-silvered sm:text-3xl">
          Clean sweep
        </p>
      ) : (
        <p className="mt-4 max-w-md text-sm text-bone-dim">
          {wins} of 30 ceremonies. A clean sweep needs all thirty — the last few demand a nearly
          perfect ballot.
        </p>
      )}
      {(mode || seed) && (
        <div className="mt-4 flex items-center gap-2">
          {mode && <Chip tone="neutral">{mode}</Chip>}
          {seed && <Chip tone="accent">daily {seed}</Chip>}
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Ceremony timeline                                                   */
/* ------------------------------------------------------------------ */

/**
 * One stop on the circuit. The bar shows the emphasis-weighted strength on the
 * 0-800 scale with a tick where this ceremony's threshold sits, which makes
 * the near-misses obvious. Emphasis chips list the categories this body
 * weights above par.
 */
function CeremonyRow({ ceremony: c }: { ceremony: CeremonyResult }) {
  const emphasised = (Object.keys(c.emphasis) as (keyof typeof c.emphasis)[])
    .filter((category) => c.emphasis[category] > 1)
    .sort((a, b) => c.emphasis[b] - c.emphasis[a]);

  return (
    <li
      className={`grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 sm:grid-cols-[2rem_14rem_minmax(0,1fr)_5rem] ${
        c.won ? "border-win/30 bg-win/5" : "border-loss/25 bg-loss/5"
      }`}
    >
      <span className="font-display text-sm tabular-nums text-muted">{c.index}</span>

      <span className="min-w-0">
        <span className="block truncate text-sm text-bone">{c.name}</span>
        {emphasised.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {emphasised.map((category) => (
              <Chip key={category} title={`Emphasis ×${c.emphasis[category]}`}>
                {CATEGORY_SHORT[category]} ×{c.emphasis[category]}
              </Chip>
            ))}
          </span>
        )}
      </span>

      <span className="col-span-2 sm:col-span-1">
        <span className="relative block h-2 overflow-hidden rounded-full bg-white/10">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${c.won ? "bg-win" : "bg-loss"}`}
            style={{ width: `${Math.min(100, (c.weighted_strength / MAX_STRENGTH) * 100)}%` }}
          />
          {/* Threshold tick: where this ceremony's bar had to reach. */}
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-bone/70"
            style={{ left: `${Math.min(100, (c.threshold / MAX_STRENGTH) * 100)}%` }}
          />
        </span>
        <span className="mt-1 block text-[11px] tabular-nums text-muted">
          {c.weighted_strength} vs {c.threshold} needed
        </span>
      </span>

      <span
        className={`col-span-2 text-right text-[11px] uppercase tracking-[0.2em] sm:col-span-1 ${
          c.won ? "text-win" : "text-loss"
        }`}
      >
        {c.won ? "Won" : "Lost"}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Pick reveal                                                         */
/* ------------------------------------------------------------------ */

/**
 * One drafted contender with the mask lifted: the four scored metrics, the
 * Academy outcome, and who actually won that year and category.
 *
 * The prestige estimate follows below a dashed rule. It is not in
 * `metric_breakdown` — the server stopped sending it there when it stopped
 * being scored — so it is read from the contender itself and rendered muted,
 * captioned as a model estimate. Making that separation visible is the point:
 * the four bars above are the player's record, this one is a guess.
 *
 * `won_oscar` is the contract's name for "this pick scored 100". For the two
 * genre slots that means it took the year's genre crown rather than an Oscar,
 * so every word around the flag comes from `outcomeWording` instead of being
 * hard-coded (src/lib/labels.ts).
 *
 * Exported for src/pages/Results.test.tsx.
 */
export function PickReveal({ result, delayMs }: { result: PickResult; delayMs: number }) {
  const { pick, academy, nominated, won_oscar, actual_winner, metric_breakdown, pick_score } =
    result;
  const c = pick.contender;
  const words = outcomeWording(pick.category);
  // Trust `won_oscar`, never an id comparison against `actual_winner`. A
  // category can have more than one winning row: Best Director was a tie in
  // 1961, 2007 and 2022, so the pick and the row the server returns as "the
  // winner" can be different contenders who both won. Comparing ids would tell
  // a player who picked correctly that they had missed.
  const winnerIsPick = won_oscar;
  // Only worth naming someone else's win when the player did not have it.
  const showActualWinner = !won_oscar && actual_winner !== null;

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border bg-ink-2/80 p-4 animate-rise ${
        won_oscar ? "border-accent/60 shadow-glow" : nominated ? "border-accent/25" : "border-line"
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.25em] text-accent">
            {CATEGORY_LABELS[pick.category]} · {pick.year}
            {isGenreCategory(pick.category) && (
              <span className="ml-1.5 normal-case tracking-normal text-muted">(crown)</span>
            )}
          </p>
          <h3 className="mt-1 truncate text-lg text-bone">{c.person_name ?? c.film_title}</h3>
          {c.person_name && (
            <p className="truncate text-sm text-bone-dim">
              {c.film_title}
              {c.character && <span className="text-muted"> as {c.character}</span>}
            </p>
          )}
        </div>
        <span className="shrink-0">
          {won_oscar ? (
            <Chip tone="accent">{words.won}</Chip>
          ) : nominated ? (
            <Chip tone="neutral">{words.nominated}</Chip>
          ) : (
            <Chip tone="loss">{words.missed}</Chip>
          )}
        </span>
      </header>

      {/* The four scored metrics, Academy first — that is the number the game
          hid, and it carries 60% of the weight. For a genre slot the Academy
          row is reading the crown instead. */}
      <div className="flex flex-col gap-1.5 border-t border-line/60 pt-3">
        {SCORED_METRICS.map((m) => (
          <MetricBar
            key={m.id}
            label={m.label}
            value={m.id === "academy" ? academy : metric_breakdown[m.id]}
            tone={m.id === "academy" ? "accent" : "default"}
            // The Academy row means different things in different slots, so it
            // says which one it is reading here.
            title={
              m.id === "academy"
                ? `This row reads ${words.metric}. Weight ${formatWeight(m.weight)}.`
                : `${m.description} Weight ${formatWeight(m.weight)}.`
            }
          />
        ))}
      </div>

      {/* The model's guess, kept out of the scored block above. */}
      {c.metrics.prestige !== null && (
        <div className="border-t border-dashed border-line/60 pt-2" title={PRESTIGE_METRIC.description}>
          <MetricBar label={PRESTIGE_METRIC.label} value={c.metrics.prestige} tone="muted" />
          <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">
            {PRESTIGE_METRIC.note}
          </p>
        </div>
      )}

      <footer className="mt-auto flex items-end justify-between gap-3 border-t border-line/60 pt-3">
        <p className="text-xs text-bone-dim">
          {winnerIsPick ? (
            <span className="text-accent">
              {isGenreCategory(pick.category) ? "You picked the crown." : "You picked the winner."}
            </span>
          ) : showActualWinner && actual_winner ? (
            <>
              <span className="text-muted">{words.winnerPrefix} </span>
              {actual_winner.person_name ?? actual_winner.film_title}
              {actual_winner.person_name && (
                <span className="text-muted"> · {actual_winner.film_title}</span>
              )}
            </>
          ) : (
            <span className="text-muted">No recorded winner for this slot.</span>
          )}
        </p>
        <p className="shrink-0 text-right">
          <span className="block text-[10px] uppercase tracking-[0.2em] text-muted">Score</span>
          <span className="font-display text-xl tabular-nums text-bone">
            {formatMetric(pick_score, 1)}
          </span>
        </p>
      </footer>
    </article>
  );
}
