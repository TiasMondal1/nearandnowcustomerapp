// codename: lyra
// Recent search terms (CONTRACTS §2.8, design/speed-and-ease #16): module array mirrored
// to AsyncStorage under `nn:search:recent`. Device-scoped — never cleared on logout (MAP §7.14).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';

export const RECENT_SEARCHES_KEY = 'nn:search:recent';
export const RECENT_SEARCHES_MAX = 8;

/** Longest term kept; search input is capped at 64 anyway. */
const MAX_TERM_LENGTH = 64;

const EMPTY: string[] = [];

let recents: string[] = EMPTY;
let loadPromise: Promise<void> | null = null;
const subscribers = new Set<() => void>();

// ─── Internals ──────────────────────────────────────────────────────────────

function isInhibited(): boolean {
  return getDevFlag('Dev_Lyra_inhibit_RecentSearches') || getDevFlag('Dev_Lyra_inhibit_Feature');
}

function normalise(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH);
}

function notify(): void {
  for (const cb of Array.from(subscribers)) {
    try {
      cb();
    } catch (err) {
      logSilentFailure('recentSearches subscriber', err);
    }
  }
}

/** Case-insensitive dedupe (first occurrence wins), capped at RECENT_SEARCHES_MAX. */
function dedupeAndCap(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const term = normalise(raw);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= RECENT_SEARCHES_MAX) break;
  }
  return out;
}

function commit(next: string[]): void {
  const same = next.length === recents.length && next.every((t, i) => t === recents[i]);
  if (same) return;
  recents = next.length === 0 ? EMPTY : next;
  notify();
  persist();
}

function persist(): void {
  try {
    const op = recents.length === 0
      ? AsyncStorage.removeItem(RECENT_SEARCHES_KEY)
      : AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recents));
    op.catch((err) => logSilentFailure('recentSearches persist', err));
  } catch (err) {
    logSilentFailure('recentSearches persist', err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Idempotent hydrate from AsyncStorage (app/_layout module scope or first use). Terms added
 * before the read resolves stay in front of the persisted ones. Never rejects.
 */
export function loadRecentSearches(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const merged = dedupeAndCap([...recents, ...(parsed as unknown[]).filter((t): t is string => typeof t === 'string')]);
      const same = merged.length === recents.length && merged.every((t, i) => t === recents[i]);
      if (!same) {
        recents = merged.length === 0 ? EMPTY : merged;
        notify();
      }
    } catch (err) {
      logSilentFailure('recentSearches load', err);
    }
  })();
  return loadPromise;
}

/** Sync, newest first. The same array reference until the list changes (safe as a useSyncExternalStore snapshot). */
export function getRecentSearches(): string[] {
  return recents;
}

/**
 * Trims and collapses whitespace, dedupes case-insensitively (moves an existing term to the
 * front, keeping the new casing), caps at RECENT_SEARCHES_MAX, persists best-effort. No-op
 * for empty terms and under `Dev_Lyra_inhibit_RecentSearches` / `Dev_Lyra_inhibit_Feature`.
 */
export function addRecentSearch(query: string): void {
  if (isInhibited()) return;
  const term = normalise(query ?? '');
  if (!term) return;
  if (!loadPromise) void loadRecentSearches();
  commit(dedupeAndCap([term, ...recents]));
}

/** Removes every case-insensitive match of `query`; persists. */
export function removeRecentSearch(query: string): void {
  const key = normalise(query ?? '').toLowerCase();
  if (!key) return;
  commit(recents.filter((t) => t.toLowerCase() !== key));
}

/** Empties the list and removes the AsyncStorage row. */
export function clearRecentSearches(): void {
  commit([]);
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Hook over the module store (useSyncExternalStore); hydrates on first mount. Newest first; empty array under the lyra inhibit flags only once the list is cleared (the flags stop writes, not reads). */
export function useRecentSearches(): string[] {
  useEffect(() => {
    void loadRecentSearches();
  }, []);
  return useSyncExternalStore(subscribe, getRecentSearches, getRecentSearches);
}
