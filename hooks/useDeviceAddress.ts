// The ONE "permission → GPS fix → readable address" block (MAP K12: it replaces the three copies in
// app/index.tsx, app/onboarding.tsx and app/(tabs)/home.tsx). Never navigates and never throws —
// screens await `request()` and only then call `router.*` (MAP §7.6).
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';

import { getDevFlag } from '../lib/devFlags';
import { logSilentFailure } from '../lib/logSilentFailure';
import { beginNativePrompt } from '../lib/pendingNativePrompts';
import { reverseGeocode } from '../lib/placesService';

export type DeviceAddress = { lat: number; lng: number; address: string };

/** Shown when the fix succeeded but neither geocoder produced a line (offline, web, remote area). */
const FALLBACK_LABEL = 'Your location';

/** "name, street, district, city" — at most three distinct parts, the join the three old blocks used. */
function joinParts(result: Location.LocationGeocodedAddress | undefined): string {
  if (!result) return FALLBACK_LABEL;
  const parts: string[] = [];
  for (const part of [result.name, result.street, result.district, result.city]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.slice(0, 3).join(', ') || result.city || FALLBACK_LABEL;
}

/** Google (via the backend proxy) first, the OS geocoder second, a neutral label last. Never throws. */
async function resolveAddress(lat: number, lng: number): Promise<string> {
  const google = await reverseGeocode(lat, lng); // null under Dev_Quartz_inhibit_ReverseGeocode / on failure (logged)
  if (google?.formatted_address) return google.formatted_address;
  try {
    const [first] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return joinParts(first);
  } catch (err) {
    logSilentFailure('Device address (OS reverse geocode)', err);
    return FALLBACK_LABEL;
  }
}

/**
 * `request()` asks for foreground location permission (the OS dialog wrapped in `beginNativePrompt`
 * so index/welcome's redirect pollers wait it out), takes a Balanced fix and resolves it to an
 * address. Resolves `null` when the permission is denied (`denied` becomes true), under
 * `Dev_Location_inhibit_Gps` (behaves as denied), and on every other failure (logged) — it never
 * throws. `busy` is true while a request runs; a second call while busy joins the running one.
 */
export function useDeviceAddress(): {
  request: () => Promise<DeviceAddress | null>;
  busy: boolean;
  denied: boolean;
} {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const inFlightRef = useRef<Promise<DeviceAddress | null> | null>(null);

  const request = useCallback((): Promise<DeviceAddress | null> => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = async (): Promise<DeviceAddress | null> => {
      setBusy(true);
      try {
        if (getDevFlag('Dev_Location_inhibit_Gps')) {
          setDenied(true);
          return null;
        }

        // Only the permission dialog is a native prompt; the gate is released as soon as it settles so a
        // multi-second GPS fix never stalls a pending navigation (same scope as the blocks this replaces).
        const release = beginNativePrompt();
        let granted = false;
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          granted = permission.status === 'granted';
        } finally {
          release();
        }
        if (!granted) {
          setDenied(true);
          return null;
        }
        setDenied(false);

        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const address = await resolveAddress(lat, lng);
        return { lat, lng, address };
      } catch (err) {
        logSilentFailure('Device address', err);
        return null;
      } finally {
        inFlightRef.current = null;
        setBusy(false);
      }
    };

    const promise = run();
    inFlightRef.current = promise;
    return promise;
  }, []);

  return { request, busy, denied };
}
