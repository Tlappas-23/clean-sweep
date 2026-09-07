// Toast notifications: a tiny global queue for API error `detail` strings
// and confirmations. `useToast().push(message, tone)` from anywhere; the
// `<Toaster />` component (src/components/ui/Toaster.tsx) renders the queue.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastTone = "error" | "info" | "success";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastStore {
  toasts: Toast[];
  push(message: string, tone?: ToastTone): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastStore | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useToast(): ToastStore {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
