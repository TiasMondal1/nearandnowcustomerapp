// The ONE "permission → GPS fix → readable address" block (MAP K12: it replaces the three copies in
// app/index.tsx, app/onboarding.tsx and app/(tabs)/home.tsx). Never navigates and never throws —
// screens await `request()` and only then call `router.*` (MAP §7.6).
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getDevFlag } from '../lib/devFlags';
import { logSilentFailure } from '../lib/logSilentFailure';
import { beginNativePrompt, runNativePrompt, waitForNativePromptsSettled } from '../lib/pendingNativePrompts';
import { reverseGeocode } from '../lib/placesService';

export type DeviceAddress = { lat: number; lng: number; address: string };

export type DeviceAddressRequestOptions = {
  /**
   * Android: whether the fix may raise the system "turn on location accuracy" dialog when device location is
   * off. Default true (a tapped "Use current location" should offer it). Automatic requests pass false so they
   * can raise at most one dialog — the permission prompt.
   */
  settingsDialog?: boolean;
};

/** The permission prompt never starts sooner than this after the requesting screen mounted (its own transition) (ms). */
const SCREEN_SETTLE_MS = 700;
/** How long the start of a fix is treated as "a system dialog may be coming up" (Android location-accuracy dialog) (ms). */
const FIX_DIALOG_WINDOW_MS = 1500;

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
 * `request()` asks for foreground location permission, takes a Balanced fix and resolves it to an
 * address. The OS dialog goes through `runNativePrompt` (lib/pendingNativePrompts): it is serialised
 * with the push prompt, never starts inside a navigation transition or within 700 ms of this screen
 * mounting (so a request fired from a screen's first effect — Home's, select-map's — waits out that
 * screen's own transition), and index/welcome/otp hold their redirects while it is up. An already
 * granted permission skips all of that (with the settings dialog allowed, the fix still waits for any
 * other prompt to be gone). Resolves `null` when the permission is denied (`denied`
 * becomes true), under `Dev_Location_inhibit_Gps` (behaves as denied), and on every other failure
 * (logged) — it never throws. `busy` is true while a request runs; a second call while busy joins
 * the running one (its options are ignored).
 */
export function useDeviceAddress(): {
  request: (opts?: DeviceAddressRequestOptions) => Promise<DeviceAddress | null>;
  busy: boolean;
  denied: boolean;
} {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const inFlightRef = useRef<Promise<DeviceAddress | null> | null>(null);
  // Stamped in the host screen's first effect pass — before any of that screen's own effects can call `request`.
  const mountedAtRef = useRef(0);
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  const request = useCallback((opts?: DeviceAddressRequestOptions): Promise<DeviceAddress | null> => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = async (): Promise<DeviceAddress | null> => {
      setBusy(true);
      try {
        if (getDevFlag('Dev_Location_inhibit_Gps')) {
          setDenied(true);
          return null;
        }

        const settingsDialog = opts?.settingsDialog ?? true;
        // Android only: the fix itself may raise the system location-accuracy dialog.
        const fixMayPrompt = settingsDialog && Platform.OS === 'android';

        // Already granted → no permission dialog is possible. Otherwise only the permission dialog is a native
        // prompt: the gate is released as soon as it settles so a multi-second GPS fix never stalls a pending
        // navigation (same scope as the blocks this replaces).
        const existing = await Location.getForegroundPermissionsAsync();
        let granted = existing.status === 'granted';
        if (!granted) {
          const permission = await runNativePrompt(
            async () => {
              // Re-read when this request's turn comes: another screen's queued request (Home under select-map)
              // may have been answered meanwhile, and asking again would raise the same dialog twice in a row.
              // An unchanged status still asks — a tapped retry after an earlier "Deny" must reach the OS.
              const current = await Location.getForegroundPermissionsAsync();
              if (current.status !== existing.status) return current;
              return Location.requestForegroundPermissionsAsync();
            },
            { notBefore: (mountedAtRef.current || Date.now()) + SCREEN_SETTLE_MS },
          );
          granted = permission.status === 'granted';
          // The dialog has just closed and the Activity is resuming: let that settle before the fix, which can
          // raise a second system dialog (location accuracy) of its own. A no-op when nothing was shown.
          if (granted) await waitForNativePromptsSettled({ navigating: false });
        } else if (fixMayPrompt) {
          // Granted earlier, but the fix can still raise the accuracy dialog: never over another prompt or in the
          // frame of a resume. Resolves at once when nothing is in the way (every tapped request, in practice).
          await waitForNativePromptsSettled({ navigating: false });
        }
        if (!granted) {
          setDenied(true);
          return null;
        }
        setDenied(false);

        // With the settings dialog allowed, Android may raise it at the very start of the fix (network provider
        // off). Hold the prompt flag over that window only: under the dialog the Activity is paused and the timer
        // with it, so the flag stays up exactly as long as the dialog; with no dialog it costs at most 1.5 s and
        // the multi-second fix itself still never stalls a navigation.
        const releaseFixWindow = fixMayPrompt ? beginNativePrompt() : null;
        const fixWindowTimer = releaseFixWindow ? setTimeout(releaseFixWindow, FIX_DIALOG_WINDOW_MS) : null;
        let position: Location.LocationObject;
        try {
          position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            mayShowUserSettingsDialog: settingsDialog,
          });
        } finally {
          if (fixWindowTimer) clearTimeout(fixWindowTimer);
          releaseFixWindow?.();
        }
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
