// codename: indigo
/**
 * Shake detector for the hidden dev-mode gate (DECISIONS D2, CONTRACTS §2.20).
 *
 * Subscribes to the accelerometer only when `enabled && Platform.OS !== 'web' && AppState ===
 * 'active'` (own AppState listener; `sub.remove()` on blur/unmount). `Accelerometer.isAvailableAsync()`
 * is checked first, then `setUpdateInterval(200)` once per subscription.
 *
 * Found 2026-10-03: Android 12+ caps the accelerometer at 200 ms without HIGH_SAMPLING_RATE_SENSORS
 * (not requested); 5 Hz → the 1.2 s window holds 6 samples; 3 peaks ≥ 250 ms apart is a deliberate
 * two-handed shake, not a pocket bump. Peak = |hypot(x, y, z) − 1| ≥ threshold (g units; rest ≈ 1.0).
 * In `__DEV__` builds RN's dev menu also owns the shake gesture, hence the long-press fallback (MAP §7.19).
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';

import { logSilentFailure } from '../lib/logSilentFailure';
import { isNativePromptPending } from '../lib/pendingNativePrompts';

export type ShakeDetectorOptions = {
  /** default true */
  enabled?: boolean;
  /** peak threshold in g, default 1.2 */
  threshold?: number;
  /** peaks required, default 3 */
  peaks?: number;
  /** window for the peaks, default 1200 ms (DECISIONS D2; PLAN Q7) */
  windowMs?: number;
  /** min gap between consecutive peaks, default 250 ms */
  gapMs?: number;
  /** cooldown after a fire, default 2000 ms */
  cooldownMs?: number;
};

type Subscription = ReturnType<typeof Accelerometer.addListener>;

const DEFAULTS: Required<ShakeDetectorOptions> = {
  enabled: true,
  threshold: 1.2,
  peaks: 3,
  windowMs: 1200,
  gapMs: 250,
  cooldownMs: 2000,
};

/** Android 12+ floor without HIGH_SAMPLING_RATE_SENSORS (MAP §7.19). */
const SENSOR_INTERVAL_MS = 200;

/**
 * Calls `onShake` when `peaks` accelerometer peaks (|hypot − 1| ≥ `threshold` g, ≥ `gapMs` apart) land
 * inside `windowMs`, then sleeps `cooldownMs`. Never fires while `isNativePromptPending()`.
 * `onShake` and `opts` are read through refs — changing them never resubscribes; only `enabled` does.
 */
export function useShakeDetector(onShake: () => void, opts?: ShakeDetectorOptions): void {
  const onShakeRef = useRef(onShake);
  const optsRef = useRef(opts);
  useEffect(() => {
    onShakeRef.current = onShake;
    optsRef.current = opts;
  });

  const enabled = opts?.enabled ?? DEFAULTS.enabled;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    let cancelled = false;
    let starting = false;
    let sub: Subscription | null = null;
    /** Ring buffer of accepted peak timestamps (length ≤ peaks). */
    let peakTimes: number[] = [];
    let lastPeakAt = 0;
    let cooldownUntil = 0;

    const onSample = ({ x, y, z }: AccelerometerMeasurement) => {
      const o = optsRef.current;
      const threshold = o?.threshold ?? DEFAULTS.threshold;
      const peaks = Math.max(1, o?.peaks ?? DEFAULTS.peaks);
      const windowMs = o?.windowMs ?? DEFAULTS.windowMs;
      const gapMs = o?.gapMs ?? DEFAULTS.gapMs;
      const cooldownMs = o?.cooldownMs ?? DEFAULTS.cooldownMs;

      if (Math.abs(Math.hypot(x, y, z) - 1) < threshold) return;
      const now = Date.now();
      if (now < cooldownUntil) return;
      // A native permission dialog may be on screen (MAP §7.6) — never fire a JS action into it.
      if (isNativePromptPending()) return;
      // Still the same peak (consecutive samples 200 ms apart stay under a 250 ms gap).
      if (now - lastPeakAt < gapMs) return;
      lastPeakAt = now;
      peakTimes.push(now);
      if (peakTimes.length > peaks) peakTimes.shift();
      if (peakTimes.length < peaks) return;
      if (now - peakTimes[0] > windowMs) return;

      peakTimes = [];
      cooldownUntil = now + cooldownMs;
      try {
        onShakeRef.current();
      } catch (err) {
        logSilentFailure('ShakeDetector.onShake', err);
      }
    };

    const stop = () => {
      if (sub) {
        sub.remove();
        sub = null;
      }
      peakTimes = [];
      lastPeakAt = 0;
    };

    const start = async () => {
      if (cancelled || starting || sub) return;
      starting = true;
      try {
        const available = await Accelerometer.isAvailableAsync();
        // The await may have outlived a background transition or an unmount.
        if (!available || cancelled || sub || AppState.currentState !== 'active') return;
        Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        sub = Accelerometer.addListener(onSample);
      } catch (err) {
        logSilentFailure('ShakeDetector.start', err);
      } finally {
        starting = false;
      }
    };

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start();
      else stop();
    });
    if (AppState.currentState === 'active') void start();

    return () => {
      cancelled = true;
      stop();
      appStateSub.remove();
    };
  }, [enabled]);
}
