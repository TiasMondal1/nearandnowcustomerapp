import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { HIT_SLOP, header, motion, opacity, radius, shadow, type ShadowName } from "../../constants/ui";
import type { HapticKind } from "../../lib/feedback";
import { PressableScale } from "./motion/PressableScale";
import type { IconName } from "./types";

export type IconButtonProps = {
  /** MaterialCommunityIcons glyph. Default "arrow-left". */
  icon?: IconName;
  onPress?: () => void;
  /** Required: icon-only controls must always be labelled for screen readers. */
  accessibilityLabel: string;
  /** Square side. Default 38 (header buttons); 40 on location/index headers. */
  size?: number;
  /** "rounded" = borderRadius 12; "circle" = size / 2 (list-screen headers). Default "rounded". */
  shape?: "rounded" | "circle";
  /** Adds borderWidth 1 C.border (checkout back button). */
  bordered?: boolean;
  /** Glyph size. Default 22 (20 in track/checkout). */
  iconSize?: number;
  /** Background. Default C.bgSoft; pass "transparent" for bare header glyphs, C.primary for the location add button. */
  bg?: string;
  /** Glyph color. Default C.text. */
  color?: string;
  /** Optional shadow preset name from constants/ui (e.g. "primarySm" for the location add button). */
  shadow?: ShadowName;
  /** Static `opacity.disabled` (0.45); presses ignored. */
  disabled?: boolean;
  /** Default HIT_SLOP (8) — lifts the 38 pt square to 54 pt. */
  hitSlop?: number;
  /**
   * Haptic fired in onPress BEFORE `onPress`. Default FALSE (rev. 2): back, close, share and the settings cog are
   * navigation and stay silent. A control that toggles state (the PDP heart) fires `feedback.toggle` itself.
   */
  haptic?: HapticKind | false;
  /** Applied to the OUTER (scaled) wrapper: margins, position, flex. The square itself is sized by `size`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * 38×38 r12 C.bgSoft square with a 22px C.text glyph on `PressableScale` (scale 0.9 = `motion.scale.icon`);
 * pressed face C.border (instant, no opacity fade); hitSlop 8; no haptic by default.
 */
export function IconButton({
  icon = header.backIcon,
  onPress,
  accessibilityLabel,
  size = header.iconButton,
  shape = "rounded",
  bordered = false,
  iconSize = header.backIconSize,
  bg = C.bgSoft,
  color = C.text,
  shadow: shadowName,
  disabled = false,
  hitSlop = HIT_SLOP,
  haptic,
  style,
  testID,
}: IconButtonProps) {
  return (
    <PressableScale
      scale={motion.scale.icon}
      haptic={haptic ?? false}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={hitSlop}
      onPress={onPress}
      disabled={disabled}
      style={style}
      innerStyle={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: shape === "circle" ? size / 2 : radius.xl,
          backgroundColor: bg,
        },
        bordered && styles.bordered,
        shadowName && shadow[shadowName],
        disabled && styles.disabled,
      ]}
      pressedStyle={styles.pressed}
      testID={testID}
    >
      <MaterialCommunityIcons name={icon} size={iconSize} color={color} />
    </PressableScale>
  );
}

export type BackButtonProps = Omit<IconButtonProps, "accessibilityLabel" | "onPress"> & {
  /** Default "Go back". */
  accessibilityLabel?: string;
  /** Override the default navigation (canGoBack ? back : replace(fallbackHref)). */
  onPress?: () => void;
  /** Where to go when there is no history to pop. Default "/(tabs)/home". */
  fallbackHref?: Href;
};

/** IconButton preset: "arrow-left", labelled "Go back", pops history or falls back to the home tab. Silent (navigation). */
export function BackButton({
  accessibilityLabel = "Go back",
  onPress,
  fallbackHref = "/(tabs)/home",
  ...rest
}: BackButtonProps) {
  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  };
  return <IconButton {...rest} accessibilityLabel={accessibilityLabel} onPress={handlePress} />;
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  bordered: { borderWidth: 1, borderColor: C.border },
  pressed: { backgroundColor: C.border },
  disabled: { opacity: opacity.disabled },
});
