// codename: sirius
/**
 * Haptics + UI-sound service (DECISIONS D3 "sirius"; CONTRACTS §2.1).
 *
 * Plain functions over module state. Screens call `feedback.<pair>()`, never await anything, and
 * every public function is `void` and never throws (failures go to `logSilentFailure('Feedback.*')`).
 *
 * Gating chain, in order, inside every public call:
 *   1. `Platform.OS === 'web'`                               → drop (no players, no haptics on web)
 *   2. `Dev_Sirius_inhibit_Feature`                           → drop (master; user prefs ignored)
 *   3. `AppState.currentState !== 'active'`                   → drop (never from the background)
 *   4. not warmed / first 1500 ms after `warmFeedback()`      → drop, except `success` / `error`
 *      (hydration — persisted cart → CartBar mount — must be silent)
 *   5. haptics allowed = `prefs.haptics && !Dev_Sirius_inhibit_Haptics`
 *      sounds  allowed = `prefs.sounds  && !Dev_Sirius_inhibit_Sounds`
 *   6. anti-spam windows unless `Dev_Sirius_inhibit_Throttle`: same-kind coalescing 40 ms ·
 *      ≥ 50 ms between sound starts (`success`/`error` pre-empt) · add/remove sound ≤ 8 Hz (haptic
 *      kept) · success ≤ 1 / 2 s · error ≤ 1 / 1 s · coin ≤ 1 / 1.5 s · swoosh ≤ 1 / 400 ms ·
 *      passive ≤ 1 / 3 s
 *   7. trace when `Dev_Sirius_inhibit_EventTrace !== 'off'` (console or toast; dev only)
 *
 * Platform limitation (CONTRACTS §2.1 rev. 2): `playsInSilentMode: false` honours the **iOS**
 * ring/silent switch only. Android has no media silent switch and Expo exposes no ringer-mode API,
 * so on Android UI sounds follow the media volume plus the user-level Sounds toggle
 * (`nn:prefs:sounds`); haptics on Android honour the OS "touch feedback" setting because every
 * haptic goes through `performAndroidHapticsAsync`. BRIEF's "respect system silent mode" is
 * therefore fully met on iOS and met via media volume + the in-app toggle on Android.
 *
 * `order_chime.wav` is the push-channel sound (MAP §7.22) and is never loaded here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { getDevFlag, isDevUnlocked, subscribeDevFlags } from './devFlags';
import { logSilentFailure } from './logSilentFailure';

export type UiSound = 'tap' | 'toggle' | 'add' | 'remove' | 'swoosh' | 'error' | 'coin' | 'success';
export type HapticKind = 'tap' | 'select' | 'toggle' | 'add' | 'remove' | 'success' | 'error' | 'heavy' | 'coin';
export type FeedbackPrefs = { sounds: boolean; haptics: boolean };

/** One entry per `feedback.*` pair — the key the coalescing / rate-cap windows are tracked on. */
type FeedbackKind =
  | 'tap' | 'select' | 'toggle' | 'add' | 'remove' | 'success' | 'error' | 'coin' | 'swoosh' | 'heavy'
  | 'tapSound' | 'passive';

// ─── Assets and gains ───

/** Metro asset modules — the eight UI wavs (order_chime.wav is the push channel sound and is never used here). */
export const UI_SOUND_FILES: Record<UiSound, number> = {
  tap: require('../assets/sounds/ui_tap.wav'),
  toggle: require('../assets/sounds/ui_toggle.wav'),
  add: require('../assets/sounds/ui_add.wav'),
  remove: require('../assets/sounds/ui_remove.wav'),
  swoosh: require('../assets/sounds/ui_swoosh.wav'),
  error: require('../assets/sounds/ui_error.wav'),
  coin: require('../assets/sounds/ui_coin.wav'),
  success: require('../assets/sounds/ui_success.wav'),
};

