import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { iconSize as iconSizes, layout, text as typo } from "../../constants/ui";
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
  /** Tab-root style: icon inside an 80px circle, bg C.primaryXLight, border 1.5 C.primaryLight. Default false. */
  iconWrap?: boolean;
  /** Extra content rendered under the text / action. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

/** Centered column: 56px C.textLight glyph, 16/800 title, 14 body, optional sm CTA. gap 10, padding 32, marginTop 80. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  fill = false,
  iconSize,
  iconColor,
  iconWrap = false,
  children,
  style,
  titleStyle,
  textStyle,
  testID,
}: EmptyStateProps) {
  const glyphSize = iconSize ?? (iconWrap ? 40 : iconSizes.heroLg);
  const glyphColor = iconColor ?? (iconWrap ? C.primary : C.textLight);
  const glyph = <MaterialCommunityIcons name={icon} size={glyphSize} color={glyphColor} />;

  return (
    <View style={[styles.base, fill ? styles.fill : styles.top, style]} testID={testID}>
      {iconWrap ? (
        <IconWrap size={80} circle bg={C.primaryXLight} style={styles.iconWrapBorder}>
          {glyph}
        </IconWrap>
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
  iconWrapBorder: { borderWidth: 1.5, borderColor: C.primaryLight },
  title: { ...typo.emptyTitle },
  text: { ...typo.emptyText },
  action: { marginTop: 8 },
});
