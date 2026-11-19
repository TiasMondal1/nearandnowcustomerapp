/**
 * First-run permission prompts wait for Home.
 *
 * Right after OTP the app runs otp -> welcome -> Home (or -> onboarding) on its own, and a permission dialog
 * raised anywhere in that chain pauses the Activity under a queue of navigations (lib/pendingNativePrompts.ts
 * has the full story). So an automatic prompt is asked only once Home is the focused route and has been for
 * `delayMs` — a time-based wait, not the navigator's `transitionEnd`: react-native-screens reports the wrong
 * event when a transition ends while the Activity is paused.
 *
 * `setHomeFocused` is fed by components/NavActivityProbe from the pathname. In-memory, session-lifetime.
 */
import { onNativePromptsSettled } from './pendingNativePrompts';

/** Home must have been focused this long before a first-run prompt (covers the fade into Home) (ms). */
const HOME_SETTLE_MS = 700;

let homeFocused = false;
const focusListeners = new Set<() => void>();

/** Publishes whether `/(tabs)/home` is the focused route. Idempotent. */
export function setHomeFocused(focused: boolean): void {
  if (homeFocused === focused) return;
  homeFocused = focused;
  for (const cb of Array.from(focusListeners)) cb();
}

/** Sync read. */
export function isHomeFocused(): boolean {
  return homeFocused;
}

/**
 * Resolves once Home is focused, has stayed focused for `delayMs`, and no native prompt is up or just closed.
 * Leaving Home during the wait restarts it on the next focus. `cancel()` drops the wait (the promise then never
 * resolves); the promise never rejects.
 */
export function whenHomeSettled(delayMs: number = HOME_SETTLE_MS): { promise: Promise<void>; cancel: () => void } {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelSettled: (() => void) | null = null;
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const clearWaits = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    cancelSettled?.();
    cancelSettled = null;
  };

  // Runs now and on every focus change: a blur drops the running wait, a focus starts a new one.
  const step = () => {
    if (done) return;
    clearWaits();
    if (!homeFocused) return;
    timer = setTimeout(() => {
      timer = null;
      cancelSettled = onNativePromptsSettled(
        () => {
          if (done || !homeFocused) return;
          done = true;
          focusListeners.delete(step);
          resolvePromise();
        },
        { navigating: false },
      );
    }, delayMs);
  };

  focusListeners.add(step);
  step();

  return {
    promise,
    cancel: () => {
      done = true;
      focusListeners.delete(step);
      clearWaits();
    },
  };
}
