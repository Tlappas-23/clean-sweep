// Spinner: a thin gold ring used inside buttons and as a page-level loader.
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-gold/30 border-t-gold ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Centered full-width loader for pages waiting on their first response. */
export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-ivory-dim">
      <Spinner size={28} />
      <span className="text-xs uppercase tracking-[0.2em]">{label}</span>
    </div>
  );
}
