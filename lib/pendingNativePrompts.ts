/**
 * Native permission dialogs (push notifications, location, ...) and the JS-driven
 * navigations around them: the one place that keeps the two apart.
 *
 * Why this exists: on a clean install both permissions are undetermined, so the
 * first login raises real OS dialogs. On Android a permission dialog is a
 * separate Activity — ours is PAUSED under it: JS timers stop firing and Fabric
 * stops mounting until the user answers. Everything that queued up meanwhile
 * (the otp -> welcome change, welcome's overdue auto-advance, Home's own
 * location dialog) then lands within a few frames of the resume, and a native
 * fault in that burst never reaches ErrorBoundary — the Activity just goes
 * blank until it is cleared from recents (reported 2026-09-09 and again
 * 2026-11-19; see bug_fixes_2026-07-23.md).
 *
 * The 2026-09-09 version only delayed navigations while a flag was set, and the
 * prompts were "deferred" with InteractionManager.runAfterInteractions. In this
 * React Native version that call is a plain setImmediate (the interaction
 * manager is disabled by default), and the flag was set only after two native
 * awaits, so the gate never engaged. The rules now are:
 *
 *   - a PROMPT starts only when the app is active, no other prompt is up, the
 *     last one closed at least PROMPT_GAP_MS ago, nothing navigated in the last
 *     NAV_QUIET_MS, and (optionally) its own screen has been up long enough.
 *     The pending flag is set synchronously in the same tick as the request;
 *   - a NAVIGATION that may follow a prompt waits until the app is active, no
 *     prompt is up, and SETTLE_MS have passed since the later of "the prompt
 *     closed" and "the Activity resumed" — never in the frame of the resume.
 *
 * Nothing here navigates at a cap while a dialog is up. The only cap is leak
 * protection: a flag still set after LEAK_CAP_MS of ACTIVE time (the dialog
 * would have paused us) is dropped.
 *
 * Every stamp and comparison below uses a MONOTONIC clock (`monoNow`), never the
 * wall clock: `Date.now()` can step backwards (automatic time re-enabled, a
 * manual change, a network time correction), and a quiet period measured across
 * such a step would hold every gated navigation until the clock caught up.
 *
 * Session-lifetime, in-memory only — not persisted, nothing here needs to
 * survive a reload.
 */
import { AppState } from 'react-native';

import { logSilentFailure } from './logSilentFailure';

/** How often waiters re-check while something is holding them (ms). Frozen with every other timer under a dialog. */
const POLL_MS = 100;
/** Quiet time after a prompt closes / the Activity resumes before a navigation may be issued (ms). */
const SETTLE_MS = 400;
/** Gap between two prompts, and between a resume and the next prompt (ms). */
const PROMPT_GAP_MS = 600;
/** A prompt never starts sooner than this after a navigation (covers the Stack transition) (ms). */
const NAV_QUIET_MS = 700;
/** A flag still set after this much ACTIVE time was leaked by a request that never settled (ms). */
const LEAK_CAP_MS = 10_000;
/** The longest a caller's `notBefore` may hold a prompt back (a wall-clock step must not stretch it) (ms). */
const NOT_BEFORE_CAP_MS = 2000;

/** Monotonic ms (never steps backwards). `performance.now()` exists in Hermes, on web and in Node; the wall clock is only the fallback. */
function monoNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

// Stamps are `monoNow()` values. "Never happened" is -Infinity, not 0: the monotonic clock itself starts near 0.
const pending = new Set<symbol>();
let lastReleasedAt = Number.NEGATIVE_INFINITY;
let lastActiveAt = Number.NEGATIVE_INFINITY;
let lastNavigationAt = Number.NEGATIVE_INFINITY;
let leakedMs = 0;

// Stamp every return to the foreground. The very first `active` of a cold start is not a return (nothing was
// paused before it), so it is not stamped and the boot redirect is never held back by it.
let wasAway = false;
AppState.addEventListener('change', (state) => {
  if (state === 'background' || state === 'inactive') {
    wasAway = true;
  } else if (state === 'active' && wasAway) {
    wasAway = false;
    lastActiveAt = monoNow();
  }
});

function isAppActive(): boolean {
  const state = AppState.currentState;
  return state !== 'background' && state !== 'inactive';
}

// ─── Waiters (one shared poll loop, served in arrival order) ────────────────

type Waiter = {
  kind: 'navigate' | 'prompt' | 'idle';
  settleMs: number;
  /** Prompts only: `monoNow()` value before which the prompt must not start. */
  notBefore: number;
  fire: () => void;
};

const waiters: Waiter[] = [];
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let lastPollAt = 0;

function isReady(waiter: Waiter, now: number): boolean {
  if (!isAppActive() || pending.size > 0) return false;
  if (now - Math.max(lastReleasedAt, lastActiveAt) < waiter.settleMs) return false;
  if (waiter.kind === 'prompt') {
    if (now < waiter.notBefore) return false;
    if (now - lastNavigationAt < NAV_QUIET_MS) return false;
  }
  return true;
}