/** Per-file gain (0–1), scaled by `Dev_Sirius_inhibit_VolumeLevel` (default 0.7). Ceiling 0.8; `tap` 0.45. */
export const UI_SOUND_GAIN: Record<UiSound, number> = {
  tap: 0.45,
  toggle: 0.6,
  add: 0.7,
  remove: 0.6,
  swoosh: 0.5,
  error: 0.7,
  coin: 0.8,
  success: 0.8,
};

// ─── Constants ───

const PREF_KEYS: Record<keyof FeedbackPrefs, string> = { sounds: 'nn:prefs:sounds', haptics: 'nn:prefs:haptics' };
/** Everything but success/error is silent this long after `warmFeedback()` (hydration must be silent). */
const BOOT_SILENCE_MS = 1500;
/** Two calls of the same kind inside this window → the second is dropped (button + context double-fires). */
const COALESCE_MS = 40;
/** Minimum spacing between any two sound starts; `success`/`error` ignore it (they pre-empt). */
const SOUND_GAP_MS = 50;
/** add/remove sound cadence cap — 8 Hz; faster taps keep the haptic and skip the sound. */
const STEPPER_SOUND_GAP_MS = 120;
/** iOS `coin` = Rigid, then Light after this delay. */
const COIN_SECOND_TAP_MS = 90;
/** Per-kind rate caps (ms between two emits of that kind). */
const RATE_CAP_MS: Partial<Record<FeedbackKind, number>> = {
  success: 2000,
  error: 1000,
  coin: 1500,
  swoosh: 400,
  passive: 3000,
};
/** Two players for the four short clicks so a second tap never restarts the first; one for the rest (12 total). */
const POOL_SIZE: Record<UiSound, number> = { tap: 2, toggle: 2, add: 2, remove: 2, swoosh: 1, error: 1, coin: 1, success: 1 };
const PREEMPTING_SOUNDS: ReadonlySet<UiSound> = new Set<UiSound>(['success', 'error']);
const STEPPER_SOUNDS: ReadonlySet<UiSound> = new Set<UiSound>(['add', 'remove']);

// ─── Module state ───

let prefs: FeedbackPrefs = { sounds: true, haptics: true };
let prefsLoad: Promise<void> | null = null;
/** Keys written this session before hydration finished — the disk value must not overwrite them. */
const prefsTouched = new Set<keyof FeedbackPrefs>();
const prefSubscribers = new Set<() => void>();

const players: Partial<Record<UiSound, AudioPlayer[]>> = {};
let poolsCreated = false;
/** 0 = `warmFeedback()` not called yet; otherwise the `Date.now()` it was called. */
let warmedAt = 0;
let appliedSilentSwitch: boolean | null = null;
let appliedVolume = -1;
let devFlagsUnsubscribe: (() => void) | null = null;

const lastHapticAt: Record<HapticKind, number> = {
  tap: 0, select: 0, toggle: 0, add: 0, remove: 0, success: 0, error: 0, heavy: 0, coin: 0,
};
const lastEmitAt: Record<FeedbackKind, number> = {
  tap: 0, select: 0, toggle: 0, add: 0, remove: 0, success: 0, error: 0, coin: 0, swoosh: 0, heavy: 0,
  tapSound: 0, passive: 0,
};
let lastSoundAt = 0;
let lastStepperSoundAt = 0;

// ─── Gates ───

function isWeb(): boolean {
  return Platform.OS === 'web';
}

function throttleEnabled(): boolean {
  return !getDevFlag('Dev_Sirius_inhibit_Throttle');
}

function hapticsAllowed(): boolean {
  return prefs.haptics && !getDevFlag('Dev_Sirius_inhibit_Haptics');
}

function soundsAllowed(): boolean {
  return prefs.sounds && !getDevFlag('Dev_Sirius_inhibit_Sounds');
}

/** Steps 1–4 of the gating chain. `kind` decides whether the boot silence applies (success/error pass). */
function passesBaseGates(kind: HapticKind | UiSound | 'other'): boolean {
  if (isWeb()) return false;
  if (getDevFlag('Dev_Sirius_inhibit_Feature')) return false;
  if (AppState.currentState !== 'active') return false;
  if (!warmedAt) return false;
  if (kind !== 'success' && kind !== 'error' && Date.now() - warmedAt < BOOT_SILENCE_MS) return false;
  return true;
}

