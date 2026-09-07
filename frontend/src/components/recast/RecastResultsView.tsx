// RecastResultsView: the reveal for a finished recast.
//
// Sits under src/components/recast/. Three parts: the headline score, a line
// naming the strongest and weakest calls, and then one panel per role.
//
// The panel is where the mode makes its case. A single fit number is an
// assertion; the four components underneath it are the argument, and they are
// what let a player disagree with the score in a specific way — "it marked me
// down on era, and I think era should not matter here" is a real reaction,
// and it is only available if the four bars are on screen. They are drawn
// with the same MetricBar the Oscars mode uses, so a 0-100 bar means the same
// thing everywhere in the app.
//
// Every role also reveals the **best available** casting on the shortlist the
// player was actually shown — not the best actor in the catalog. Without it
// a fit of 61 is unreadable: it could be the best that shortlist allowed or a
// name that walked past three better ones. With it, every role is a
// comparison the player can check for themselves against the cards they saw.
//
// The stagger is the Oscars and grid reveals': panels arriving in sequence
// read as a reveal, all at once as a wall. Under `prefers-reduced-motion` the
// delay collapses to zero and the CSS guard in src/index.css flattens the
// animation itself.

import type { CastingResult, FitBreakdown, RecastResults } from "../../api/types";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { MetricBar } from "../play/MetricBar";
import { Chip } from "../ui/Chip";
import { ActorLine } from "./ActorOption";

/** Gap between consecutive role reveals. Five roles land inside a second. */
const STAGGER_MS = 140;

/** The score is a mean of the per-role fits, so it shares their scale. */
export const MAX_FIT = 100;

/**
 * The four components, in weight order, with what each weight is.
 *
 * The order is the one in docs/GAME_DESIGN.md §8 and it is deliberate: the
 * bars read top to bottom as "how much did this matter". The weight lives in
 * the tooltip rather than the label because it is the answer to a second
 * question, not part of the name.
 */
const COMPONENTS: { key: keyof FitBreakdown; label: string; title: string }[] = [
  {
    key: "stature",
    label: "Stature",
    title: "Weight 0.35 — can this name carry a part this size? Compared on reach, so the gap that matters is order-of-magnitude.",
  },
  {
    key: "role_fit",
    label: "Role fit",
    title: "Weight 0.30 — do they actually play parts this size? From their lead share, scored against the role rather than against the original actor.",
  },
  {
    key: "genre",
    label: "Genre",
    title: "Weight 0.20 — do they work in this kind of film?",
  },
  {
    key: "era",
    label: "Era",
    title: "Weight 0.15 — are they plausible contemporaries? The lightest weight of the four: a knowingly anachronistic recast should cost something, not everything.",
  },
];

