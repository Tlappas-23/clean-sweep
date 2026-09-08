// CandidateToolbar: search box + sort dropdown above the contender grid.
//
// Metric sorts are hidden in cinephile mode because every metric is null.
// The count also names which of the board's years the pool belongs to, since
// a round now deals three and the grid can be showing one of them or all of
// them at once (the year itself is chosen on the reels above).
import type { CandidateSort, Mode } from "../../api/types";

interface Props {
  mode: Mode;
  query: string;
  sort: CandidateSort;
  count: number;
  /** The year the pool is scoped to, or `null` for every year on the board. */
  viewYear: number | null;
  onQuery: (q: string) => void;
  onSort: (s: CandidateSort) => void;
}

const METRIC_SORTS: { id: CandidateSort; label: string }[] = [
  { id: "prestige", label: "Prestige" },
  { id: "box_office", label: "Box office" },
  { id: "critics", label: "Critics" },
  { id: "audience", label: "Audience" },
  { id: "popularity", label: "Popularity" },
];
const TEXT_SORTS: { id: CandidateSort; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "person", label: "Person" },
];

export function CandidateToolbar({ mode, query, sort, count, viewYear, onQuery, onSort }: Props) {
  const options = mode === "cinephile" ? TEXT_SORTS : [...METRIC_SORTS, ...TEXT_SORTS];
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Search contenders</span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search title, person or character…"
          className="w-full rounded-md border border-line bg-ink-2 px-3 py-2 text-sm text-bone placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-bone-dim">
        Sort by
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as CandidateSort)}
          className="rounded-md border border-line bg-ink-2 px-2 py-2 text-sm text-bone focus:border-accent focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted">
        <span className="tabular-nums">{count}</span> in pool ·{" "}
        {viewYear === null ? "all years on the board" : <span className="tabular-nums">{viewYear}</span>}
      </span>
    </div>
  );
}
