// codename: antares
// Delivery ETA derived from the nearest nearby store — zero extra requests.
// `storeService.getNearbyProductFilter()` feeds `setEtaSource()` on every
// resolve (cache hit or network); `LocationContext` calls `setEtaSource(null)`
// when the location clears and on logout. Screens read the result through
// `hooks/useDeliveryEta.ts`, which also decides the 'unknown' state.
import { getDevFlag } from './devFlags';

export type DeliveryEtaState = 'open' | 'closed' | 'unknown' | 'none';

export type DeliveryEta = {
  /** Minutes until delivery; null when state is none / closed / unknown. */
  minutes: number | null;
  /**
   * 'none'    = no location known, or Dev_Antares_inhibit_Feature (every surface hides)
   * 'unknown' = a location exists but the nearby filter has not resolved for it yet
   * 'closed'  = the filter resolved with 0 stores in the radius (or Dev_Antares_inhibit_StoreOpen)
   * 'open'    = minutes is a number
   */
  state: DeliveryEtaState;
  /** Distance to the nearest verified + online store in km (2 dp); null when unknown / closed. */
  nearestKm: number | null;
  nearestStoreName: string | null;
  /** Verified + online stores inside the radius; 0 → 'closed'. */
  storeCount: number;
};

export type EtaSource = {
  /** `nearbyKey(lat, lng)` = `${lat.toFixed(3)},${lng.toFixed(3)}` — lets the hook detect a source for a previous location. */
  locationKey: string;
  nearestKm: number | null;
  nearestStoreName: string | null;
  storeCount: number;
};

/**
 * ETA formula (design/blinkit-parity BP-06): 8 min base + 4 min per km,
 * rounded, clamped to [10, 30]. 1 km → 12 · 0.1 km → 10 · 7 km → 30.
 * Non-finite or negative input is treated as 0 km (→ 10).
 */
export function computeEtaMinutes(nearestKm: number): number {
  const km = Number.isFinite(nearestKm) && nearestKm > 0 ? nearestKm : 0;
  const raw = Math.round(8 + 4 * km);
  return Math.min(30, Math.max(10, raw));
}

const NONE: DeliveryEta = Object.freeze({
  minutes: null,
  state: 'none',
  nearestKm: null,
  nearestStoreName: null,
  storeCount: 0,
});

let source: EtaSource | null = null;
const listeners = new Set<() => void>();
/**
 * The last snapshot handed out. `getDeliveryEta()` returns the same object
 * while its fields are unchanged so `useSyncExternalStore` never sees a fresh
 * reference per call (which would loop).
 */
let lastSnapshot: DeliveryEta = NONE;

function sameSource(a: EtaSource | null, b: EtaSource | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.locationKey === b.locationKey &&
    a.nearestKm === b.nearestKm &&
    a.nearestStoreName === b.nearestStoreName &&
    a.storeCount === b.storeCount
  );
}

function sameEta(a: DeliveryEta, b: DeliveryEta): boolean {
  return (
    a.state === b.state &&
    a.minutes === b.minutes &&
    a.nearestKm === b.nearestKm &&
    a.nearestStoreName === b.nearestStoreName &&
    a.storeCount === b.storeCount
  );
}

function notify(): void {
  // Copy first: a listener may unsubscribe (or subscribe) while we iterate.
  for (const cb of Array.from(listeners)) cb();
}

/**
 * Called by `storeService.getNearbyProductFilter()` on every resolve (cache hit
 * or network) and by `LocationContext` with `null` on clear / logout.
 * Identical values are ignored (no re-render); a change notifies subscribers.
 */
export function setEtaSource(next: EtaSource | null): void {
  if (sameSource(source, next)) return;
  source = next ? { ...next } : null;
  notify();
}

/** true once `setEtaSource(non-null)` ran; flips back to false after `setEtaSource(null)`. */
export function hasSource(): boolean {
  return source !== null;
}

/**
 * Location key of the current source, or null. `useDeliveryEta` compares it
 * with the active location's key: a mismatch means the source belongs to a
 * previous address and the hook reports 'unknown' until the new filter resolves.
 */
export function getEtaSourceKey(): string | null {
  return source?.locationKey ?? null;
}

function compute(): DeliveryEta {
  if (getDevFlag('Dev_Antares_inhibit_Feature')) return NONE;
  const src = source;
  if (!src) return NONE;

  const forcedClosed = getDevFlag('Dev_Antares_inhibit_StoreOpen');
  if (src.storeCount === 0 || forcedClosed) {
    return {
      minutes: null,
      state: 'closed',
      nearestKm: src.nearestKm,
      nearestStoreName: src.nearestStoreName,
      storeCount: src.storeCount,
    };
  }

  const forcedMinutes = getDevFlag('Dev_Antares_inhibit_EtaMinutes');
  if (forcedMinutes > 0) {
    return {
      minutes: Math.round(forcedMinutes),
      state: 'open',
      nearestKm: src.nearestKm,
      nearestStoreName: src.nearestStoreName,
      storeCount: src.storeCount,
    };
  }

  if (src.nearestKm == null) {
    // Stores exist but no distance was recorded — should not happen with
    // storeService's payload; report 'unknown' rather than invent a number.
    return {
      minutes: null,
      state: 'unknown',
      nearestKm: null,
      nearestStoreName: src.nearestStoreName,
      storeCount: src.storeCount,
    };
  }

  return {
    minutes: computeEtaMinutes(src.nearestKm),
    state: 'open',
    nearestKm: src.nearestKm,
    nearestStoreName: src.nearestStoreName,
    storeCount: src.storeCount,
  };
}

/**
 * Synchronous read. Applies `Dev_Antares_inhibit_Feature` (→ 'none'),
 * `Dev_Antares_inhibit_StoreOpen` (→ 'closed') and
 * `Dev_Antares_inhibit_EtaMinutes` (> 0 → that value). Returns a stable
 * reference while nothing changed.
 */
export function getDeliveryEta(): DeliveryEta {
  const next = compute();
  if (!sameEta(next, lastSnapshot)) lastSnapshot = next;
  return lastSnapshot;
}

/** Fires after every effective `setEtaSource()`; dev-flag changes are observed via `subscribeDevFlags` (the hook combines both). */
export function subscribeDeliveryEta(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** '12 min' | 'Closed' | null (none / unknown). */
export function formatEtaShort(eta: DeliveryEta): string | null {
  if (eta.state === 'closed') return 'Closed';
  if (eta.state === 'open' && eta.minutes != null) return `${eta.minutes} min`;
  return null;
}

/** 'Delivery in 12 minutes' | 'Store closed' | null (none / unknown). */
export function formatEtaLong(eta: DeliveryEta): string | null {
  if (eta.state === 'closed') return 'Store closed';
  if (eta.state === 'open' && eta.minutes != null) return `Delivery in ${eta.minutes} minutes`;
  return null;
}
