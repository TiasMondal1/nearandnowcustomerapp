// Skeleton — placeholder blocks on ONE shared colour clock (codename onyx, motion doc M12). Every animating
// Skeleton subscribes to a module-level `makeMutable` clock that starts on the first subscriber and is cancelled at
// zero: 60 skeletons on the Home cold start cost one running animation instead of sixty (MAP §4.2 P11).
// No per-instance loops; static under reduced motion, `Dev_Onyx_inhibit_Shimmer` and `Dev_Onyx_inhibit_Feature`.
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, interpolateColor, makeMutable, useAnimatedStyle, withRepeat, withTiming } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { motion, radius as radii } from "../../constants/ui";
import { subscribeDevFlags, useDevFlag } from "../../lib/devFlags";
import { dur, ease, useMotionReduced } from "./motion/presets";

// ─── Shared clock ─────────────────────────────────────────────────────────────
// 0 → 1 → 0 over `motion.skeletonPeriod` (1100 ms) each way, linear. Started lazily, cancelled and reset at zero.
const clock = makeMutable(0);
let clockSubscribers = 0;
// Period the running loop was started with; `Dev_Motion_inhibit_SpeedFactor` can change it while Skeletons are mounted.
let clockPeriod = 0;
// One dev-flag subscription for the whole clock, held only while it has subscribers (R4-12).
let clockFlagsUnsubscribe: (() => void) | null = null;
// Dev-only, once per JS session: proves the "60 skeletons, one animation" invariant (card checklist) without spamming.
let clockLoggedOnce = false;

function startClock(): void {
  clockPeriod = dur(motion.skeletonPeriod);
  clock.set(0);
  clock.set(withRepeat(withTiming(1, { duration: clockPeriod, easing: ease.linear }), -1, true));
}

function subscribeClock(): () => void {
  clockSubscribers += 1;
  if (clockSubscribers === 1) {
    startClock();
    // Restart at the new period when the speed factor changes mid-flight (e.g. `Dev_Onyx_inhibit_SkeletonExit`
    // holding skeletons on screen) instead of waiting for the subscriber count to drop to zero.
    clockFlagsUnsubscribe = subscribeDevFlags(() => {
      if (clockSubscribers > 0 && dur(motion.skeletonPeriod) !== clockPeriod) {
        cancelAnimation(clock);
        startClock();
      }
    });
    if (__DEV__ && !clockLoggedOnce) {
      clockLoggedOnce = true;
      console.log("[onyx] Skeleton clock started: one shared animation for every mounted Skeleton (getSkeletonClockSubscriberCount() tells how many share it)");
    }
  }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    clockSubscribers -= 1;
    if (clockSubscribers === 0) {
      clockFlagsUnsubscribe?.();
      clockFlagsUnsubscribe = null;
      cancelAnimation(clock);
      clock.set(0);
    }
  };
}

/** How many mounted Skeletons currently share the clock (dev panel / W3 audit: 60 skeletons → 60 here, ONE animation). */
export function getSkeletonClockSubscriberCount(): number {
  return clockSubscribers;
}

