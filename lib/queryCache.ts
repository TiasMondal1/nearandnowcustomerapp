// codename: kepler
// The memory + in-flight-dedupe + TTL cache every data service wraps (CONTRACTS §2.3,
// design/speed-and-ease #2). Written 2026-10-03 from the razorpayService.ts:120-229
// dedupe template and the addressService.ts:6-67 envelope template.
//
// Invariants (the C5 class of bug this module exists to prevent):
//   • a rejecting fetcher stores NOTHING — the next call simply retries;
//   • concurrent calls for one key share ONE promise (`force` included);
//   • an entry removed while its fetch is in flight (invalidate / logout) is never
//     resurrected by the late resolve, so one user's rows cannot leak to the next.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';

import { recordNetworkLog } from './apiClient';
import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';

export type CachedOptions = {
  ttlMs: number;
  /** cleared by clearUserScoped() on logout */
  userScope?: boolean;
  /** AsyncStorage envelope { version, savedAt, payload }; loaded by seedFromDisk; stale allowed up to maxAgeMs for first paint */
  persist?: { key: string; version: number; maxAgeMs?: number };
  /** ignore memory + run the fetcher (pull-to-refresh) */
  force?: boolean;
};

type PersistSpec = NonNullable<CachedOptions['persist']>;

type Entry = {
  value: unknown;
  /** false until the first successful resolve / seed — an in-flight-only entry has no value yet */
  hasValue: boolean;
  /** ms epoch of `value`; 0 = never, which the TTL test always treats as stale */
  savedAt: number;
  ttlMs: number;
  userScope: boolean;
  persist?: PersistSpec;
  /** the one request currently running for this key (shared by every concurrent caller) */
  promise?: Promise<unknown>;
};

type Envelope<T> = { version: number; savedAt: number; payload: T };

/** Entries whose TTL is at or below this are marked stale by onReconnect() (short-lived data: balance, orders, notifications, wishlist). */
const RECONNECT_TTL_CEILING_MS = 60_000;

const entries = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();

// ─── Internals ──────────────────────────────────────────────────────────────

function isBypassed(): boolean {
  return getDevFlag('Dev_Kepler_inhibit_QueryCache') || getDevFlag('Dev_Kepler_inhibit_Feature');
}

function isFresh(entry: Entry, now: number): boolean {
  return entry.hasValue && now - entry.savedAt < entry.ttlMs;
}

function notify(key: string): void {
  const subs = subscribers.get(key);
  if (!subs || subs.size === 0) return;
  for (const cb of Array.from(subs)) {
    try {
      cb();
    } catch (err) {
      logSilentFailure(`queryCache subscriber (${key})`, err);
    }
  }
}

function logCache(key: string, ms: number, cacheHit: boolean): void {
  if (!getDevFlag('Dev_Perf_inhibit_NetworkLog')) return;
  try {
    recordNetworkLog({ method: 'CACHE', path: key, ms, status: 'cache', cacheHit });
  } catch (err) {
    logSilentFailure('queryCache network log', err);
  }
}

/** Best-effort disk write of the `{ version, savedAt, payload }` envelope. Never throws, never awaited. */
function persistEnvelope(persist: PersistSpec, savedAt: number, payload: unknown): void {
  try {
    const envelope: Envelope<unknown> = { version: persist.version, savedAt, payload };
    const raw = JSON.stringify(envelope);
    AsyncStorage.setItem(persist.key, raw).catch((err) => logSilentFailure(`queryCache persist (${persist.key})`, err));
  } catch (err) {
    logSilentFailure(`queryCache persist (${persist.key})`, err);
  }
}

