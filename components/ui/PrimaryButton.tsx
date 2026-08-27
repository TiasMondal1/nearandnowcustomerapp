import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { C } from "../../constants/colors";
import { opacity, radius, shadow, text } from "../../constants/ui";
import type { IconName } from "./types";

export type PrimaryButtonSize = "lg" | "md" | "sm" | "xs";
export type PrimaryButtonVariant = "primary" | "secondary" | "danger" | "warning" | "success";

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
   * lg = r16 pv16 text 16/800 ls0.3 · md (default) = r14 pv15 text 15/800 ·
   * sm = r12 ph24 pv12 text 14/700 · xs = r10 ph16 pv10 gap6 text 13/700 (+primarySm shadow by default).
   */
  size?: PrimaryButtonSize;
  /**
   * primary (default) = C.primary / #fff · secondary = C.bgSoft, 1px C.border, C.text ·
   * danger = C.dangerLight, 1px #fca5a5, C.danger (md: pv14, text 14/800 — support "Escalate") ·
   * warning = C.warning / #fff · success = C.success / #fff.
   */
  variant?: PrimaryButtonVariant;
  /** Colored glow: primaryLg tuple for lg/md, primarySm for sm/xs. Default: true for xs, false otherwise. Never for secondary/danger. */
  shadow?: boolean;
  /** opacity 0.45, presses ignored. */
  disabled?: boolean;
  /** Replaces the label with an ActivityIndicator while keeping the button's size; presses ignored. */
  loading?: boolean;
  /** alignSelf "stretch". Default: true for lg/md, false for sm/xs (then alignSelf is left to the parent). */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Default: the label. */
  accessibilityLabel?: string;
  testID?: string;
};

const VARIANT: Record<
  PrimaryButtonVariant,
  { bg: string; color: string; borderColor?: string; shadowColor?: string }
> = {
  primary: { bg: C.primary, color: "#fff", shadowColor: C.primary },
  secondary: { bg: C.bgSoft, color: C.text, borderColor: C.border },
  danger: { bg: C.dangerLight, color: C.danger, borderColor: "#fca5a5" },
  warning: { bg: C.warning, color: "#fff", shadowColor: C.warning },
  success: { bg: C.success, color: "#fff", shadowColor: C.success },
};

const DEFAULT_ICON_SIZE: Record<PrimaryButtonSize, number> = { lg: 20, md: 20, sm: 18, xs: 14 };

/** Filled CTA. Default: C.primary, r14, pv15, white 15/800 label, activeOpacity 0.8, full width. */
export function PrimaryButton({
  label,
  onPress,
  icon,
  iconRight,
  iconSize,
  size = "md",
  variant = "primary",
  shadow: shadowProp,
  disabled = false,
  loading = false,
  fullWidth,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: PrimaryButtonProps) {
  const v = VARIANT[variant];
  const isCompact = size === "sm" || size === "xs";
  const stretch = fullWidth ?? !isCompact;
  const withShadow = (shadowProp ?? size === "xs") && v.shadowColor !== undefined;
  const shadowStyle = withShadow
    ? { ...(isCompact ? shadow.primarySm : shadow.primaryLg), shadowColor: v.shadowColor }
    : null;
  const dangerMd = variant === "danger" && size === "md";
  const inactive = disabled || loading;
  const glyph = iconSize ?? DEFAULT_ICON_SIZE[size];

  const sizeStyle =
    size === "lg" ? styles.lg : size === "sm" ? styles.sm : size === "xs" ? styles.xs : styles.md;
  const labelStyle =
    size === "lg" ? styles.textLg : size === "sm" ? styles.textSm : size === "xs" ? styles.textXs : styles.textMd;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      activeOpacity={opacity.pressCta}
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.base,
        sizeStyle,
        { backgroundColor: v.bg },
        v.borderColor !== undefined && { borderWidth: 1, borderColor: v.borderColor },
        dangerMd && styles.dangerMd,
        stretch && styles.stretch,
        shadowStyle,
        disabled && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      <View style={[styles.content, size === "xs" ? styles.gapXs : size === "sm" ? styles.gapSm : styles.gapMd, loading && styles.hidden]}>
        {icon ? <MaterialCommunityIcons name={icon} size={glyph} color={v.color} /> : null}
        <Text style={[labelStyle, { color: v.color }, dangerMd && styles.dangerMdText, textStyle]}>{label}</Text>
        {iconRight ? <MaterialCommunityIcons name={iconRight} size={glyph} color={v.color} /> : null}
      </View>
      {loading ? (
        <View style={styles.spinnerWrap} pointerEvents="none">
          <ActivityIndicator size="small" color={v.color} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  gapMd: { gap: 10 },
  gapSm: { gap: 8 },
  gapXs: { gap: 6 },
  stretch: { alignSelf: "stretch" },
  hidden: { opacity: 0 },
  spinnerWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: opacity.disabled },

  lg: { borderRadius: radius.card, paddingVertical: 16, paddingHorizontal: 20 },
  md: { borderRadius: radius.xxl, paddingVertical: 15, paddingHorizontal: 20 },
  sm: { borderRadius: radius.xl, paddingVertical: 12, paddingHorizontal: 24 },
  xs: { borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 16 },

  textLg: { fontSize: text.buttonLg.fontSize, fontFamily: text.buttonLg.fontFamily, letterSpacing: text.buttonLg.letterSpacing },
  textMd: { fontSize: text.button.fontSize, fontFamily: text.button.fontFamily },
  textSm: { fontSize: text.buttonSm.fontSize, fontFamily: text.buttonSm.fontFamily },
  textXs: { fontSize: text.buttonXs.fontSize, fontFamily: text.buttonXs.fontFamily },

  dangerMd: { paddingVertical: 14 },
  dangerMdText: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 14 },
});
