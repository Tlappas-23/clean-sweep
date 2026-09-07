// CandidateToolbar: search box + sort dropdown above the contender grid.
// Metric sorts are hidden in cinephile mode because every metric is null.
import type { CandidateSort, Mode } from "../../api/types";

interface Props {
  mode: Mode;
  query: string;
  sort: CandidateSort;
  count: number;
  onQuery: (q: string) => void;
  onSort: (s: CandidateSort) => void;
}

const METRIC_SORTS: { id: CandidateSort; label: string }[] = [
  { id: "prestige", label: "Prestige" },
  { id: "acclaim", label: "Acclaim" },
  { id: "popularity", label: "Popularity" },
  { id: "box_office", label: "Box office" },
];
const TEXT_SORTS: { id: CandidateSort; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "person", label: "Person" },
];

export function CandidateToolbar({ mode, query, sort, count, onQuery, onSort }: Props) {
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
          className="w-full rounded-md border border-line bg-ink-2 px-3 py-2 text-sm text-ivory placeholder:text-muted focus:border-gold focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ivory-dim">
        Sort by
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as CandidateSort)}
          className="rounded-md border border-line bg-ink-2 px-2 py-2 text-sm text-ivory focus:border-gold focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs tabular-nums text-muted">{count} in pool</span>
    </div>
  );
}
