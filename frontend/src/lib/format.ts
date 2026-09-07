// Pure formatting helpers shared across pages and components.
//
// Kept framework-free so they are trivially unit-testable (see
// src/lib/format.test.ts) and reusable by the mock adapter.

/** "27–3" with an en dash, the canonical way a season record is written. */
export function formatRecord(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

/** Local-time YYYY-MM-DD, the seed for the daily challenge. */
export function todaySeed(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compact vote counts: 2,300,000 → "2.3M", 48,000 → "48K". */
export function formatVotes(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** "$476M" style box office; null renders as an em dash. */
export function formatUsd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Numbers that may be null (masked metrics) render as an em dash. */
export function formatMetric(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

/** ISO timestamp → "6 Sep 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Feature ids like `log_votes` → "Log votes". */
export function humanise(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
