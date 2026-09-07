// Toaster: renders the queue from src/state/ToastContext.tsx in the bottom
// corner. Errors are tinted red, confirmations green.
import { useToast, type ToastTone } from "../../state/ToastContext";

const TONES: Record<ToastTone, string> = {
  error: "border-loss/50 bg-[#2a1418]",
  info: "border-accent/40 bg-ink-3",
  success: "border-win/50 bg-[#0e2620]",
};

export function Toaster() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg animate-rise ${TONES[t.tone]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="text-bone-dim hover:text-bone"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
