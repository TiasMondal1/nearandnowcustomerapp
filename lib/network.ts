// codename: cobalt
// Online/offline watcher (CONTRACTS §2.10, design/speed-and-ease #25). One module singleton:
// expo-network listener + 1.5 s offline debounce + 10 s recheck while offline + recheck on
// AppState resume. `Dev_Network_inhibit_Offline` forces offline immediately. Web is online
// forever (navigator.onLine is unreliable; the fetch layer surfaces failures there anyway).
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { getDevFlag, subscribeDevFlags } from './devFlags';
import { logSilentFailure } from './logSilentFailure';
import { onReconnect as markShortTtlCachesStale } from './queryCache';

export type OnlineState = { online: boolean; since: number };

/** How long the radio must read offline before the app flips — cell handovers flap for ~1 s (2026-10-03). */
const OFFLINE_DEBOUNCE_MS = 1500;
/** Poll cadence while offline: Android listeners can miss the "reachable again" edge after a long drop. */
const OFFLINE_RECHECK_MS = 10_000;

const IS_WEB = Platform.OS === 'web';

let state: OnlineState = { online: true, since: Date.now() };
/** Debounced physical connectivity — optimistic `true` until proven otherwise. */
let physicalOnline = true;
let started = false;
let offlineTimer: ReturnType<typeof setTimeout> | null = null;
let recheckTimer: ReturnType<typeof setInterval> | null = null;
let rechecking = false;

const onlineSubs = new Set<(s: OnlineState) => void>();
const reconnectSubs = new Set<() => void>();

// ─── Internals ──────────────────────────────────────────────────────────────

function readOnline(s: NetworkState): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

function forcedOffline(): boolean {
  return getDevFlag('Dev_Network_inhibit_Offline') === true;
}

function effectiveOnline(): boolean {
  return !forcedOffline() && physicalOnline;
}

function fireReconnect(): void {
  try {
    markShortTtlCachesStale();
  } catch (err) {
    logSilentFailure('network reconnect: queryCache', err);
  }
  for (const cb of Array.from(reconnectSubs)) {
    try {
      cb();
    } catch (err) {
      logSilentFailure('network reconnect listener', err);
    }
  }
}

function syncRecheckTimer(): void {
  const shouldPoll = started && !IS_WEB && !physicalOnline;
  if (shouldPoll && !recheckTimer) {
    recheckTimer = setInterval(recheck, OFFLINE_RECHECK_MS);
  } else if (!shouldPoll && recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
}

/** Recomputes the effective state; notifies on change; fires reconnect listeners once per offline→online. */
function publish(): void {
  const next = effectiveOnline();
  syncRecheckTimer();
  if (next === state.online) return;
  const wasOnline = state.online;
  state = { online: next, since: Date.now() };
  for (const cb of Array.from(onlineSubs)) {
    try {
      cb(state);
    } catch (err) {
      logSilentFailure('network online listener', err);
    }
  }
  if (!wasOnline && next) fireReconnect();
}

/** Feeds one raw reading in: online flips immediately, offline only after OFFLINE_DEBOUNCE_MS of continuous offline readings. */
function applyRaw(online: boolean): void {
  if (online) {
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
    }
    physicalOnline = true;
    publish();
    return;
  }
  if (!physicalOnline || offlineTimer) return;
  offlineTimer = setTimeout(() => {
    offlineTimer = null;
    physicalOnline = false;
    publish();
  }, OFFLINE_DEBOUNCE_MS);
}

function recheck(): void {
  if (IS_WEB || rechecking) return;
  rechecking = true;
  let pending: Promise<NetworkState>;
  try {
    pending = getNetworkStateAsync();
  } catch (err) {
    rechecking = false;
    logSilentFailure('network recheck', err);
    return;
  }
  pending
    .then(
      (s) => applyRaw(readOnline(s)),
      (err: unknown) => logSilentFailure('network recheck', err),
    )
    .finally(() => {
      rechecking = false;
    });
}

function handleAppState(next: AppStateStatus): void {
  if (next === 'active') recheck();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Idempotent. Seeds from `getNetworkStateAsync()`, subscribes to `addNetworkStateListener`,
 * rechecks on AppState → active and every 10 s while offline, and re-evaluates when dev flags
 * change. On web it only wires the dev-flag subscription (always physically online).
 * Also started lazily by `subscribeOnline` / `onReconnect`, so the hooks work before AppShell mounts.
 */
export function startNetworkWatch(): void {
  if (started) return;
  started = true;
  try {
    subscribeDevFlags(publish);
  } catch (err) {
    logSilentFailure('network: dev flag subscription', err);
  }
  if (IS_WEB) return;
  try {
    addNetworkStateListener((s) => applyRaw(readOnline(s)));
  } catch (err) {
    logSilentFailure('network: addNetworkStateListener', err);
  }
  try {
    AppState.addEventListener('change', handleAppState);
  } catch (err) {
    logSilentFailure('network: AppState listener', err);
  }
  recheck();
}

/** Sync. `false` under `Dev_Network_inhibit_Offline` (immediately) or after 1.5 s of continuous offline readings; `true` on web and before the watcher has started. */
export function getIsOnline(): boolean {
  return effectiveOnline();
}

/** Sync `{ online, since }` where `since` is the ms epoch of the last flip (module load when none yet). */
export function getOnlineState(): OnlineState {
  return state;
}

/** Called on every flip with the new `{ online, since }`. Starts the watcher if needed. Returns the unsubscribe function. */
export function subscribeOnline(cb: (s: OnlineState) => void): () => void {
  onlineSubs.add(cb);
  startNetworkWatch();
  return () => {
    onlineSubs.delete(cb);
  };
}

/** Fired once per offline→online transition (incl. releasing `Dev_Network_inhibit_Offline`), after queryCache.onReconnect(). Returns the unsubscribe function. */
export function onReconnect(cb: () => void): () => void {
  reconnectSubs.add(cb);
  startNetworkWatch();
  return () => {
    reconnectSubs.delete(cb);
  };
}

/** Dev action (panel "Simulate reconnect"): fires queryCache.onReconnect() + every onReconnect listener once, without changing the online state. */
export function simulateReconnect(): void {
  fireReconnect();
}