function newEntry(ttlMs: number, userScope: boolean): Entry {
  return { value: undefined, hasValue: false, savedAt: 0, ttlMs, userScope };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Memory + in-flight dedupe + TTL. Resolves from memory when the entry is younger than
 * `ttlMs`; otherwise runs `fetcher` once and shares that promise with every concurrent
 * caller (also under `force`, which only skips the memory read). On resolve the value is
 * stored, persisted when `persist` is given (best-effort) and the key's subscribers are
 * notified. A rejecting fetcher stores NOTHING and the rejection propagates to the caller.
 * Under `Dev_Kepler_inhibit_QueryCache` / `Dev_Kepler_inhibit_Feature` the fetcher always
 * runs (in-flight dedupe still applies; the result is still stored so `peek` keeps painting).
 */
export function cached<T>(key: string, fetcher: () => Promise<T>, opts: CachedOptions): Promise<T> {
  const startedAt = Date.now();
  const existing = entries.get(key);

  if (existing && !opts.force && !isBypassed() && isFresh(existing, startedAt)) {
    logCache(key, 0, true);
    return Promise.resolve(existing.value as T);
  }
  if (existing?.promise) {
    return existing.promise as Promise<T>;
  }

  const entry = existing ?? newEntry(opts.ttlMs, !!opts.userScope);
  entry.ttlMs = opts.ttlMs;
  entry.userScope = entry.userScope || !!opts.userScope;
  if (opts.persist) entry.persist = opts.persist;
  entries.set(key, entry);

  let started: Promise<T>;
  try {
    started = fetcher();
  } catch (err) {
    started = Promise.reject(err);
  }

  const promise: Promise<T> = started.then(
    (value) => {
      // Commit only when this entry is still the registered one: invalidate(),
      // clearUserScoped() or a replacing cached() call during the flight wins.
      if (entries.get(key) === entry && entry.promise === promise) {
        entry.value = value;
        entry.hasValue = true;
        entry.savedAt = Date.now();
        entry.promise = undefined;
        if (entry.persist) persistEnvelope(entry.persist, entry.savedAt, value);
        notify(key);
      }
      logCache(key, Date.now() - startedAt, false);
      return value;
    },
    (err: unknown) => {
      if (entries.get(key) === entry && entry.promise === promise) {
        entry.promise = undefined;
        // An entry that never held a value has nothing left to offer — drop it.
        if (!entry.hasValue) entries.delete(key);
      }
      throw err;
    },
  );
  entry.promise = promise;
  return promise;
}

/** Sync memory read; may be stale beyond TTL (callers use it for first paint). `undefined` when nothing has resolved or been seeded. */
export function peek<T>(key: string): T | undefined {
  const entry = entries.get(key);
  return entry?.hasValue ? (entry.value as T) : undefined;
}

/**
 * Loads a persisted `{ version, savedAt, payload }` envelope into memory for first paint.
 * Returns `undefined` on miss, parse error, version mismatch, or when the row is older than
 * `maxAgeMs`. The entry keeps the disk `savedAt` and a TTL of 0 (unless memory already set
 * one), so `peek` paints it immediately while the first `cached()` still refetches. Memory
 * that is already newer than the disk row is left untouched. Never throws.
 */
export async function seedFromDisk<T>(key: string, persist: PersistSpec): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(persist.key);
    if (!raw) return undefined;
    const envelope = JSON.parse(raw) as Partial<Envelope<T>> | null;
    if (!envelope || typeof envelope !== 'object') return undefined;
    if (envelope.version !== persist.version) return undefined;
    if (typeof envelope.savedAt !== 'number' || !Number.isFinite(envelope.savedAt)) return undefined;
    if (persist.maxAgeMs != null && Date.now() - envelope.savedAt > persist.maxAgeMs) return undefined;
    if (!('payload' in envelope)) return undefined;

    const existing = entries.get(key);
    if (existing?.hasValue && existing.savedAt >= envelope.savedAt) return existing.value as T;

    const entry = existing ?? newEntry(0, false);
    entry.value = envelope.payload;
    entry.hasValue = true;
    entry.savedAt = envelope.savedAt;
    entry.persist = persist;
    entries.set(key, entry);
    notify(key);
    return envelope.payload as T;
  } catch (err) {
    logSilentFailure(`queryCache seedFromDisk (${key})`, err);
    return undefined;
  }
}

/**
 * Optimistic write: stores `value` as of now and notifies subscribers. `ttlMs` defaults to
 * the entry's current TTL (0 for a brand-new key = stale until the next `cached()`),
 * `userScope` is sticky once true. Re-persists when the key has a persist spec.
 * Does not cancel an in-flight fetch; its resolve overwrites this value (server wins).
 */
