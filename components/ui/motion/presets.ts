// codename: onyx
// Motion presets for the whole app: easings, the dev speed factor, enter/exit/layout presets and the
// reduced-motion hooks. Every primitive and screen reads motion through this module so that
// `Dev_Motion_inhibit_SpeedFactor` and the Onyx inhibit flags apply everywhere at once.
//
// Presets are FUNCTIONS (`enter.rise()`, `layoutTiming()`): the speed factor is read when a preset is used,
// not when the module loads. `getDevFlag` is a sync read of a module cache, so calling a preset inside render
// is fine (once per render); code that must react live to a flag flip uses the `use*` hooks below.
import React from "react";
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
  ReducedMotionConfig,
  useReducedMotion,
  type EasingFunction,
} from "react-native-reanimated";

import { motion } from "../../../constants/ui";
import { getDevFlag, useDevFlag } from "../../../lib/devFlags";

// ─── Speed factor ─────────────────────────────────────────────────────────────

/** `Dev_Motion_inhibit_SpeedFactor` (1–10, default 1), clamped so a bad persisted value can never freeze motion. */
function speedFactor(): number {
  const f = getDevFlag("Dev_Motion_inhibit_SpeedFactor");
  return typeof f === "number" && Number.isFinite(f) && f >= 1 ? f : 1;
}

/**
 * Multiply a duration in ms by the dev speed factor (×1 in production). Read at CALL time: use it inside
 * handlers, effects and the preset functions; never cache the result at module scope.
 */
export const dur = (ms: number): number => ms * speedFactor();

/**
 * Slow a spring by the dev speed factor WITHOUT changing its shape: ω = √(k/m) ⇒ stiffness / f²,
 * ζ = c / (2√(km)) ⇒ damping / f. Returns the input object untouched at factor 1. Read at call time.
 */
export const spr = <S extends { damping: number; stiffness: number; mass?: number }>(s: S): S => {
  const f = speedFactor();
  if (f === 1) return s;
  return { ...s, damping: s.damping / f, stiffness: s.stiffness / (f * f) };
};

// ─── Easings ──────────────────────────────────────────────────────────────────

/**
 * standard: Material "standard" curve (fast start, soft landing) — colour, progress, chevrons, layout timing.
 * decel: ease-out cubic — things arriving (count-ups, rings, confetti). accel: ease-in cubic — things leaving.
 * linear: clocks (skeleton).
 */
export const ease: { standard: EasingFunction; decel: EasingFunction; accel: EasingFunction; linear: EasingFunction } = {
  standard: Easing.bezierFn(0.2, 0, 0, 1),
  decel: Easing.out(Easing.cubic),
  accel: Easing.in(Easing.cubic),
  linear: Easing.linear,
};

// ─── Enter / exit / layout presets ────────────────────────────────────────────
// Under ReduceMotion.Always (see MotionConfig) reanimated reduces every entering/exiting/layout animation
// to an instant change by itself; nothing else is needed at the call site.

/**
 * rise: FadeInUp over `slow` (340 ms), springified at damping 18 — CartBar, thank-you states, sheets' content.
 * drop: FadeInDown over `base` (220 ms), springified at damping 18 — dropdowns, banners from the top.
 * fade: FadeIn over `fast` (120 ms) — crossfades, collapsible content, new list rows.
 */
export const enter = {
  rise: () => FadeInUp.duration(dur(motion.duration.slow)).springify().damping(18),
  drop: () => FadeInDown.duration(dur(motion.duration.base)).springify().damping(18),
  fade: () => FadeIn.duration(dur(motion.duration.fast)),
};

/**
 * fall: FadeOutDown over `base` (220 ms) — CartBar leaving, dismissed toasts.
 * lift: FadeOutUp over `base` (220 ms) — banners leaving upwards.
 * fade: FadeOut over `instant` (80 ms) — the exit half of every crossfade.
 */
export const exit = {
  fall: () => FadeOutDown.duration(dur(motion.duration.base)),
  lift: () => FadeOutUp.duration(dur(motion.duration.base)),
  fade: () => FadeOut.duration(dur(motion.duration.instant)),
};

/**
 * LinearTransition on the `snappy` spring (damping 22, stiffness 320, mass 0.8), reshaped live by the speed
 * factor. Stepper width morph, toast stack, digit columns. Gate with `useLayoutTransitionsEnabled()`.
 */
export const layoutSpring = () => {
  const s = spr(motion.spring.snappy);
  return LinearTransition.springify().damping(s.damping).stiffness(s.stiffness).mass(s.mass);
};

/** LinearTransition timed at `base` (220 ms) on the standard easing — anything that must not overshoot. */
export const layoutTiming = () => LinearTransition.duration(dur(motion.duration.base)).easing(ease.standard);

// ─── Reduced-motion hooks ─────────────────────────────────────────────────────

/**
 * True when motion must be reduced: the OS reduce-motion setting (unless `Dev_Onyx_inhibit_SystemReduceMotion`
 * tells us to ignore it), `Dev_Onyx_inhibit_Animations`, or the master `Dev_Onyx_inhibit_Feature`.
 *
 * reanimated 4.1's `useReducedMotion()` returns the value captured at app start and is NOT affected by
 * `ReducedMotionConfig`, so the "ignore system" flag is applied here explicitly. Primitives use this hook for
 * what `ReducedMotionConfig` cannot cover: loops, confetti, digit rolls, the press scale.
 */
export function useMotionReduced(): boolean {
  const system = useReducedMotion();
  const ignoreSystem = useDevFlag("Dev_Onyx_inhibit_SystemReduceMotion");
  const inhibitAnimations = useDevFlag("Dev_Onyx_inhibit_Animations");
  const inhibitFeature = useDevFlag("Dev_Onyx_inhibit_Feature");
  return (system && !ignoreSystem) || inhibitAnimations || inhibitFeature;
}

/**
 * `!useMotionReduced() && !Dev_Onyx_inhibit_LayoutTransitions`. Gate every `layout={…}` prop with it
 * (Collapsible height, Stepper morph, toast stack, digit columns) so the flag makes them snap.
 */
export function useLayoutTransitionsEnabled(): boolean {
  const reduced = useMotionReduced();
  const inhibitLayout = useDevFlag("Dev_Onyx_inhibit_LayoutTransitions");
  return !reduced && !inhibitLayout;
}

/**
 * Root motion configuration — mounted ONCE in app/_layout.tsx inside the dev-flag provider tree.
 * mode = Always when `Dev_Onyx_inhibit_Animations` or `Dev_Onyx_inhibit_Feature`, Never when
 * `Dev_Onyx_inhibit_SystemReduceMotion`, System otherwise. reanimated's `ReducedMotionConfig` renders null,
 * takes no children and logs a dev warning on every mount, so it is only mounted while the mode differs from
 * System; its unmount restores the system value.
 */
export function MotionConfig({ children }: { children: React.ReactNode }): React.JSX.Element {
  const inhibitAnimations = useDevFlag("Dev_Onyx_inhibit_Animations");
  const inhibitFeature = useDevFlag("Dev_Onyx_inhibit_Feature");
  const ignoreSystem = useDevFlag("Dev_Onyx_inhibit_SystemReduceMotion");
  const mode =
    inhibitAnimations || inhibitFeature ? ReduceMotion.Always : ignoreSystem ? ReduceMotion.Never : ReduceMotion.System;
  return React.createElement(
    React.Fragment,
    null,
    mode === ReduceMotion.System ? null : React.createElement(ReducedMotionConfig, { mode }),
    children,
  );
}