export function RecastResultsView({ results }: { results: RecastResults }) {
  const reduced = useReducedMotion();

  return (
    <div className="flex flex-col gap-8">
      <ScoreHeader results={results} />

      <div className="rule-accent" aria-hidden />

      <section aria-labelledby="recast-reveal" className="flex flex-col gap-4">
        <h2 id="recast-reveal" className="text-2xl">
          Role by role
        </h2>
        <p className="-mt-2 max-w-2xl text-sm text-bone-dim">
          Each part shows what your choice scored on the four things the fit is made of, and the
          strongest casting that was available on the shortlist you were shown.
        </p>
        <ul className="flex flex-col gap-4">
          {results.castings.map((casting, i) => (
            <li key={casting.billing}>
              <CastingReveal casting={casting} delayMs={reduced ? 0 : i * STAGGER_MS} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The headline: the mean fit, and which two calls it was pulled by. */
function ScoreHeader({ results }: { results: RecastResults }) {
  const { score, castings, strongest, weakest, game } = results;
  // `strongest` and `weakest` are billings, not indexes into `castings`.
  const byBilling = (billing: number | null): CastingResult | null =>
    billing === null ? null : (castings.find((c) => c.billing === billing) ?? null);
  const best = byBilling(strongest);
  const worst = byBilling(weakest);

  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <p className="text-[11px] uppercase tracking-[0.35em] text-accent">
        {game.film.title} recast
      </p>
      <p className="font-display text-6xl leading-none text-bone sm:text-7xl">
        <span className="tabular-nums">{Math.round(score)}</span>
        <span className="text-3xl text-muted"> / {MAX_FIT}</span>
      </p>
      <p className="text-sm text-bone-dim">
        Mean fit across{" "}
        <span className="tabular-nums text-bone">{castings.length}</span> roles
      </p>

      {/* Naming the two ends is the fastest way to read a round: one call
          carried it and one call cost it. They can be the same role only when
          there is exactly one, which the server never sends. */}
      {best && worst && (
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
          <span className="text-win">
            Strongest: {best.replacement.name} as {best.character ?? `#${best.billing}`}{" "}
            <span className="tabular-nums">({Math.round(best.fit)})</span>
          </span>
          <span aria-hidden className="text-muted">
            ·
          </span>
          <span className="text-loss">
            Weakest: {worst.replacement.name} as {worst.character ?? `#${worst.billing}`}{" "}
            <span className="tabular-nums">({Math.round(worst.fit)})</span>
          </span>
        </p>
      )}
    </header>
  );
}

/** One role, opened up: the swap, the fit, the four components, the best there was. */
export function CastingReveal({
  casting,
  delayMs,
}: {
  casting: CastingResult;
  delayMs: number;
}) {
  // Whether the player found the best casting on offer. Comparing ids rather
  // than fits, because two actors can tie and only one of them was chosen.
  const foundBest = casting.best_available?.person_id === casting.replacement.person_id;

  return (
    <article
      className={`flex animate-rise flex-col gap-4 rounded-xl border bg-ink-2/80 p-4 sm:p-5 ${
        foundBest ? "border-accent/60" : "border-line"
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">
            <span className="tabular-nums">#{casting.billing}</span> billed
          </p>
          <h3 className="truncate text-lg leading-tight text-bone">
            {casting.character ?? "Uncredited part"}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={foundBest ? "accent" : "neutral"}>{foundBest ? "Best available" : "Cast"}</Chip>
          <p className="text-right">
            <span className="font-display text-2xl tabular-nums text-accent">
              {Math.round(casting.fit)}
            </span>
            <span className="text-sm text-muted"> / {MAX_FIT}</span>
          </p>
        </div>
      </header>

      {/* The swap. Two names and an arrow: the sentence the round is about. */}
      <div className="flex items-center gap-3">
        <ActorLine actor={casting.original} label="Originally" />
        <span aria-hidden className="shrink-0 text-lg text-muted">
          →
        </span>
        <ActorLine actor={casting.replacement} label="You cast" tone="accent" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">How the fit is made</p>
          {COMPONENTS.map((component, i) => (
            <MetricBar
              key={component.key}
              label={component.label}
              value={casting.breakdown[component.key]}
              // The heaviest component is the headline one, in the accent; the rest
              // are the same bone the Oscars card uses for a scored metric.
              tone={i === 0 ? "accent" : "default"}
              title={component.title}
            />
          ))}
        </div>

        <BestAvailable casting={casting} foundBest={foundBest} />
      </div>
    </article>
  );
}

/**
 * The comparison: the strongest casting the shortlist actually offered.
 *
 * Three cases, and each says something different. The player found it; the
 * player did not, and here is who they walked past and by how much; or the
 * shortlist was empty and there is nothing to compare against — which the
 * server signals with a null `best_available` rather than an invented one.
 */
function BestAvailable({ casting, foundBest }: { casting: CastingResult; foundBest: boolean }) {
  const best = casting.best_available;

  if (!best || casting.best_fit === null) {
    return (
      <div className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">
        That shortlist had nobody else to offer, so there is nothing to compare this against.
      </div>
    );
  }

  if (foundBest) {
    return (
      <div className="flex flex-col justify-center gap-1 rounded-lg border border-accent/40 bg-accent/5 p-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-accent">Best available</p>
        <p className="text-sm text-bone">
          Nobody on that shortlist fitted the part better. You took the strongest casting on offer.
        </p>
      </div>
    );
  }

  const gap = Math.round(casting.best_fit - casting.fit);
  return (
    <div className="flex flex-col justify-center gap-2 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <ActorLine actor={best} label="Best available" tone="accent" />
        <span className="shrink-0 text-right">
          <span className="font-display text-xl tabular-nums text-bone">
            {Math.round(casting.best_fit)}
          </span>
        </span>
      </div>
      <p className="text-xs text-muted">
        {/* The gap is the useful number: it says whether this was a near miss
            or a different judgement entirely. */}
        The strongest casting on the shortlist you were shown, {gap} point
        {gap === 1 ? "" : "s"} ahead of yours.
      </p>
    </div>
  );
}
