import { useEffect, useState } from 'react';

import { useDevFlag } from '../lib/devFlags';

/**
 * `true` once `loading` has been continuously `true` for `ms` (default: the
 * `Dev_Perf_inhibit_SlowLoadHintMs` flag, 8000 ms out of the box). Resets to `false` the
 * moment `loading` flips `false`, and the timer restarts on the next `true`. Screens render
 * the "Still loading… check your connection" caption + Retry under the skeleton on it.
 */
export function useSlowLoad(loading: boolean, ms?: number): boolean {
  const defaultMs = useDevFlag('Dev_Perf_inhibit_SlowLoadHintMs');
  const delay = Math.max(0, ms ?? defaultMs);
  const [slow, setSlow] = useState(false);
  const [trackedLoading, setTrackedLoading] = useState(loading);

  // Derive-from-props reset (React docs pattern): a new loading session starts un-slow.
  if (trackedLoading !== loading) {
    setTrackedLoading(loading);
    setSlow(false);
  }

  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => setSlow(true), delay);
    return () => clearTimeout(timer);
  }, [loading, delay]);

  return loading && slow;
}

/** `loading || Dev_Onyx_inhibit_SkeletonExit` — lets the dev panel pin every screen in its skeleton layout. */
export function useForceSkeleton(loading: boolean): boolean {
  const forced = useDevFlag('Dev_Onyx_inhibit_SkeletonExit');
  return loading || forced;
}
