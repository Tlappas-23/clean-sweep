// ContenderGrid: responsive grid of ContenderCards with a skeleton state and
// the sticky "Lock in" bar that appears once a card is highlighted.
import type { Contender, Mode } from "../../api/types";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ContenderCard } from "./ContenderCard";

interface Props {
  mode: Mode;
  candidates: Contender[];
  loading: boolean;
  selectedId: string | null;
  locking: boolean;
  onSelect: (id: string | null) => void;
  onLockIn: () => void;
}

export function ContenderGrid({ mode, candidates, loading, selectedId, locking, onSelect, onLockIn }: Props) {
  const selected = candidates.find((c) => c.contender_id === selectedId) ?? null;

  if (loading && candidates.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-56 rounded-xl" />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return <EmptyState title="No contenders match">Try a different search — the pool has every notable release of the year.</EmptyState>;
  }

  return (
    <div className="relative">
      <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
        {candidates.map((c) => (
          <ContenderCard
            key={c.contender_id}
            contender={c}
            selected={c.contender_id === selectedId}
            onSelect={(id) => onSelect(id === selectedId ? null : id)}
            showMetrics={mode === "classic"}
          />
        ))}
      </div>

      {/* Confirm bar: sticky at the bottom of the viewport while a card is highlighted. */}
      {selected && (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-col items-center gap-3 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-glow backdrop-blur animate-rise sm:flex-row sm:justify-between">
          <p className="text-sm">
            <span className="text-ivory-dim">Lock in </span>
            <span className="font-display text-lg text-ivory">{selected.person_name ?? selected.film_title}</span>
            {selected.person_name && <span className="text-ivory-dim"> · {selected.film_title}</span>}
            <span className="text-muted"> ({selected.year})</span>?
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSelect(null)} disabled={locking}>
              Cancel
            </Button>
            <Button size="md" onClick={onLockIn} loading={locking}>
              Lock in
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