/** Fraction of the block width the shimmer band covers. */
const SWEEP_FRACTION = 0.6;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export type SkeletonProps = {
  /** Default "100%". */
  width?: DimensionValue;
  /** Default 12. */
  height?: DimensionValue;
  /** Corner radius. Default `radius.sm` (6). */
  radius?: number;
  /** Base colour. Default `C.skeletonLo`; the clock breathes it towards `C.skeletonHi`. Pass the screen's own tone where a screen already does (home / payment-options). */
  color?: string;
  /** Default true: subscribes to the shared colour clock (`color` ↔ `C.skeletonHi`, 1100 ms each way). False: static `color`, no subscription. */
  animated?: boolean;
  /**
   * Default false. Adds a 60 %-wide `LinearGradient` band (`color` → `C.skeletonHi` → `color`) swept across the block
   * by the same clock inside an overflow-hidden wrapper; the block colour then stays static so the band's edges match.
   * ONLY for hero blocks ≥ 80 px tall (banner, PDP image) — every gradient is a native view (motion doc C1).
   */
  shimmer?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Placeholder block. `useAnimatedStyle` → `backgroundColor: interpolateColor(clock, [0, 1], [color, C.skeletonHi])`
 * while `animated && !reduced && !Dev_Onyx_inhibit_Shimmer && !Dev_Onyx_inhibit_Feature`, else the static `color`.
 * Hidden from screen readers; wrap a loading layout in `SkeletonScreen` for the "Loading…" announcement.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = radii.sm,
  color = C.skeletonLo,
  animated = true,
  shimmer = false,
  style,
  testID,
}: SkeletonProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const inhibitShimmer = useDevFlag("Dev_Onyx_inhibit_Shimmer");
  const inhibitFeature = useDevFlag("Dev_Onyx_inhibit_Feature");
  const live = animated && !reduced && !inhibitShimmer && !inhibitFeature;
  // With a sweep the block itself stays static so the gradient's outer stops always match the block.
  const breathe = live && !shimmer;

  useEffect(() => {
    if (!live) return;
    return subscribeClock();
  }, [live]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: breathe ? interpolateColor(clock.get(), [0, 1], [color, C.skeletonHi]) : color,
  }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: color }, shimmer ? styles.clip : null, style, animatedStyle]}
      testID={testID}
    >
      {shimmer && live ? <Sweep color={color} /> : null}
    </Animated.View>
  );
}

/** The gradient band. Measures its block once (onLayout) and slides from fully left-outside to fully right-outside with the clock. */
function Sweep({ color }: { color: string }) {
  const [blockWidth, setBlockWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setBlockWidth(e.nativeEvent.layout.width);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (-SWEEP_FRACTION + clock.get() * (1 + SWEEP_FRACTION)) * blockWidth }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {blockWidth > 0 ? (
        <Animated.View style={[styles.sweepBand, { width: blockWidth * SWEEP_FRACTION }, sweepStyle]}>
          <LinearGradient colors={[color, C.skeletonHi, color]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── Compositions ─────────────────────────────────────────────────────────────

export type SkeletonTextProps = {
  /** Default 3. */
  lines?: number;
  /** Line width. Default "100%". */
  width?: DimensionValue;
  /** Width of the final line when `lines > 1`. Default = `width`. */
  lastLineWidth?: DimensionValue;
  /** Default 12. */
  lineHeight?: number;
  /** Default 8. */
  gap?: number;
  radius?: number;
  color?: string;
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Column of `lines` Skeleton lines. */
export function SkeletonText({
  lines = 3,
  width = "100%",
  lastLineWidth,
  lineHeight = 12,
  gap = 8,
  radius,
  color,
  animated,
  style,
}: SkeletonTextProps): React.JSX.Element {
  return (
    <View style={[styles.col, { gap }, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 && lines > 1 ? (lastLineWidth ?? width) : width}
          height={lineHeight}
          radius={radius}
          color={color}
          animated={animated}
        />
      ))}
    </View>
  );
}

export type SkeletonCircleProps = {
  /** Diameter. Default 40. */
  size?: number;
  color?: string;
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Circular Skeleton (avatars, icon wraps). */
export function SkeletonCircle({ size = 40, color, animated, style }: SkeletonCircleProps): React.JSX.Element {
  return <Skeleton width={size} height={size} radius={size / 2} color={color} animated={animated} style={style} />;
}

export type SkeletonScreenProps = {
  /** Announced by assistive tech. Default "Loading…". */
  label?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Wrapper for a screen's loading layout: one `accessibilityRole="progressbar"` element labelled "Loading…" with
 * `busy` state, so a screen reader hears one announcement instead of nothing (the Skeletons inside are hidden).
 * Unstyled by default — pass `style={{ flex: 1 }}` when it is the whole body.
 */
export function SkeletonScreen({ label = "Loading…", children, style, testID }: SkeletonScreenProps): React.JSX.Element {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={style} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignSelf: "stretch" },
  // Clips ONLY the sweep band inside a flat placeholder (no elevation here — MAP §7.4).
  clip: { overflow: "hidden" },
  sweepBand: { position: "absolute", top: 0, bottom: 0, left: 0 },
});
