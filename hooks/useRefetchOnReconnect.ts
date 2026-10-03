// codename: cobalt
import { useEffect, useRef } from 'react';

import { getDevFlag } from '../lib/devFlags';
import { onReconnect } from '../lib/network';

/**
 * Runs `fn` once per offline→online transition while `enabled` (default `true`). The latest
 * `fn` is always used (ref), so callers can pass an inline closure. No-op when
 * `Dev_Cobalt_inhibit_ReconnectRefetch` or `Dev_Cobalt_inhibit_Feature` is on (read at fire
 * time, so flipping the flag needs no remount). Pass `enabled={false}` for unfocused screens.
 */
export function useRefetchOnReconnect(fn: () => void, enabled: boolean = true): void {
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    return onReconnect(() => {
      if (getDevFlag('Dev_Cobalt_inhibit_ReconnectRefetch') || getDevFlag('Dev_Cobalt_inhibit_Feature')) return;
      fnRef.current();
    });
  }, [enabled]);
}
