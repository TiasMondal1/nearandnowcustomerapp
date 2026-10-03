import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type Insets,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { C } from "../../constants/colors";
import { motion, opacity, radius, shadow, text } from "../../constants/ui";
import type { HapticKind } from "../../lib/feedback";
import { PressableScale } from "./motion/PressableScale";
import type { IconName } from "./types";

export type PrimaryButtonSize = "lg" | "md" | "sm" | "xs";
export type PrimaryButtonVariant = "primary" | "secondary" | "danger" | "warning" | "success" | "outline" | "ghost";

export type PrimaryButtonProps = {
  label: string;
  onPress?: () => void;
  /** Leading glyph. */
  icon?: IconName;
  /** Trailing glyph. */
  iconRight?: IconName;
  /** Glyph size. Default by size: lg/md 20, sm 18, xs 14. */
  iconSize?: number;
  /**
   * Every size is r12 (`radius.xl`, BP-03).
   * lg = pv16 ph20 text 16/800 ls0.3 gap10 · md (default) = pv15 ph20 text 15/800 gap10 ·
   * sm = pv12 ph24 text 14/700 gap8 · xs = pv10 ph16 text 13/700 gap6.
   */
  size?: PrimaryButtonSize;
  /**
   * primary (default) = C.primary face, C.onPrimary label, pressed C.primaryDark ·
   * secondary = C.bgSoft, 1px C.border, C.text label, pressed C.border ·
   * danger = C.dangerLight, 1px C.dangerBorder, C.danger label, pressed C.dangerBorder ·
   * warning = C.warning, C.onPrimary label, pressed C.warningText ·
   * success = C.success, C.onPrimary label, pressed C.successText ·
   * outline = C.card, 1px C.primary, C.primary label, pressed C.primaryXLight ·
   * ghost = transparent, C.primary label, pressed C.primaryXLight.
   * The pressed face is an instant colour swap (never an opacity fade) on top of the 0.97 scale dip.
   */
  variant?: PrimaryButtonVariant;
  /**
   * Coloured glow (`shadow.primaryLg` for lg/md, `shadow.primarySm` for sm/xs, tinted by the face colour).
   * Default FALSE for every size (owner's "no CTA shadows"). Ignored for secondary/danger/outline/ghost.
   */
  shadow?: boolean;
  /** Static `opacity.disabled` (0.45) on the face; presses ignored. A state, not a press fade. */
  disabled?: boolean;
  /** Replaces the label with an ActivityIndicator while keeping the button's width/height; presses ignored. */
  loading?: boolean;
  /** alignSelf "stretch" on the outer wrapper. Default: true for lg/md, false for sm/xs (then alignSelf is left to the parent). */
  fullWidth?: boolean;
  /**
   * Haptic fired in onPress BEFORE `onPress`. Default FALSE — CTAs are quiet; the result of the action plays
   * feedback (CONTRACTS §8). Opt in only where the press itself changes state.
   */
  haptic?: HapticKind | false;
  /**
   * Applied to the OUTER (scaled) wrapper: margins, flex, alignSelf. Face colours/paddings come from
   * `variant`/`size` — overrides of those through `style` do not reach the face.
   */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /**
   * Pressable hit slop. Default lifts the compact faces to ≥ 44 pt (MAP §2.4 #18): xs (≈38 pt) gets ±4 on every
   * side, sm (≈43 pt) gets ±2 top/bottom; lg/md get none. Stacked xs/sm rows with ≥ 8 px gaps stay
   * non-overlapping at those defaults — pass your own (or `0`) where a tighter layout needs it.
   */
  hitSlop?: Insets | number;
  /** Default: the label. */
  accessibilityLabel?: string;
  testID?: string;
};

type VariantSpec = { bg: string; color: string; pressed: string; borderColor?: string; shadowColor?: string };

const VARIANT: Record<PrimaryButtonVariant, VariantSpec> = {
  primary: { bg: C.primary, color: C.onPrimary, pressed: C.primaryDark, shadowColor: C.primary },
  secondary: { bg: C.bgSoft, color: C.text, pressed: C.border, borderColor: C.border },
  danger: { bg: C.dangerLight, color: C.danger, pressed: C.dangerBorder, borderColor: C.dangerBorder },
  warning: { bg: C.warning, color: C.onPrimary, pressed: C.warningText, shadowColor: C.warning },
  success: { bg: C.success, color: C.onPrimary, pressed: C.successText, shadowColor: C.success },
  outline: { bg: C.card, color: C.primary, pressed: C.primaryXLight, borderColor: C.primary },
  ghost: { bg: "transparent", color: C.primary, pressed: C.primaryXLight },
};