// ─── Haptic engine ───

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** iOS map (CONTRACTS §2.1). Also the Android fallback when `performAndroidHapticsAsync` rejects. */
async function genericHaptic(kind: HapticKind): Promise<void> {
  switch (kind) {
    case 'tap':
    case 'toggle':
    case 'remove':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'select':
      return Haptics.selectionAsync();
    case 'add':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case 'heavy':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'error':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    case 'coin':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      await sleep(COIN_SECOND_TAP_MS);
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

/** Android map (CONTRACTS §2.1) — every haptic goes through the OS touch-feedback setting. */
function androidHapticFor(kind: HapticKind, on?: boolean): Haptics.AndroidHaptics {
  switch (kind) {
    case 'tap':
      return Haptics.AndroidHaptics.Virtual_Key;
    case 'select':
      return Haptics.AndroidHaptics.Segment_Tick;
    case 'toggle':
      return on === false ? Haptics.AndroidHaptics.Toggle_Off : Haptics.AndroidHaptics.Toggle_On;
    case 'add':
      return Haptics.AndroidHaptics.Context_Click;
    case 'remove':
      return Haptics.AndroidHaptics.Clock_Tick;
    case 'success':
      return Haptics.AndroidHaptics.Confirm;
    case 'error':
      return Haptics.AndroidHaptics.Reject;
    case 'heavy':
      return Haptics.AndroidHaptics.Long_Press;
    case 'coin':
      return Haptics.AndroidHaptics.Confirm;
  }
}

/** Fires one haptic on the current platform; never rejects. */
async function fireHaptic(kind: HapticKind, on?: boolean): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      try {
        await Haptics.performAndroidHapticsAsync(androidHapticFor(kind, on));
      } catch {
        // Older Android / unsupported constant → the generic vibrator path.
        await genericHaptic(kind);
      }
    } else {
      await genericHaptic(kind);
    }
  } catch (err) {
    logSilentFailure('Feedback.haptic', err);
  }
}

// ─── Sound engine ───

function currentVolume(): number {
  const level = getDevFlag('Dev_Sirius_inhibit_VolumeLevel');
  return Math.min(1, Math.max(0, level));
}

/** Re-applies gain × `Dev_Sirius_inhibit_VolumeLevel` to every player when the level changed. */
function applyVolume(): void {
  const level = currentVolume();
  if (level === appliedVolume) return;
  appliedVolume = level;
  for (const name of Object.keys(players) as UiSound[]) {
    for (const player of players[name] ?? []) {
      try {
        player.volume = UI_SOUND_GAIN[name] * level;
      } catch (err) {
        logSilentFailure('Feedback.volume', err);
      }
    }
  }
}

/**
 * Sets the audio session. `mixWithOthers` requests no Android audio focus (the user's podcast keeps
 * playing); `playsInSilentMode` follows `Dev_Sirius_inhibit_SilentSwitch` (iOS only, default false =
 * respect the ring/silent switch). Re-applied only when the flag actually changed.
 */
function applyAudioMode(): void {
  const playsInSilentMode = getDevFlag('Dev_Sirius_inhibit_SilentSwitch');
  if (playsInSilentMode === appliedSilentSwitch) return;
  appliedSilentSwitch = playsInSilentMode;
  setAudioModeAsync({
    playsInSilentMode,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
  }).catch((err) => logSilentFailure('Feedback.audioMode', err));
}

/** Creates the 12 pooled players once. Players live for the app lifetime and are never `remove()`d. */
function ensurePools(): void {
  if (poolsCreated || isWeb()) return;
  poolsCreated = true;
  appliedVolume = currentVolume();
  for (const name of Object.keys(UI_SOUND_FILES) as UiSound[]) {
    const pool: AudioPlayer[] = [];
    for (let i = 0; i < POOL_SIZE[name]; i += 1) {
      try {
        const player = createAudioPlayer(UI_SOUND_FILES[name]);
        player.volume = UI_SOUND_GAIN[name] * appliedVolume;
        pool.push(player);
      } catch (err) {
        logSilentFailure('Feedback.createPlayer', err);
      }
    }
    players[name] = pool;
  }
  if (!devFlagsUnsubscribe) {
    devFlagsUnsubscribe = subscribeDevFlags(() => {
      applyVolume();
      applyAudioMode();
    });
  }
}

