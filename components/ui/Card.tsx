import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { clipOverflow, layout, motion, radius, shadow, type ShadowName } from "../../constants/ui";
import type { HapticKind } from "../../lib/feedback";
import { PressableScale } from "./motion/PressableScale";

export type CardProps = {
  children?: React.ReactNode;
  /** "md" (default) = radius 14 / padding 14; "lg" = radius 16 / padding 16. */
  size?: "md" | "lg";
  /** Default true. `false` = padding 0 + overflow clipping (row-list container). */
  padded?: boolean;
  /** Shadow preset name from constants/ui. Default none. */
  shadow?: ShadowName;
  /** Background override. Default C.card. */
  bg?: string;
  /** Border color override. Default C.border. */
  borderColor?: string;
  /**
   * Makes the whole card a button on `PressableScale` (scale 0.97 = `motion.scale.card`, pressed face C.bgSoft).
   * Omitted = a plain View (unchanged look).
   */
  onPress?: () => void;
  /** Haptic fired before `onPress`. Default FALSE (rev. 2) — a card press is navigation. */
  haptic?: HapticKind | false;
  /** Screen-reader label for a pressable card (e.g. "Order 1234, delivered"). */
  accessibilityLabel?: string;
  /** Static `opacity.disabled` is NOT applied here (cards do not dim); presses are ignored. */
  disabled?: boolean;
  /**
   * Plain card: applied to the surface. Pressable card: applied to the OUTER (scaled) wrapper — use it for
   * margins/flex; surface overrides go through `bg`, `borderColor`, `padded`.
   */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * C.card surface with 1px C.border. Unpadded cards clip their children: with a shadow the
 * clip uses `clipOverflow` (Android-only "hidden", so iOS keeps the shadow), otherwise "hidden".
 */
export function Card({
  children,
  size = "md",
  padded = true,
  shadow: shadowName,
  bg,
  borderColor,
  onPress,
  haptic,
  accessibilityLabel,
  disabled = false,
  style,
  testID,
}: CardProps) {
  const lg = size === "lg";
  const surface = [
    styles.base,
    lg ? styles.lg : styles.md,
    padded ? (lg ? styles.padLg : styles.padMd) : shadowName ? styles.clipGuarded : styles.clip,
    shadowName && shadow[shadowName],
    bg !== undefined && { backgroundColor: bg },
    borderColor !== undefined && { borderColor },
  ];

  if (!onPress) {
    return (
      <View style={[surface, style]} testID={testID} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  }

  return (
    <PressableScale
      scale={motion.scale.card}
      haptic={haptic ?? false}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={style}
      innerStyle={surface}
      pressedStyle={styles.pressed}
      testID={testID}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  md: { borderRadius: radius.xxl },
  lg: { borderRadius: radius.card },
  padMd: { padding: layout.cardPadding },
  padLg: { padding: layout.cardPaddingLg },
  clip: { overflow: "hidden" },
  clipGuarded: { overflow: clipOverflow },
  pressed: { backgroundColor: C.bgSoft },
});
