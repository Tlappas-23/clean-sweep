// MetricBar: a labelled 0-100 bar for one strength metric.
//
// Used by the contender card (src/components/play/ContenderCard.tsx) and the
// results reveal (src/pages/Results.tsx), so the same metric looks the same
// wherever it appears.
//
// Two rules live here:
//   * a null value renders a dash and an empty track rather than a
//     zero-width bar, because "hidden" (cinephile mode) and "not measured"
//     must never look like "bad";
//   * `tone` carries whether the row counts. Accent is the headline scored
//     metric, bone the other scored ones, and `muted` is reserved for the
//     prestige model estimate, which is shown but never part of the score.
//
// Covered by src/components/play/MetricBar.test.tsx.

/** Accent = headline scored metric, default = scored, muted = shown but unscored. */
export type MetricTone = "accent" | "default" | "muted";

interface Props {
  label: string;
  value: number | null | undefined;
  tone?: MetricTone;
  title?: string;
}

/** Fill and value colours per tone. The muted pair is deliberately dimmer
 *  than the "no value" dash, so an unscored row recedes without disappearing. */
const FILL: Record<MetricTone, string> = {
  accent: "bg-accent",
  default: "bg-bone-dim",
  muted: "bg-muted",
};
const VALUE_TEXT: Record<MetricTone, string> = {
  accent: "text-accent",
  default: "text-bone",
  muted: "text-bone-dim",
};

export function MetricBar({ label, value, tone = "default", title }: Props) {
  const isNull = value === null || value === undefined;
  const clamped = isNull ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 text-xs" title={title}>
      <span className={`w-20 shrink-0 ${tone === "muted" ? "text-muted" : "text-bone-dim"}`}>
        {label}
      </span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isNull ? undefined : clamped}
        aria-valuetext={isNull ? "not available" : String(clamped)}
        className={`h-1.5 flex-1 overflow-hidden rounded-full ${tone === "muted" ? "bg-white/5" : "bg-white/10"}`}
      >
        {!isNull && (
          <div
            data-testid="metric-fill"
            className={`h-full rounded-full transition-[width] duration-500 ${FILL[tone]}`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      <span
        className={`w-7 shrink-0 text-right tabular-nums ${isNull ? "text-muted" : VALUE_TEXT[tone]}`}
      >
        {isNull ? "–" : Math.round(clamped)}
      </span>
    </div>
  );
}