const DEFAULT_ICON_SIZE: Record<PrimaryButtonSize, number> = { lg: 20, md: 20, sm: 18, xs: 14 };

// Compact faces fall short of 44 pt (xs pv10 + 13 px ≈ 38 pt, sm pv12 + 14 px ≈ 43 pt); the slop lifts the
// target without touching the visual. lg/md are already ≥ 44 pt.
const XS_HIT_SLOP: Insets = { top: 4, bottom: 4, left: 4, right: 4 };
const SM_HIT_SLOP: Insets = { top: 2, bottom: 2, left: 0, right: 0 };
const DEFAULT_HIT_SLOP: Record<PrimaryButtonSize, Insets | undefined> = {
  lg: undefined,
  md: undefined,
  sm: SM_HIT_SLOP,
  xs: XS_HIT_SLOP,
};

/**
 * Filled CTA on `PressableScale` (scale 0.97 = `motion.scale.cta`, spring back). Default: C.primary face,
 * r12, pv15, C.onPrimary 15/800 label, full width, no shadow, no haptic.
 */
export function PrimaryButton({
  label,
  onPress,
  icon,
  iconRight,
  iconSize,
  size = "md",
  variant = "primary",
  shadow: shadowProp = false,
  disabled = false,
  loading = false,
  fullWidth,
  haptic,
  style,
  textStyle,
  hitSlop,
  accessibilityLabel,
  testID,
}: PrimaryButtonProps) {
  const v = VARIANT[variant];
  const isCompact = size === "sm" || size === "xs";
  const stretch = fullWidth ?? !isCompact;
  const withShadow = shadowProp && v.shadowColor !== undefined;
  const shadowStyle = withShadow
    ? { ...(isCompact ? shadow.primarySm : shadow.primaryLg), shadowColor: v.shadowColor }
    : null;
  const inactive = disabled || loading;
  const glyph = iconSize ?? DEFAULT_ICON_SIZE[size];

  const sizeStyle =
    size === "lg" ? styles.lg : size === "sm" ? styles.sm : size === "xs" ? styles.xs : styles.md;
  const labelStyle =
    size === "lg" ? styles.textLg : size === "sm" ? styles.textSm : size === "xs" ? styles.textXs : styles.textMd;
  const gapStyle = size === "xs" ? styles.gapXs : size === "sm" ? styles.gapSm : styles.gapMd;

  return (
    <PressableScale
      scale={motion.scale.cta}
      haptic={haptic ?? false}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={hitSlop ?? DEFAULT_HIT_SLOP[size]}
      onPress={onPress}
      style={[stretch && styles.stretch, style]}
      innerStyle={[
        styles.base,
        sizeStyle,
        { backgroundColor: v.bg },
        v.borderColor !== undefined && { borderWidth: 1, borderColor: v.borderColor },
        shadowStyle,
        disabled && styles.disabled,
      ]}
      pressedStyle={{ backgroundColor: v.pressed }}
      testID={testID}
    >
      <View style={[styles.content, gapStyle, loading && styles.hidden]}>
        {icon ? <MaterialCommunityIcons name={icon} size={glyph} color={v.color} /> : null}
        <Text style={[labelStyle, { color: v.color }, textStyle]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
          {label}
        </Text>
        {iconRight ? <MaterialCommunityIcons name={iconRight} size={glyph} color={v.color} /> : null}
      </View>
      {loading ? (
        <View style={styles.spinnerWrap} pointerEvents="none">
          <ActivityIndicator size="small" color={v.color} />
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", borderRadius: radius.xl },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  gapMd: { gap: 10 },
  gapSm: { gap: 8 },
  gapXs: { gap: 6 },
  stretch: { alignSelf: "stretch" },
  hidden: { opacity: 0 },
  spinnerWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: opacity.disabled },

  lg: { paddingVertical: 16, paddingHorizontal: 20 },
  md: { paddingVertical: 15, paddingHorizontal: 20 },
  sm: { paddingVertical: 12, paddingHorizontal: 24 },
  xs: { paddingVertical: 10, paddingHorizontal: 16 },

  textLg: { fontSize: text.buttonLg.fontSize, fontFamily: text.buttonLg.fontFamily, letterSpacing: text.buttonLg.letterSpacing },
  textMd: { fontSize: text.button.fontSize, fontFamily: text.button.fontFamily },
  textSm: { fontSize: text.buttonSm.fontSize, fontFamily: text.buttonSm.fontFamily },
  textXs: { fontSize: text.buttonXs.fontSize, fontFamily: text.buttonXs.fontFamily },
});
