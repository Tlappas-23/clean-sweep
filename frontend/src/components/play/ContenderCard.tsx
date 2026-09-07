// ContenderCard: one candidate in the grid (and, unmasked, in Browse).
//
// The poster is the anchor. A pool of thirty films reads as a wall of posters
// long before it reads as a table of numbers, and recognising a title from its
// artwork is a real part of playing well — which is why `poster_url` arrives in
// cinephile mode too (docs/API.md, `Contender`). Everything else stacks
// underneath it: identity, genre chips, the four metric bars, the raw stats
// line, and the career line for the categories that have a person.
//
// Three details keep the grid calm while images stream in:
//   * the poster frame is a fixed 2:3 box, so nothing reflows as they load;
//   * `loading="lazy"` keeps a long pool cheap;
//   * a null `poster_url` *or* a failed load falls back to a titled plate,
//     because roughly nothing in this catalog is guaranteed to exist.
//
// In cinephile mode every number arrives null and the card collapses to the
// poster and the identity block. `selected` draws the gold highlight ring.

import { useState } from "react";
import type { Contender } from "../../api/types";
import { CARD_METRICS, isPersonCategory } from "../../lib/labels";
import { formatUsd, formatVotes } from "../../lib/format";
import { Chip } from "../ui/Chip";
import { MetricBar } from "./MetricBar";

interface Props {
  contender: Contender;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Hide the bars and stats entirely (cinephile) instead of rendering dashes. */
  showMetrics?: boolean;
}

