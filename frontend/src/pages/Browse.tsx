// Browse: the unmasked archive. Route "/browse" (src/App.tsx).
//
// GET /api/catalog/years/{year}?category=… returns `BrowseContender` rows:
// the same objects the game deals, but with nothing hidden. This is the
// study screen, where you can look up which year was thin and who actually
// won it before you draft it for real. Nothing here mutates a game.
//
// The Winner / Nominated badges come from each row's `academy` object, which
// only this endpoint carries (docs/API.md, "BrowseContender"). If a server
// omits it the badges simply do not render. That object is the outcome, not
// the `ceremony` metric a pick is scored on: a pair of flags about this one
// category, which is why it kept its name when the metric changed.

import { useMemo, useState } from "react";
import { api } from "../api";
import type { BrowseContender, Category } from "../api/types";
import { useAsync } from "../lib/useAsync";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../lib/labels";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";
import { ContenderCard } from "../components/play/ContenderCard";

/** The catalog starts at 1950; earlier pools were padding (docs/DATA.md). */
const FIRST_YEAR = 1950;
const LAST_YEAR = new Date().getFullYear();
/** A year that exists in both the real seed data and the mock fixtures. */
const DEFAULT_YEAR = 1994;

type CategoryFilter = Category | "all";

export function BrowsePage() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [category, setCategory] = useState<CategoryFilter>("all");

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = LAST_YEAR; y >= FIRST_YEAR; y--) out.push(y);
    return out;
  }, []);

  const { data, loading, error, reload } = useAsync<BrowseContender[]>(
    () => api.getCatalogYear(year, category === "all" ? undefined : category),
    [year, category],
  );

  // Group by category so an "all" view still reads as eight shortlists rather
  // than one undifferentiated wall of cards.
  const groups = useMemo(() => {
    const rows = data ?? [];
    return CATEGORY_ORDER.map((c) => ({
      category: c,
      contenders: rows.filter((row) => row.category === c),
    })).filter((g) => g.contenders.length > 0);
  }, [data]);

  const total = data?.length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Archive"
        title={`The pool, ${year}`}
        lede="Every notable release of the year, unmasked: full metrics, the archetype, who was nominated and who won. This is the pool the slot machine deals from."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-bone-dim">
              Year
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-md border border-line bg-ink-2 px-2 py-2 text-sm tabular-nums text-bone focus:border-accent focus:outline-none"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-bone-dim">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as CategoryFilter)}
                className="rounded-md border border-line bg-ink-2 px-2 py-2 text-sm text-bone focus:border-accent focus:outline-none"
              >
                <option value="all">All eight</option>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      {loading && <PageLoader label={`Loading ${year}`} />}

      {/* A missing year is a 404 with a helpful `detail`, so show it verbatim. */}
      {!loading && error && (
        <ErrorBanner message={error} onRetry={reload} className="mb-6" />
      )}

      {!loading && !error && total === 0 && (
        <EmptyState title={`Nothing catalogued for ${year}`}>
          Try another year, or widen the category filter. Early ceremonies had no supporting
          categories at all, though every year has a horror and a comedy crown.
        </EmptyState>
      )}

      {!loading && !error && total > 0 && (
        <div className="flex flex-col gap-10">
          <p className="text-xs text-muted">
            {total} contender{total === 1 ? "" : "s"} across {groups.length} categor
            {groups.length === 1 ? "y" : "ies"}.
          </p>
          {groups.map((group) => (
            <section key={group.category} aria-labelledby={`cat-${group.category}`}>
              <h2
                id={`cat-${group.category}`}
                className="mb-4 flex items-baseline gap-3 text-2xl"
              >
                {CATEGORY_LABELS[group.category]}
                <span className="text-xs tabular-nums text-muted">
                  {group.contenders.length} in pool
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-3 xl:grid-cols-4">
                {group.contenders.map((c) => (
                  <CatalogCard key={c.contender_id} contender={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A catalog row: the regular ContenderCard with an Academy badge pinned to its
 * top edge. Reusing the card keeps Browse and Play visually identical, which
 * is the point: you study the same object you later draft.
 */
function CatalogCard({ contender }: { contender: BrowseContender }) {
  // `academy` is present only on this endpoint; a server that omits it simply
  // renders no badge rather than breaking the page.
  const academy = contender.academy;
  const badge = academy?.won ? "winner" : academy?.nominated ? "nominee" : null;

  return (
    <div className="relative">
      {badge && (
        <span className="absolute -top-2 left-3 z-10">
          <Chip tone={badge === "winner" ? "accent" : "neutral"} className="bg-ink">
            {badge === "winner" ? "Winner" : "Nominated"}
          </Chip>
        </span>
      )}
      <ContenderCard contender={contender} />
    </div>
  );
}
