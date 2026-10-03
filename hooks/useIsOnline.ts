// codename: cobalt
import { useSyncExternalStore } from 'react';

import { getIsOnline, subscribeOnline } from '../lib/network';

function subscribe(cb: () => void): () => void {
  return subscribeOnline(cb);
}

function getServerSnapshot(): boolean {
  return true;
}

/**
 * Reactive `getIsOnline()`. `true` on web and until an offline reading has held for 1.5 s;
 * `false` immediately under `Dev_Network_inhibit_Offline`. Starts the network watcher on
 * first use (idempotent), so it is safe in screens that mount before AppShell wires it.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getIsOnline, getServerSnapshot);
}
