// Pulse — one-shot or looping expanding ring (order "live" dot, tracking rider halo, payment-overlay halo).
// Reanimated 4, one progress value per instance. The loop runs ONLY while `active` and is cancelled on cleanup;
// under reduced motion it is a static ring (no idle loop — DECISIONS D10).
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { motion } from "../../../constants/ui";
import { dur, ease, useMotionReduced } from "./presets";

export type PulseProps = {
  /** Diameter of the ring at scale 1, in px. Position it under/around a dot of the same size (absolute, same centre). */
  size: number;
  /** Ring colour (a `C` token). */
  color: string;
  /** Loop while true. Default `true`. False hides the ring (opacity 0) and cancels the loop. */
  active?: boolean;
  /** Run ONE cycle (on mount while `active`, and again each time `active` turns true) then rest hidden. Default `false`. */
  once?: boolean;
  /** One cycle in ms. Default `motion.pulsePeriod` (1400), multiplied by `Dev_Motion_inhibit_SpeedFactor`. */
  period?: number;
  /** Scale at the start of a cycle. Default 0.6. */
  fromScale?: number;
  /** Scale at the end of a cycle. Default 1.9. */
  toScale?: number;
  /** Opacity at the start of a cycle; it fades to 0 by the end. Default 0.45. */
  fromOpacity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Reduced motion: the ring sits still at this opacity and scale 1 (motion doc §1.3). */
const REDUCED_RING_OPACITY = 0.35;

/**
 * Expanding, fading ring. Full motion: `withRepeat(withTiming(1, { duration: dur(period), easing: ease.decel }), -1)`
 * on one progress value → scale `fromScale → toScale`, opacity `fromOpacity → 0`; `once` runs that timing a single
 * time. Reduced motion (OS or Onyx flags): a static ring at opacity 0.35 while `active` (hidden when `active` is false),
 * nothing animates.
 * Never intercepts touches and is hidden from assistive tech. Fires no feedback.
 */
export function Pulse({
  size,
  color,
  active = true,
  once = false,
  period = motion.pulsePeriod,
  fromScale = 0.6,
  toScale = 1.9,
  fromOpacity = 0.45,
  style,
  testID,
}: PulseProps): React.JSX.Element {
  const reduced = useMotionReduced();
  // 0 = start of a cycle (small, visible), 1 = end of a cycle (large, transparent) — also the resting value.
  const progress = useSharedValue(1);

  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(progress);
      progress.set(1);
      return;
    }
    progress.set(0);
    if (once) {
      progress.set(withTiming(1, { duration: dur(period), easing: ease.decel }));
    } else {
      progress.set(withRepeat(withTiming(1, { duration: dur(period), easing: ease.decel }), -1, false));
    }
    return () => {
      cancelAnimation(progress);
      progress.set(1);
    };
  }, [active, once, period, reduced, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: fromOpacity * (1 - p),
      transform: [{ scale: fromScale + (toScale - fromScale) * p }],
    };
  });

  const ring = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };

  if (reduced) {
    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[ring, active ? styles.reducedRing : styles.hidden, style]}
        testID={testID}
      />
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[ring, animatedStyle, style]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  reducedRing: { opacity: REDUCED_RING_OPACITY },
  hidden: { opacity: 0 },
});