/** Picks the first idle pool member and starts it. Returns false when dropped (busy pool / not loaded). */
function startPlayer(name: UiSound): boolean {
  try {
    const pool = players[name];
    if (!pool) return false;
    const player = pool.find((p) => !p.playing);
    if (!player) return false; // every member busy → drop; never queue, never restart
    if (!player.isLoaded) return false; // first ~200 ms after warm → drop, never queue
    // `seekTo` returns a Promise — fire and forget, never awaited: expo-audio does not auto-rewind a
    // finished player, and a member is only reused once `playing === false`, so the seek lands before
    // `play()` starts the next frame.
    player.seekTo(0).catch((err) => logSilentFailure('Feedback.seek', err));
    player.play();
    return true;
  } catch (err) {
    logSilentFailure('Feedback.play', err);
    return false;
  }
}

// ─── Trace ───

/** Dev-only event trace: `Dev_Sirius_inhibit_EventTrace` = 'console' logs, 'toast' shows an 800 ms toast. */
function trace(label: string): void {
  const mode = getDevFlag('Dev_Sirius_inhibit_EventTrace');
  if (mode === 'off') return;
  // getDevFlag() already returns 'off' while locked; the explicit guard keeps this path dev-only even so.
  if (!(__DEV__ || isDevUnlocked())) return;
  if (mode === 'console') {
    console.log('[feedback]', label);
    return;
  }
  try {
    // Lazy `require` on purpose: lib/ must not statically import components/ (layering, PLAN §5), and
    // Toast.tsx itself imports this module for lastAt()/haptic() — a static import would be a cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design (layering + Toast→feedback cycle), see above
    const toast = require('../components/ui/Toast') as typeof import('../components/ui/Toast');
    toast.notify({ id: 'feedback-trace', title: label, duration: 800 });
  } catch (err) {
    logSilentFailure('Feedback.trace', err);
  }
}

// ─── Core emit ───

type EmitSpec = { haptic?: HapticKind; on?: boolean; sound?: UiSound };

/** Haptic channel: cross-API same-kind coalescing, records `lastAt`, then prefs/flag gate. */
function playHaptic(kind: HapticKind, on: boolean | undefined, now: number, throttled: boolean): void {
  if (throttled && now - lastHapticAt[kind] < COALESCE_MS) return;
  lastHapticAt[kind] = now;
  if (!hapticsAllowed()) return;
  void fireHaptic(kind, on);
}

/** Sound channel: prefs/flag gate, global 50 ms spacing (success/error pre-empt), 8 Hz stepper cadence. */
function playSound(name: UiSound, now: number, throttled: boolean): void {
  if (!soundsAllowed()) return;
  if (throttled) {
    if (!PREEMPTING_SOUNDS.has(name) && now - lastSoundAt < SOUND_GAP_MS) return;
    if (STEPPER_SOUNDS.has(name) && now - lastStepperSoundAt < STEPPER_SOUND_GAP_MS) return;
  }
  if (!startPlayer(name)) return;
  lastSoundAt = now;
  if (STEPPER_SOUNDS.has(name)) lastStepperSoundAt = now;
}

