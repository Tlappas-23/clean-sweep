// `useAsync`: loading / error / data for one-shot fetches on read-only pages
// (Leaderboard, Analytics, Browse). The Play flow has its own reducer; this
// hook is for the simpler pages that just render one API response.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "../api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** HTTP status of the last error, so pages can special-case 404. */
  status: number | null;
  reload: () => void;
}

/**
 * Runs `fn` whenever `deps` change. Ignores responses from superseded calls
 * so a fast re-render never overwrites newer data with older data.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const serial = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const mine = ++serial.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    fn().then(
      (value) => {
        if (mine !== serial.current) return;
        setData(value);
        setLoading(false);
      },
      (err: unknown) => {
        if (mine !== serial.current) return;
        setError(errorMessage(err));
        setStatus(isApiError(err) ? err.status : null);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [...deps, tick]);

  return { data, loading, error, status, reload };
}
