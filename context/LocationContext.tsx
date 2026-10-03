import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { setEtaSource } from '../lib/deliveryEta';
import { useDevFlag } from '../lib/devFlags';
import { logSilentFailure } from '../lib/logSilentFailure';
import { nearbyKey } from '../lib/storeService';
import { useAuth } from './AuthContext';

const LOCATION_STORAGE_KEY = 'nn_active_location';
/** Persisted envelope `{ version: 2, location }`; a bare location object is the legacy payload and still hydrates. */
const LOCATION_PAYLOAD_VERSION = 2;

export type LocationSource = 'profile' | 'saved' | 'manual';

export type ActiveLocation = {
  latitude: number;
  longitude: number;
  label: string;
  address?: string;
  source: LocationSource;
};

export type LocationContextType = {
  /** The active delivery location, with `Dev_Location_inhibit_LatLngOverride` applied when it validates. */
  location: ActiveLocation | null;
  /** `nearbyKey(lat, lng)` of `location` — the nearby-filter / ETA cache key — or null. */
  locationKey: string | null;
  /** true once `loadLocationStore()` resolved (hit or miss). Screens wait for it before fetching the catalog. */
  isHydrated: boolean;
  /** Refuses non-finite or (0,0) coordinates (logged via logSilentFailure); persists `{ version: 2, location }`. */
  setLocation: (loc: ActiveLocation) => void;
  /** Clears + removes the key + `setEtaSource(null)`. */
  clearLocation: () => void;
};

const SOURCES: readonly LocationSource[] = ['profile', 'saved', 'manual'];

// ─── Module store (hydrated at app/_layout.tsx module scope) ──────────────────

let activeLocation: ActiveLocation | null = null;
let ready = false;
/** A setLocation/clearLocation that ran before the disk read resolved must win over the stored value. */
let touchedBeforeLoad = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of Array.from(listeners)) cb();
}

function subscribeLocationStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// (0,0) is the Gulf of Guinea, never a customer — it is what a failed GPS
// read or an unset form field serialises to, and persisting it once made the
// nearby filter return "no stores" forever (MAP §2.11 #39).
function isValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function sanitizeLocation(raw: unknown): ActiveLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const latitude = typeof r.latitude === 'number' ? r.latitude : Number(r.latitude);
  const longitude = typeof r.longitude === 'number' ? r.longitude : Number(r.longitude);
  if (!isValidCoords(latitude, longitude)) return null;
  const out: ActiveLocation = {
    latitude,
    longitude,
    label: typeof r.label === 'string' ? r.label : '',
    source: typeof r.source === 'string' && (SOURCES as readonly string[]).includes(r.source)
      ? (r.source as LocationSource)
      : 'manual',
  };
  if (typeof r.address === 'string') out.address = r.address;
  return out;
}

function writeLocation(next: ActiveLocation | null): void {
  if (next) {
    AsyncStorage.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({ version: LOCATION_PAYLOAD_VERSION, location: next }),
    ).catch((err) => logSilentFailure('Persist active location', err));
  } else {
    AsyncStorage.removeItem(LOCATION_STORAGE_KEY).catch((err) =>
      logSilentFailure('Clear persisted location', err),
    );
  }
}

function setActiveLocation(next: ActiveLocation | null): void {
  if (!ready) touchedBeforeLoad = true;
  activeLocation = next;
  notify();
  writeLocation(next);
}

/** Sync read of the persisted/active location (no dev override applied). null before hydration or when none. */
export function getActiveLocationSync(): ActiveLocation | null {
  return activeLocation;
}

function getLocationReadySync(): boolean {
  return ready;
}

/**
 * Idempotent hydrate from `nn_active_location` (v2 envelope `{ version: 2, location }`
 * or the legacy raw object). Refuses (0,0) / non-finite coordinates (treated as
 * no location). Call once at app/_layout.tsx module scope; never rejects.
 */
export function loadLocationStore(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(LOCATION_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const envelope = parsed as { version?: unknown; location?: unknown } | null;
        const candidate = envelope && typeof envelope === 'object' && envelope.version === LOCATION_PAYLOAD_VERSION
          ? envelope.location
          : parsed;
        const loc = sanitizeLocation(candidate);
        if (loc && !touchedBeforeLoad) activeLocation = loc;
      }
    } catch (err) {
      logSilentFailure('Hydrate active location', err);
    }
    ready = true;
    notify();
  })();
  return loadPromise;
}

// ─── Dev override ─────────────────────────────────────────────────────────────

const LAT_LNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseLatLng(value: string): { lat: number; lng: number } | null {
  const m = LAT_LNG_RE.exec(value);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!isValidCoords(lat, lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Applies `Dev_Location_inhibit_LatLngOverride` to the VALUE only — the persisted location is untouched. */
function applyLatLngOverride(loc: ActiveLocation | null, override: string): ActiveLocation | null {
  if (!loc || !override) return loc;
  const parsed = parseLatLng(override);
  if (!parsed) return loc;
  return { ...loc, latitude: parsed.lat, longitude: parsed.lng };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const LocationContext = createContext<LocationContextType | undefined>(undefined);

/**
 * Seeds from the module store (synchronously on first render) and follows it;
 * `isHydrated` flips once `loadLocationStore()` resolved. Both `clearLocation()`
 * and the logout clear call `setEtaSource(null)` (rev. 2) so the next user
 * never sees the previous user's ETA.
 */
export function LocationProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const stored = useSyncExternalStore(subscribeLocationStore, getActiveLocationSync, getActiveLocationSync);
  const isHydrated = useSyncExternalStore(subscribeLocationStore, getLocationReadySync, getLocationReadySync);
  const override = useDevFlag('Dev_Location_inhibit_LatLngOverride');

  const location = useMemo(() => applyLatLngOverride(stored, override), [stored, override]);
  const locationKey = useMemo(
    () => (location ? nearbyKey(location.latitude, location.longitude) : null),
    [location],
  );

  const setLocation = useCallback((loc: ActiveLocation) => {
    if (!isValidCoords(loc.latitude, loc.longitude)) {
      logSilentFailure(
        'Set active location',
        new Error(`Refused invalid coordinates ${String(loc.latitude)},${String(loc.longitude)}`),
      );
      return;
    }
    setActiveLocation(loc);
  }, []);

  const clearLocation = useCallback(() => {
    setActiveLocation(null);
    setEtaSource(null);
  }, []);

  // Clears the selected location on a genuine logout (true -> false
  // transition only, not on initial mount while auth is still restoring) —
  // otherwise a shared/reused device keeps showing the previous customer's
  // last-picked delivery location to whoever logs in next, same class of
  // bug already fixed for the cart. LocationProvider is rendered inside
  // AuthProvider (see app/_layout.tsx), so this is safe with no
  // circular-dependency issue. clearLocation() also drops the ETA source.
  const { isAuthenticated } = useAuth();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
    } else if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      clearLocation();
    }
  }, [isAuthenticated, clearLocation]);

  // Memoized so LocationProvider's own re-renders (for reasons unrelated to
  // location itself) don't force every useLocation() consumer to re-render
  // — mirrors CartContext.tsx's identical fix in this same directory.
  const value = useMemo<LocationContextType>(
    () => ({ location, locationKey, isHydrated, setLocation, clearLocation }),
    [location, locationKey, isHydrated, setLocation, clearLocation],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextType {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside LocationProvider');
  return ctx;
}

/** `nearbyKey(lat, lng)` of the active location (override applied), or null. */
export function useLocationKey(): string | null {
  return useLocation().locationKey;
}
