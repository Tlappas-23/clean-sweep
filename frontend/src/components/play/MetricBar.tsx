// MetricBar: a labelled 0-100 bar for one strength metric.
//
// Null values (masked in cinephile mode, or missing enrichment data) render
// an em dash and an empty track rather than a zero-width bar, so "hidden"
// never looks like "bad". Covered by src/components/play/MetricBar.test.tsx.

interface Props {
  label: string;
  value: number | null | undefined;
  /** Gold for the headline metric, ivory for the rest. */
  accent?: boolean;
  title?: string;
}

export function MetricBar({ label, value, accent = false, title }: Props) {
  const isNull = value === null || value === undefined;
  const clamped = isNull ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 text-xs" title={title}>
      <span className="w-20 shrink-0 text-ivory-dim">{label}</span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isNull ? undefined : clamped}
        aria-valuetext={isNull ? "not available" : String(clamped)}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
      >
        {!isNull && (
          <div
            data-testid="metric-fill"
            className={`h-full rounded-full transition-[width] duration-500 ${accent ? "bg-gold" : "bg-ivory-dim"}`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      <span className={`w-7 shrink-0 text-right tabular-nums ${isNull ? "text-muted" : accent ? "text-gold" : "text-ivory"}`}>
        {isNull ? "—" : Math.round(clamped)}
      </span>
    </div>
  );
}
