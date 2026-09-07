// ContenderCard: one candidate in the grid (and, unmasked, in Browse).
//
// Shows film title + year, the person and role for people categories, genre
// chips, the archetype badge, four metric bars and the raw IMDb line. In
// cinephile mode everything numeric arrives null and the card collapses to
// just the identity block. `selected` draws the gold highlight ring.

import type { Contender } from "../../api/types";
import { CARD_METRICS } from "../../lib/labels";
import { formatVotes } from "../../lib/format";
import { Chip } from "../ui/Chip";
import { MetricBar } from "./MetricBar";

interface Props {
  contender: Contender;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Hide the bars entirely (cinephile) instead of rendering six dashes. */
  showMetrics?: boolean;
}

export function ContenderCard({ contender: c, selected = false, onSelect, showMetrics = true }: Props) {
  const interactive = Boolean(onSelect);
  const hasAnyMetric = Object.values(c.metrics).some((v) => v !== null);
  const hasAnyStat = c.stats.imdb_rating !== null || c.stats.imdb_votes !== null;

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
        "group flex h-full flex-col gap-3 rounded-xl border bg-ink-2/80 p-4 transition-all duration-200",
        interactive ? "hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold" : "",
        selected ? "border-gold shadow-glow" : "border-line",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {c.person_name ? (
            <>
              <h3 className="truncate text-lg leading-tight text-ivory">{c.person_name}</h3>
              <p className="truncate text-sm text-ivory-dim">
                {c.film_title} <span className="text-muted">({c.year})</span>
              </p>
              {c.character && <p className="truncate text-xs italic text-muted">as {c.character}</p>}
            </>
          ) : (
            <>
              <h3 className="text-lg leading-tight text-ivory">{c.film_title}</h3>
              <p className="text-sm text-ivory-dim">
                {c.year}
                {c.runtime_minutes !== null && <span className="text-muted"> · {c.runtime_minutes} min</span>}
              </p>
            </>
          )}
        </div>
        {c.archetype && (
          <Chip tone="gold" title="Archetype (clustering label)">
            {c.archetype}
          </Chip>
        )}
      </header>

      {c.genres.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.genres.slice(0, 4).map((g) => (
            <Chip key={g}>{g}</Chip>
          ))}
        </div>
      )}

      {showMetrics && (hasAnyMetric || hasAnyStat) && (
        <div className="mt-auto flex flex-col gap-1.5 border-t border-line/60 pt-3">
          {CARD_METRICS.map((m) => (
            <MetricBar key={m.id} label={m.label} value={c.metrics[m.id]} accent={m.id === "prestige"} title={m.description} />
          ))}
          <p className="mt-1 text-[11px] text-muted">
            IMDb {c.stats.imdb_rating === null ? "—" : c.stats.imdb_rating.toFixed(1)}
            <span className="mx-1">·</span>
            {formatVotes(c.stats.imdb_votes)} votes
          </p>
        </div>
      )}
    </article>
  );
}