/** The single path every `feedback.*` pair goes through — the whole gating chain lives here. */
function emit(kind: FeedbackKind, spec: EmitSpec): void {
  try {
    // Machine events (`passive`) never get the gesture exemption from the boot silence — a cold start with no
    // network must not buzz the OfflineBanner's haptic ~1.5 s after the splash (W3 R4-06).
    if (!passesBaseGates(kind === 'passive' ? 'other' : (spec.haptic ?? spec.sound ?? 'other'))) return;
    if (kind === 'passive' && getDevFlag('Dev_Sirius_inhibit_PassiveFeedback')) return;
    const now = Date.now();
    const throttled = throttleEnabled();
    if (throttled) {
      const since = now - lastEmitAt[kind];
      if (since < COALESCE_MS) return;
      const cap = RATE_CAP_MS[kind];
      if (cap !== undefined && since < cap) return;
    }
    lastEmitAt[kind] = now;
    trace(kind);
    if (spec.haptic) playHaptic(spec.haptic, spec.on, now, throttled);
    if (spec.sound) playSound(spec.sound, now, throttled);
  } catch (err) {
    logSilentFailure('Feedback.emit', err);
  }
}

// ─── Public API ───

/** Low-level: one haptic. `on` only matters for 'toggle' (Toggle_On/Toggle_Off on Android). Full gating chain; no semantic rate cap. */
export function haptic(kind: HapticKind, on?: boolean): void {
  try {
    if (!passesBaseGates(kind)) return;
    trace(`haptic:${kind}`);
    playHaptic(kind, on, Date.now(), throttleEnabled());
  } catch (err) {
    logSilentFailure('Feedback.haptic', err);
  }
}

/** Low-level: one sound by name; never awaited; pooled players; volume per the gain table. Full gating chain; no semantic rate cap. */
export function sound(name: UiSound): void {
  try {
    if (!passesBaseGates(name)) return;
    trace(`sound:${name}`);
    playSound(name, Date.now(), throttleEnabled());
  } catch (err) {
    logSilentFailure('Feedback.sound', err);
  }
}

/** Semantic pairs — THE API screens use. Every call is void and never throws. */
export const feedback: {
  /** haptic Light / Virtual_Key; NO sound */
  tap(): void;
  /** selectionAsync / Segment_Tick; no sound */
  select(): void;
  /** haptic Light / Toggle_On|Off + ui_toggle */
  toggle(on: boolean): void;
  /** Medium / Context_Click + ui_add (sound ≤ 8 Hz) */
  add(): void;
  /** Light / Clock_Tick + ui_remove (sound ≤ 8 Hz) */
  remove(): void;
  /** notification Success / Confirm + ui_success; ≤ 1 per 2 s; passes the boot silence */
  success(): void;
  /** notification Error / Reject + ui_error; ≤ 1 per 1 s; passes the boot silence */
  error(): void;
  /** Rigid then Light (90 ms) / Confirm + ui_coin; ≤ 1 per 1.5 s */
  coin(): void;
  /** sound only; ≤ 1 per 400 ms */
  swoosh(): void;
  /** Heavy / Long_Press; no sound */
  heavy(): void;
  /** ui_tap at 0.45 + tap haptic — ONLY tab switch, pull-to-refresh, dev controls */
  tapSound(): void;
  /** non-gesture events; extra gate Dev_Sirius_inhibit_PassiveFeedback; 3 s debounce; only 'success' carries a sound */
  passive(kind: 'tap' | 'success' | 'error'): void;
  /** ms timestamp (Date.now()) of the last emitted haptic kind, 0 when never (ToastHost uses it) */
  lastAt(kind: HapticKind): number;
} = {
  tap() {
    emit('tap', { haptic: 'tap' });
  },
  select() {
    emit('select', { haptic: 'select' });
  },
  toggle(on: boolean) {
    emit('toggle', { haptic: 'toggle', on, sound: 'toggle' });
  },
  add() {
    emit('add', { haptic: 'add', sound: 'add' });
  },
  remove() {
    emit('remove', { haptic: 'remove', sound: 'remove' });
  },
  success() {
    emit('success', { haptic: 'success', sound: 'success' });
  },
  error() {
    emit('error', { haptic: 'error', sound: 'error' });
  },
  coin() {
    emit('coin', { haptic: 'coin', sound: 'coin' });
  },
  swoosh() {
    emit('swoosh', { sound: 'swoosh' });
  },
  heavy() {
    emit('heavy', { haptic: 'heavy' });
  },
  tapSound() {
    emit('tapSound', { haptic: 'tap', sound: 'tap' });
  },
  passive(kind) {
    // 'delivered' is the one passive event that carries a sound (design §2.1).
    emit('passive', { haptic: kind, sound: kind === 'success' ? 'success' : undefined });
  },
  lastAt(kind) {
    return lastHapticAt[kind];
  },
};

