// codename: kepler
/**
 * Boot gate (speed-and-ease #6, CONTRACTS §2.11): two tiny module stores.
 *
 * 1. Boot timeline — `markBoot(mark)` stamps `performance.now()` (ms since the JS time origin,
 *    ≈ process start on React Native) the first time each mark is reported. `module-eval` is
 *    stamped when this module is evaluated. Raw timestamps are ALWAYS stored; the
 *    `Dev_Perf_inhibit_BootTimeline` flag is applied on READ in `getBootTimeline()`, because
 *    `loadDevFlags()` may hydrate after `module-eval`/`auth-ready` have already fired.
 * 2. Nav ready — `markNavReady()` is called by `app/index.tsx` on the frame after its first
 *    `router.replace(...)` and by `components/NavReadyProbe.tsx` once the root state's focused route is
 *    not `index` (URL cold starts never mount index — W3 R6-09); `AppShell` hides the splash when
 *    `!isLoading && fonts && (navReady || 2 s elapsed)`. Nothing else may block on it (the push deep
 *    link and the splash hide never wait).
 * 3. Fonts ready — `markFontsReady()` is flipped by `AppShell` when `useFonts` settles (loaded OR errored);
 *    `app/index.tsx` waits for it (hard-capped) before its first replace so Home never paints a Jakarta
 *    family that is not registered yet (W3 R6-17). `ErrorBoundary` reads it to drop the family while unset.
 */
import { useSyncExternalStore } from 'react';

import { getDevFlag } from './devFlags';

export type BootMark =
  | 'module-eval'
  | 'auth-ready'
  | 'fonts-ready'
  | 'splash-hidden'
  | 'nav-ready'
  | 'home-first-paint'
  | 'catalog-painted';

type BootEntry = { mark: BootMark; ms: number };

// ─── Clock ───

const perf = globalThis.performance;
const hasPerformanceNow = typeof perf?.now === 'function';
/** Only used by the Date.now() fallback so marks stay 0-based in runtimes without `performance`. */
const fallbackOrigin = Date.now();

function nowMs(): number {
  return hasPerformanceNow ? perf.now() : Date.now() - fallbackOrigin;
}

// ─── Boot timeline ───

const marks: BootEntry[] = [];
const seen = new Set<BootMark>();

/**
 * Records `performance.now()` for `mark` (first report wins; later repeats are ignored). Stored
 * unconditionally; `getBootTimeline()` hides everything but `module-eval` unless
 * `Dev_Perf_inhibit_BootTimeline` is on. Never throws.
 */
export function markBoot(mark: BootMark): void {
  if (seen.has(mark)) return;
  seen.add(mark);
  marks.push({ mark, ms: Math.round(nowMs() * 10) / 10 });
}

/** The timeline in report order (a copy). `[module-eval]` only while `Dev_Perf_inhibit_BootTimeline` is off. */
export function getBootTimeline(): { mark: BootMark; ms: number }[] {
  if (getDevFlag('Dev_Perf_inhibit_BootTimeline')) return marks.map((m) => ({ ...m }));
  return marks.filter((m) => m.mark === 'module-eval').map((m) => ({ ...m }));
}

// `module-eval` is always recorded, at import.
markBoot('module-eval');

// ─── Nav ready ───

let navReady = false;
const navSubscribers = new Set<() => void>();

/** Flips nav ready once (idempotent), records the `nav-ready` boot mark and notifies subscribers. */
export function markNavReady(): void {
  if (navReady) return;
  navReady = true;
  markBoot('nav-ready');
  navSubscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      // A subscriber throwing must never stop the others or the boot.
    }
  });
}

/** Sync read. */
export function isNavReady(): boolean {
  return navReady;
}

/** Subscribe to the nav-ready flip; returns the unsubscribe. The callback never fires more than once. */
export function subscribeNavReady(cb: () => void): () => void {
  navSubscribers.add(cb);
  return () => {
    navSubscribers.delete(cb);
  };
}

/** `useSyncExternalStore` over the nav-ready flag. */
export function useNavReady(): boolean {
  return useSyncExternalStore(subscribeNavReady, isNavReady, isNavReady);
}

// ─── Fonts ready ───

let fontsReady = false;
const fontSubscribers = new Set<() => void>();

/** Flips fonts ready once (idempotent: loaded or errored both count), records `fonts-ready` and notifies. */
export function markFontsReady(): void {
  if (fontsReady) return;
  fontsReady = true;
  markBoot('fonts-ready');
  fontSubscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      // A subscriber throwing must never stop the others or the boot.
    }
  });
}

/** Sync read. */
export function isFontsReady(): boolean {
  return fontsReady;
}

/** Subscribe to the fonts-ready flip; returns the unsubscribe. */
export function subscribeFontsReady(cb: () => void): () => void {
  fontSubscribers.add(cb);
  return () => {
    fontSubscribers.delete(cb);
  };
}

/** `useSyncExternalStore` over the fonts-ready flag. */
export function useFontsReady(): boolean {
  return useSyncExternalStore(subscribeFontsReady, isFontsReady, isFontsReady);
}
