// Shake — horizontal error shake for a field or row (invalid input, wrong OTP / PIN, tip cap). Increment `trigger`
// to shake once. Reanimated 4; no translate under reduced motion.
import React, { useEffect, useRef } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { dur, useMotionReduced } from "./presets";

export type ShakeProps = {
  /** Monotonic counter: every increment shakes once. The value present at mount does NOT shake (restored state stays still). */
  trigger: number;
  /** Peak horizontal offset in px. Default 8 — the sequence is +a, −a, +0.75a, −0.75a, 0. */
  amplitude?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** One step of the five-step sequence, in ms (× speed factor). */
const STEP_MS = 60;

/**
 * Five 60 ms `withTiming` steps in a `withSequence` (300 ms total). Reduced motion: no translate — the caller's
 * error colour and haptic remain the feedback. Fires no feedback itself: the caller calls `feedback.error()` next
 * to the trigger increment so one event yields one haptic.
 */
export function Shake({ trigger, amplitude = 8, children, style, testID }: ShakeProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const translateX = useSharedValue(0);
  const lastTriggerRef = useRef(trigger);

  useEffect(() => {
    if (lastTriggerRef.current === trigger) return;
    lastTriggerRef.current = trigger;
    if (reduced) return;
    const step = dur(STEP_MS);
    const a = amplitude;
    translateX.set(
      withSequence(
        withTiming(a, { duration: step }),
        withTiming(-a, { duration: step }),
        withTiming(a * 0.75, { duration: step }),
        withTiming(-a * 0.75, { duration: step }),
        withTiming(0, { duration: step }),
      ),
    );
  }, [trigger, amplitude, reduced, translateX]);

  useEffect(
    () => () => {
      cancelAnimation(translateX);
      translateX.set(0);
    },
    [translateX],
  );

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.get() }] }));

  return (
    <Animated.View style={[style, animatedStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}
