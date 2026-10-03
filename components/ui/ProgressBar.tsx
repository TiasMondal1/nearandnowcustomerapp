import React, { useEffect, useRef } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { motion } from "../../constants/ui";
import { dur, ease, useMotionReduced } from "./motion/presets";

/** Active pill grows 6 % and settles, 200 + 200 ms (the "one 400 ms width pulse" of CONTRACTS §4.12). */
const PULSE_SCALE = 1.06;
const PULSE_HALF_MS = 200;
const SEGMENT_GAP = 4;

export type ProgressBarProps = {
  /** 0..1 (clamped; NaN → 0). Single mode: the fill fraction. Segmented mode: only the a11y value. */
  progress: number;
  /** Default 1 (one continuous bar). > 1 = that many pills with gap 4 (tracking uses 4). */
  segments?: number;
  /**
   * Segmented mode: pills before it are filled, this one is filled and pulses once per change, the rest are track.
   * Default: derived from `progress` (floor(progress × segments), capped at the last pill).
   */
  activeIndex?: number;
  /** Fill colour. Default C.primary. */
  color?: string;
  /** Track colour. Default C.bgSoft. */
  trackColor?: string;
  /** Bar/pill height in px; radius = height / 2 (6 → r3). Default 6. */
  height?: number;
  /** Default true: the fill eases over `motion.duration.slow` and the active pill pulses. `false` or reduced motion = snap. */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

type A11y = {
  accessibilityRole: "progressbar";
  accessibilityLabel?: string;
  accessibilityValue: { min: number; max: number; now: number };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Determinate progress. Single mode animates `scaleX` on the UI thread (never `width`) from the left edge;
 * segmented mode renders N pills. Role `progressbar` + `accessibilityValue` in percent.
 */
export function ProgressBar({
  progress,
  segments = 1,
  activeIndex,
  color = C.primary,
  trackColor = C.bgSoft,
  height = 6,
  animated = true,
  style,
  accessibilityLabel,
  testID,
}: ProgressBarProps): React.JSX.Element {
  const clamped = clamp01(progress);
  const a11y: A11y = {
    accessibilityRole: "progressbar",
    accessibilityLabel,
    accessibilityValue: { min: 0, max: 100, now: Math.round(clamped * 100) },
  };
  if (segments > 1) {
    const derived = Math.min(segments - 1, Math.floor(clamped * segments));
    return (
      <SegmentedBar
        count={Math.floor(segments)}
        active={activeIndex ?? derived}
        color={color}
        trackColor={trackColor}
        height={height}
        animated={animated}
        a11y={a11y}
        style={style}
        testID={testID}
      />
    );
  }
  return (
    <SingleBar
      progress={clamped}
      color={color}
      trackColor={trackColor}
      height={height}
      animated={animated}
      a11y={a11y}
      style={style}
      testID={testID}
    />
  );
}

type BarCommon = {
  color: string;
  trackColor: string;
  height: number;
  animated: boolean;
  a11y: A11y;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function SingleBar({ progress, color, trackColor, height, animated, a11y, style, testID }: BarCommon & { progress: number }) {
  const reduced = useMotionReduced();
  const animate = animated && !reduced;
  const fill = useSharedValue(progress);

  useEffect(() => {
    fill.set(animate ? withTiming(progress, { duration: dur(motion.duration.slow), easing: ease.decel }) : progress);
  }, [progress, animate, fill]);

  // scaleX from the left edge: RN ≥ 0.73 honours `transformOrigin` as a static style, reanimated only drives `transform`.
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }));
  const r = height / 2;

  return (
    <View {...a11y} style={[styles.track, { height, borderRadius: r, backgroundColor: trackColor }, style]} testID={testID}>
      <Animated.View style={[styles.fill, { backgroundColor: color, borderRadius: r }, fillStyle]} />
    </View>
  );
}

function SegmentedBar({ count, active, color, trackColor, height, animated, a11y, style, testID }: BarCommon & { count: number; active: number }) {
  const reduced = useMotionReduced();
  const animate = animated && !reduced;
  const pulse = useSharedValue(1);
  // Pulse only on a CHANGE of the active pill, not on mount (read/written inside the effect only).
  const lastActiveRef = useRef<number | null>(null);

  useEffect(() => {
    const first = lastActiveRef.current === null;
    const changed = lastActiveRef.current !== active;
    lastActiveRef.current = active;
    if (first || !changed || !animate) {
      pulse.set(1);
      return;
    }
    pulse.set(
      withSequence(
        withTiming(PULSE_SCALE, { duration: dur(PULSE_HALF_MS), easing: ease.decel }),
        withTiming(1, { duration: dur(PULSE_HALF_MS), easing: ease.standard }),
      ),
    );
  }, [active, animate, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: pulse.get() }] }));
  const r = height / 2;
  const pills: number[] = [];
  for (let i = 0; i < count; i += 1) pills.push(i);

  return (
    <View {...a11y} style={[styles.row, { height }, style]} testID={testID}>
      {pills.map((i) => {
        const filled = i <= active;
        const isActive = i === active;
        return (
          <Animated.View
            key={i}
            style={[styles.pill, { height, borderRadius: r, backgroundColor: filled ? color : trackColor }, isActive && pulseStyle]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: "hidden", alignSelf: "stretch" },
  fill: { ...StyleSheet.absoluteFillObject, transformOrigin: "left" },
  row: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", gap: SEGMENT_GAP },
  pill: { flex: 1 },
});