/** Fires every waiter whose condition holds, oldest first. Each check and its `fire` share one tick, so a prompt that starts here is seen by every later waiter. */
function serve(now: number): void {
  for (const waiter of waiters.slice()) {
    const index = waiters.indexOf(waiter);
    if (index === -1 || !isReady(waiter, now)) continue;
    waiters.splice(index, 1);
    if (waiter.kind === 'navigate') lastNavigationAt = now;
    try {
      waiter.fire();
    } catch (err) {
      logSilentFailure('Native prompt gate callback', err);
    }
  }
}

function poll(): void {
  pollTimer = null;
  const now = monoNow();
  if (pending.size === 0) {
    leakedMs = 0;
  } else if (isAppActive()) {
    // Only time spent ACTIVE with the flag set counts: under a real dialog the app is not active (and on
    // Android this timer is not even running). The step is clamped so the first tick after a pause adds one step.
    leakedMs += Math.min(now - lastPollAt, POLL_MS * 2);
    if (leakedMs >= LEAK_CAP_MS) {
      pending.clear();
      leakedMs = 0;
      lastReleasedAt = now;
      logSilentFailure('Native prompt gate', new Error('prompt flag still set after 10 s of active time; released'));
    }
  }
  lastPollAt = now;
  serve(now);
  if (waiters.length > 0) pollTimer = setTimeout(poll, POLL_MS);
}

/** Registers a waiter, serves it at once when its condition already holds, and returns its cancel. */
function addWaiter(waiter: Waiter): () => void {
  waiters.push(waiter);
  serve(monoNow());
  if (waiters.length > 0 && !pollTimer) {
    lastPollAt = monoNow();
    pollTimer = setTimeout(poll, POLL_MS);
  }
  return () => {
    const index = waiters.indexOf(waiter);
    if (index !== -1) waiters.splice(index, 1);
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Marks a native prompt as on screen from this tick; call the returned function once it settles (success,
 * failure, or dismissed either way). Prefer `runNativePrompt`, which also sequences the request — this is the
 * bare flag for a caller that must raise its dialog right now.
 */
export function beginNativePrompt(): () => void {
  const token = Symbol('native-prompt');
  if (pending.size === 0) leakedMs = 0;
  pending.add(token);
  return () => {
    // A token already dropped by the leak cap must not stamp a second release.
    if (pending.delete(token)) lastReleasedAt = monoNow();
  };
}

export function isNativePromptPending(): boolean {
  return pending.size > 0;
}

/** Stamps "a navigation just happened" so no prompt starts inside its transition. Called by components/NavActivityProbe for every route change; the settled waits below stamp it themselves. */
export function noteNavigation(): void {
  lastNavigationAt = monoNow();
}

/**
 * Runs one native permission request, serialised with every other one: waits until the app is active, no other
 * prompt is up, the previous one closed (or the Activity resumed) at least 600 ms ago and nothing navigated in
 * the last 700 ms; then sets the pending flag and calls `ask` in the same tick. `notBefore` (ms epoch, i.e. a
 * `Date.now()` value) holds it back further, e.g. until the requesting screen has finished its own transition —
 * by at most 2 s from now. Resolves / rejects with `ask`.
 */
export function runNativePrompt<T>(ask: () => Promise<T>, opts?: { notBefore?: number }): Promise<T> {
  // The caller's epoch becomes a delay on the monotonic clock here, once; clamped so neither a past value nor a
  // wall-clock step between the caller's stamp and now can produce a negative or an unbounded hold.
  const holdMs = opts?.notBefore == null ? 0 : Math.min(Math.max(opts.notBefore - Date.now(), 0), NOT_BEFORE_CAP_MS);
  return new Promise<T>((resolve, reject) => {
    addWaiter({
      kind: 'prompt',
      settleMs: PROMPT_GAP_MS,
      notBefore: monoNow() + holdMs,
      fire: () => {
        const release = beginNativePrompt();
        let asked: Promise<T>;
        try {
          asked = ask();
        } catch (err) {
          asked = Promise.reject(err);
        }
        asked.then(
          (value) => {
            release();
            resolve(value);
          },
          (err: unknown) => {
            release();
            reject(err);
          },
        );
      },
    });
  });
}

export type SettledOptions = {
  /** Quiet time required since the last prompt closed / the Activity resumed. Default 400 ms. */
  settleMs?: number;
  /** Default true: the caller navigates in the callback, so prompts keep clear of that transition. Pass false for a plain wait. */
  navigating?: boolean;
};

/**
 * Calls `cb` once the app is active, no native prompt is up and things have been quiet for `settleMs` — at once
 * (synchronously) when that already holds, which is every launch after the first. The check and `cb` share one
 * tick, so no prompt can start in between. Returns the cancel. Never fires at a cap while a dialog is up.
 */
export function onNativePromptsSettled(cb: () => void, opts?: SettledOptions): () => void {
  return addWaiter({
    kind: opts?.navigating === false ? 'idle' : 'navigate',
    settleMs: opts?.settleMs ?? SETTLE_MS,
    notBefore: 0,
    fire: cb,
  });
}

/** Promise form of `onNativePromptsSettled` for async handlers (not cancellable — effects use the callback form). */
export function waitForNativePromptsSettled(opts?: SettledOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    onNativePromptsSettled(resolve, opts);
  });
}
