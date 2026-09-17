import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ApiError } from './api.js';

/**
 * Load data, with loading and error state and a manual reload.
 *
 * `setData` is the raw state setter, so a screen can apply a change optimistically
 * — passing an updater rather than a value, which is what makes two edits in the
 * same tick both survive instead of the second overwriting the first.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    setLoading(true);
    loader()
      .then((result) => {
        // A slower earlier request must not overwrite a newer one.
        if (run !== latest.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (run !== latest.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/** Delay a fast-changing value — used for the search boxes. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