export function ContenderCard({ contender: c, selected = false, onSelect, showMetrics = true }: Props) {
  const interactive = Boolean(onSelect);
  const hasAnyMetric = Object.values(c.metrics).some((v) => v !== null);
  const hasAnyStat = c.stats.imdb_rating !== null || c.stats.imdb_votes !== null;
  // The career line is only meaningful where there is a person: the film
  // categories come back zeroed, and so does everything in cinephile mode.
  const showCareer =
    showMetrics &&
    isPersonCategory(c.category) &&
    (c.career.prior_nominations > 0 || c.career.prior_wins > 0 || c.career.billing !== null);

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? () => onSelect?.(c.contender_id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(c.contender_id);
              }
            }
          : undefined
      }
      className={[
        "group flex h-full flex-col overflow-hidden rounded-xl border bg-ink-2/80 transition-all duration-200",
        interactive ? "hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold" : "",
        selected ? "border-gold shadow-glow" : "border-line",
      ].join(" ")}
    >
      <Poster url={c.poster_url} title={c.film_title} year={c.year} archetype={c.archetype} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Full width: the archetype badge now lives on the poster, so a long
            title wraps at most twice instead of being squeezed into a column. */}
        <header className="min-w-0">
          {c.person_name ? (
            <>
              <h3 className="truncate text-lg leading-tight text-ivory" title={c.person_name}>
                {c.person_name}
              </h3>
              <p className="truncate text-sm text-ivory-dim" title={c.film_title}>
                {c.film_title} <span className="text-muted">({c.year})</span>
              </p>
              {c.character && <p className="truncate text-xs italic text-muted">as {c.character}</p>}
            </>
          ) : (
            <>
              <h3 className="line-clamp-2 text-lg leading-tight text-ivory" title={c.film_title}>
                {c.film_title}
              </h3>
              <p className="truncate text-sm text-ivory-dim">
                {c.year}
                {c.runtime_minutes !== null && (
                  <span className="text-muted"> · {c.runtime_minutes} min</span>
                )}
              </p>
            </>
          )}
        </header>

        {c.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {c.genres.slice(0, 4).map((g) => (
              <Chip key={g}>{g}</Chip>
            ))}
          </div>
        )}

        {showCareer && <CareerLine career={c.career} />}

        {showMetrics && (hasAnyMetric || hasAnyStat) && (
          <div className="mt-auto flex flex-col gap-1.5 border-t border-line/60 pt-3">
            {CARD_METRICS.map((m) => (
              <MetricBar key={m.id} label={m.label} value={c.metrics[m.id]} accent={m.id === "prestige"} title={m.description} />
            ))}
            <StatLine contender={c} />
          </div>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Poster                                                              */
/* ------------------------------------------------------------------ */

/**
 * The 2:3 poster frame.
 *
 * The box is sized before the image exists, so a grid of thirty cards lays out
 * once and then fills in. A missing or broken URL swaps in a titled plate
 * rather than a gap: coverage is high but not guaranteed, and a hole in a wall
 * of posters looks like a bug even when it is just an absent file.
 */
function Poster({
  url,
  title,
  year,
  archetype,
}: {
  url: string | null;
  title: string;
  year: number;
  archetype: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const usable = url !== null && !failed;

  return (
    <div className="relative aspect-[2/3] w-full shrink-0 overflow-hidden bg-ink-3">
      {usable ? (
        <img
          src={url}
          alt={`Poster for ${title} (${year})`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-ink-3 to-ink px-4 text-center"
          role="img"
          aria-label={`No poster for ${title} (${year})`}
        >
          <span className="text-2xl text-gold/40" aria-hidden>
            ★
          </span>
          <span className="font-display text-base leading-tight text-ivory-dim">{title}</span>
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted">No poster</span>
        </div>
      )}
      {/* A short fade under the poster so the identity block below reads as
          part of the same card rather than a caption stuck to an image. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ink-2 via-ink-2/70 to-transparent" />
      {/* The archetype rides on the poster rather than beside the title. Next
          to the title it competed for the same line and squeezed long names
          ("Saving Private Ryan") into three cramped lines; here it reads at a
          glance across the whole grid and the title gets the full width. */}
      {archetype && (
        <span
          className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-gold/30 bg-ink/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-gold backdrop-blur-sm"
          title="Archetype (clustering label)"
        >
          {archetype}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Career + stats lines                                                */
/* ------------------------------------------------------------------ */

/**
 * "2 prior nominations · 1 win · top billed".
 *
 * The record is strictly *before* this film year, so it hints without
 * answering: a much-nominated name in a strong year is a good bet, not a
 * guarantee.
 */
function CareerLine({ career }: { career: Contender["career"] }) {
  const parts: string[] = [];
  if (career.prior_nominations > 0) {
    parts.push(`${career.prior_nominations} prior nomination${career.prior_nominations === 1 ? "" : "s"}`);
  }
  if (career.prior_wins > 0) {
    parts.push(`${career.prior_wins} win${career.prior_wins === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) parts.push("No prior nominations");
  if (career.billing !== null) {
    parts.push(career.billing === 1 ? "top billed" : `billed ${career.billing}${ordinal(career.billing)}`);
  }

  return (
    <p className="text-[11px] text-ivory-dim" title="Academy record before this film year, and cast billing">
      {parts.join(" · ")}
    </p>
  );
}

/** 2 → "nd", 3 → "rd", everything else here → "th". */
function ordinal(n: number): string {
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}

/**
 * The raw line under the bars: rating, votes, box office, runtime.
 *
 * Box office is missing for roughly a third of the catalog (and most of the
 * silent era), and the critics' scores are sparser still, so a missing number
 * renders as an em dash and the critics' scores are simply omitted when
 * absent — the line has to look deliberate, not broken.
 */
function StatLine({ contender: c }: { contender: Contender }) {
  const critics = [
    c.stats.rt_critic === null ? null : `RT ${c.stats.rt_critic}`,
    c.stats.metascore === null ? null : `MC ${c.stats.metascore}`,
  ].filter((s): s is string => s !== null);

  // Each stat is its own nowrap chip so the line breaks *between* stats
  // rather than through one: "1.1M / votes" split across two lines reads as a
  // rendering bug. The separator is a flex gap, not a character, so a stat
  // that wraps to the next line never drags a stray interpunct with it.
  const stats: { key: string; node: React.ReactNode; title?: string }[] = [
    {
      key: "imdb",
      node: `IMDb ${c.stats.imdb_rating === null ? "—" : c.stats.imdb_rating.toFixed(1)}`,
      title: "IMDb rating",
    },
    { key: "votes", node: `${formatVotes(c.stats.imdb_votes)} votes`, title: "IMDb vote count" },
    { key: "gross", node: formatUsd(c.stats.box_office_usd), title: "Worldwide box office" },
  ];
  if (c.runtime_minutes !== null) {
    stats.push({ key: "runtime", node: `${c.runtime_minutes} min` });
  }
  for (const critic of critics) {
    stats.push({ key: critic, node: critic, title: "Critic score" });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
      {stats.map((stat, index) => (
        <span key={stat.key} className="whitespace-nowrap" title={stat.title}>
          {index > 0 && <span className="mr-2 text-line" aria-hidden>·</span>}
          {stat.node}
        </span>
      ))}
    </div>
  );
}