export function setCached<T>(key: string, value: T, opts?: { ttlMs?: number; userScope?: boolean }): void {
  const existing = entries.get(key);
  const entry = existing ?? newEntry(opts?.ttlMs ?? 0, !!opts?.userScope);
  entry.value = value;
  entry.hasValue = true;
  entry.savedAt = Date.now();
  if (opts?.ttlMs != null) entry.ttlMs = opts.ttlMs;
  if (opts?.userScope) entry.userScope = true;
  entries.set(key, entry);
  if (entry.persist) persistEnvelope(entry.persist, entry.savedAt, value);
  notify(key);
}

/** Drops every entry whose key starts with `prefix` ('' = everything) and notifies their subscribers. In-flight fetches for dropped keys resolve to their callers but are not stored. Disk envelopes are left in place (they only seed first paint). */
export function invalidate(prefix: string): void {
  const dropped: string[] = [];
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) dropped.push(key);
  }
  for (const key of dropped) entries.delete(key);
  for (const key of dropped) notify(key);
}

/** Drops every `userScope` entry; called from AuthContext.clearStoredSession() so no user-owned row survives a logout. */
export function clearUserScoped(): void {
  const dropped: string[] = [];
  for (const [key, entry] of entries) {
    if (entry.userScope) dropped.push(key);
  }
  for (const key of dropped) entries.delete(key);
  for (const key of dropped) notify(key);
}

/** Subscribe to changes of one key (resolve, setCached, seedFromDisk, invalidate). Returns the unsubscribe function. */
export function subscribe(key: string, cb: () => void): () => void {
  let subs = subscribers.get(key);
  if (!subs) {
    subs = new Set();
    subscribers.set(key, subs);
  }
  subs.add(cb);
  return () => {
    const current = subscribers.get(key);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) subscribers.delete(key);
  };
}

/**
 * Hook: the current `peek(key)` value, re-rendering on every change of that key. Lives here
 * (documented exception to "no hooks in lib/") because it is a two-line binding of
 * `subscribe` + `peek`. Snapshots are the stored references, so they are stable between commits.
 */
export function useCachedValue<T>(key: string): T | undefined {
  const subscribeKey = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  const getSnapshot = useCallback(() => peek<T>(key), [key]);
  return useSyncExternalStore(subscribeKey, getSnapshot, getSnapshot);
}

/**
 * Called by lib/network.ts once per offline→online transition (and by simulateReconnect()).
 * Marks every entry with `ttlMs <= 60_000` stale (savedAt → 0) so the next `cached()` call
 * refetches, while `peek` keeps painting the last value until it does. Longer-lived data
 * (categories, nearby filter, coupons) is left fresh.
 */
export function onReconnect(): void {
  for (const entry of entries.values()) {
    if (entry.hasValue && entry.ttlMs <= RECONNECT_TTL_CEILING_MS) entry.savedAt = 0;
  }
}

/** Dev-panel helper (indigo Storage section): one row per memory entry. Not for product code. */
export function debugQueryCacheEntries(): { key: string; ageMs: number; ttlMs: number; userScope: boolean; inFlight: boolean; hasValue: boolean }[] {
  const now = Date.now();
  const rows: { key: string; ageMs: number; ttlMs: number; userScope: boolean; inFlight: boolean; hasValue: boolean }[] = [];
  for (const [key, entry] of entries) {
    rows.push({
      key,
      ageMs: entry.hasValue ? now - entry.savedAt : -1,
      ttlMs: entry.ttlMs,
      userScope: entry.userScope,
      inFlight: !!entry.promise,
      hasValue: entry.hasValue,
    });
  }
  return rows;
}

export const QC_KEYS = {
  categories: 'categories:all',
  nearby: (lat: number, lng: number) => `nearby:${lat.toFixed(3)},${lng.toFixed(3)}`,
  activeProductIds: 'activeProductIds',
  walletBalance: 'wallet:balance',
  orders: (userId: string) => `orders:${userId}`,
  order: (id: string) => `order:${id}`,
  addresses: (userId: string) => `addresses:${userId}`,
  coupons: 'coupons:active',
  category: (slug: string, locKey: string) => `category:${slug}:${locKey}`,
  notifications: (userId: string) => `notifications:${userId}`,
  wishlist: 'wishlist:items',
} as const;
