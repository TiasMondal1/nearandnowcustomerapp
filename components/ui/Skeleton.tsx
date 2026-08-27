import React, { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { radius as radii } from "../../constants/ui";

export type SkeletonProps = {
  /** Default "100%". */
  width?: DimensionValue;
  /** Default 12. */
  height?: DimensionValue;
  /** Default 6. */
  radius?: number;
  /** Default C.bgSoft (home/payment-options currently use "#EFEDE7" — pass it explicitly to keep pixels). */
  color?: string;
  /** Subtle opacity pulse 1 → 0.55 → 1 over 1100ms (native driver). Default true. */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Placeholder block: C.bgSoft, radius 6, optional pulse. Hidden from screen readers. */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = radii.sm,
  color = C.bgSoft,
  animated = true,
  style,
  testID,
}: SkeletonProps) {
  const pulse = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (!animated) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [animated, pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: color, opacity: pulse }, style]}
      testID={testID}
    />
  );
}

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
}: SkeletonTextProps) {
  return (
    <View style={[styles.col, { gap }, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 && lines > 1 ? lastLineWidth ?? width : width}
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
export function SkeletonCircle({ size = 40, color, animated, style }: SkeletonCircleProps) {
  return <Skeleton width={size} height={size} radius={size / 2} color={color} animated={animated} style={style} />;
}

const styles = StyleSheet.create({
  col: { alignSelf: "stretch" },
});
