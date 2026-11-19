import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { iconSize as iconSizes, layout, text as typo } from "../../constants/ui";
// By file, not through the brand barrel: components/ErrorBoundary.tsx reaches EmptyState by file and the crash
// path must stay light (the barrel would pull in expo-image through BrandPhoto).
import { BrandFrame } from "../brand/BrandFrame";
import { IconWrap } from "./IconWrap";
import { PrimaryButton, type PrimaryButtonSize, type PrimaryButtonVariant } from "./PrimaryButton";
import type { IconName } from "./types";

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Default "primary". */
  variant?: PrimaryButtonVariant;
  /** Default "sm". */
  size?: PrimaryButtonSize;
  loading?: boolean;
  disabled?: boolean;
};

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  /** Body copy: C.textSub 14, centered, lineHeight 20. */
  text?: string;
  /** Renders a `PrimaryButton size="sm"` (marginTop 8). */
  action?: EmptyStateAction;
  /** `flex: 1` + vertically centered instead of marginTop 80 (cart empty, full-screen errors). */
  fill?: boolean;
  /** Default 56 (40 when `iconWrap`). Error states use 48. */
  iconSize?: number;
  /** Default C.textLight (C.primary when `iconWrap`). */
  iconColor?: string;
  /** Tab-root style: icon inside the 80px brand doorway tile, bg C.primaryXLight, border 1.5 C.primaryLight. Default false. */
  iconWrap?: boolean;
  /** Sprout above the doorway tile. For resting or positive states only. Default false. Ignored for tone="error" and for bare (non-wrapped) glyphs. */
  sprout?: boolean;
  /** Replaces the icon or tile (a BrandPhoto or BrandLogo). Default none. Ignored for tone="error". */
  media?: React.ReactNode;
  /** 'error' = the one error treatment everywhere: an 80px circle on C.dangerLight with a C.danger glyph (W3 R3-14). Default 'default'. */
  tone?: "default" | "error";
  /** Extra content rendered under the text / action. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * Centered column: 56px C.textLight glyph (or the doorway tile with `iconWrap`, the red circle with `tone="error"`,
 * or `media`), 16/800 title, 14 body, optional sm CTA. gap 10, padding 32, marginTop 80.
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  fill = false,
  iconSize,
  iconColor,
  iconWrap = false,
  sprout = false,
  media,
  tone = "default",
  children,
  style,
  titleStyle,
  textStyle,
  testID,
}: EmptyStateProps) {
  const error = tone === "error";
  const wrapped = iconWrap || error;
  const glyphSize = iconSize ?? (wrapped ? 40 : iconSizes.heroLg);
  const glyphColor = iconColor ?? (error ? C.danger : wrapped ? C.primary : C.textLight);
  const glyph = <MaterialCommunityIcons name={icon} size={glyphSize} color={glyphColor} />;

  return (
    <View style={[styles.base, fill ? styles.fill : styles.top, style]} testID={testID}>
      {error ? (
        <IconWrap size={80} circle bg={C.dangerLight} style={styles.iconWrapBorderError}>
          {glyph}
        </IconWrap>
      ) : media != null ? (
        media
      ) : wrapped ? (
        <BrandFrame size={80} sprout={sprout}>
          {glyph}
        </BrandFrame>
      ) : (
        glyph
      )}
      <Text style={[styles.title, titleStyle]}>{title}</Text>
      {text ? <Text style={[styles.text, textStyle]}>{text}</Text> : null}
      {action ? (
        <PrimaryButton
          size={action.size ?? "sm"}
          variant={action.variant}
          label={action.label}
          onPress={action.onPress}
          icon={action.icon}
          loading={action.loading}
          disabled={action.disabled}
          style={styles.action}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", gap: 10, padding: layout.emptyPadding },
  top: { marginTop: layout.emptyTop },
  fill: { flex: 1, justifyContent: "center" },
  iconWrapBorderError: { borderWidth: 1.5, borderColor: C.dangerBorder },
  title: { ...typo.emptyTitle },
  text: { ...typo.emptyText },
  action: { marginTop: 8 },
});