/**
 * Creates the audio players + sets the audio mode. Call ONCE from AppShell after
 * `SplashScreen.hideAsync()` — never on the isLoading path. Idempotent. On web it only marks the
 * service warmed (nothing ever plays there). Starts the 1500 ms boot silence.
 */
export function warmFeedback(): void {
  if (warmedAt) return;
  warmedAt = Date.now();
  if (isWeb()) return;
  try {
    applyAudioMode();
    ensurePools();
  } catch (err) {
    logSilentFailure('Feedback.warm', err);
  }
}

// ─── Prefs (device-scoped: nn:prefs:*, never cleared on logout — MAP §7.14) ───

function notifyPrefs(): void {
  prefSubscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      logSilentFailure('Feedback.prefsNotify', err);
    }
  });
}

function subscribePrefs(cb: () => void): () => void {
  prefSubscribers.add(cb);
  return () => {
    prefSubscribers.delete(cb);
  };
}

/** Hydrates nn:prefs:sounds / nn:prefs:haptics ('true' | 'false'; default true). Idempotent. Called at app/_layout.tsx module scope. */
export function loadFeedbackPrefs(): Promise<void> {
  if (!prefsLoad) {
    prefsLoad = (async () => {
      try {
        const rows = await AsyncStorage.multiGet([PREF_KEYS.sounds, PREF_KEYS.haptics]);
        const next: FeedbackPrefs = { ...prefs };
        for (const [key, raw] of rows) {
          if (raw !== 'true' && raw !== 'false') continue;
          const on = raw === 'true';
          if (key === PREF_KEYS.sounds && !prefsTouched.has('sounds')) next.sounds = on;
          else if (key === PREF_KEYS.haptics && !prefsTouched.has('haptics')) next.haptics = on;
        }
        if (next.sounds !== prefs.sounds || next.haptics !== prefs.haptics) {
          prefs = next;
          notifyPrefs();
        }
      } catch (err) {
        logSilentFailure('Feedback.loadPrefs', err);
      }
    })();
  }
  return prefsLoad;
}

/** Sync read of the in-memory prefs (defaults `{ sounds: true, haptics: true }` until hydrated). */
export function getFeedbackPrefs(): FeedbackPrefs {
  return prefs;
}

/** Applies in memory + notifies immediately, then persists ('true' | 'false'). Never rejects. */
export async function setFeedbackPref(key: keyof FeedbackPrefs, on: boolean): Promise<void> {
  prefsTouched.add(key);
  if (prefs[key] !== on) {
    prefs = { ...prefs, [key]: on };
    notifyPrefs();
  }
  try {
    await AsyncStorage.setItem(PREF_KEYS[key], on ? 'true' : 'false');
  } catch (err) {
    logSilentFailure('Feedback.savePref', err);
  }
}

/** `[prefs, setFeedbackPref]` via useSyncExternalStore — re-renders only the subscribing leaf. */
export function useFeedbackPrefs(): [FeedbackPrefs, typeof setFeedbackPref] {
  const current = useSyncExternalStore(subscribePrefs, getFeedbackPrefs, getFeedbackPrefs);
  return [current, setFeedbackPref];
}

// ─── Dev-panel previews ───

/** Dev panel only: plays the file bypassing prefs, master flag, throttle and boot silence (still no-op on web). Creates the players if not warmed. */
export function previewSound(name: UiSound): void {
  if (isWeb()) return;
  try {
    applyAudioMode();
    ensurePools();
    applyVolume();
    startPlayer(name);
  } catch (err) {
    logSilentFailure('Feedback.previewSound', err);
  }
}

/** Dev panel only: fires the haptic bypassing prefs, master flag, throttle and boot silence (still no-op on web). */
export function previewHaptic(kind: HapticKind): void {
  if (isWeb()) return;
  void fireHaptic(kind, true);
}
