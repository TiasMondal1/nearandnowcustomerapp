import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { radius, text } from "../../constants/ui";
import type { IconName } from "./types";

export type BadgeTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export const BADGE_TONES: Record<BadgeTone, { bg: string; color: string }> = {
  primary: { bg: C.primaryXLight, color: C.primary },
  success: { bg: C.successLight, color: C.success },
  warning: { bg: C.warningLight, color: C.warning },
  danger: { bg: C.dangerLight, color: C.danger },
  info: { bg: C.infoLight, color: C.info },
  neutral: { bg: C.bgSoft, color: C.textSub },
};

export type BadgeProps = {
  label: string;
  /** Color pair. Default "neutral" (C.bgSoft / C.textSub). */
  tone?: BadgeTone;
  /** Explicit background (e.g. `getStatusMeta(status).bg`). Overrides tone. */
  bg?: string;
  /** Explicit text/icon color (e.g. `getStatusMeta(status).color`). Overrides tone. */
  color?: string;
  /** "md" (default) = ph10 pv5 r8 text 12/700; "sm" = ph8 pv3 text 10/800. */
  size?: "md" | "sm";
  /** borderRadius 999. */
  pill?: boolean;
  /** 1px border in the text color (or `borderColor`). */
  bordered?: boolean;
  borderColor?: string;
  /** Leading glyph in the text color. */
  icon?: IconName;
  /** Default 12 (md) / 10 (sm). */
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

/** Status chip: ph10 pv5 r8, 12/700 label, alignSelf flex-start. */
export function Badge({
  label,
  tone = "neutral",
  bg,
  color,
  size = "md",
  pill = false,
  bordered = false,
  borderColor,
  icon,
  iconSize,
  style,
  textStyle,
  testID,
}: BadgeProps) {
  const t = BADGE_TONES[tone];
  const fg = color ?? t.color;
  const sm = size === "sm";
  return (
    <View
      style={[
        styles.base,
        sm ? styles.sm : styles.md,
        { backgroundColor: bg ?? t.bg },
        pill && styles.pill,
        bordered && { borderWidth: 1, borderColor: borderColor ?? fg },
        style,
      ]}
      testID={testID}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={iconSize ?? (sm ? 10 : 12)} color={fg} /> : null}
      <Text style={[sm ? styles.textSm : styles.textMd, { color: fg }, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, borderRadius: radius.md },
  md: { paddingHorizontal: 10, paddingVertical: 5 },
  sm: { paddingHorizontal: 8, paddingVertical: 3 },
  pill: { borderRadius: radius.pill },
  textMd: { ...text.badge },
  textSm: { ...text.badgeSm },
});
