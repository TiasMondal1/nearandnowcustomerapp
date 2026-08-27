import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { radius } from "../../constants/ui";
import type { IconName } from "./types";

export type IconWrapProps = {
  /** Square side. Default 38. Common: 34 (ListRow md), 44 (ListRow lg), 80/84 (hero circles). */
  size?: number;
  /** Default 10 when size ≤ 36, else 12. Ignored when `circle`. */
  radius?: number;
  /** Background. Default C.primaryXLight. */
  bg?: string;
  /** borderRadius = size / 2. */
  circle?: boolean;
  /** Convenience: render this glyph centered instead of passing children. */
  icon?: IconName;
  /** Default 18 (≤36), 20 (≤40), 22 (≤44), else size / 2. */
  iconSize?: number;
  /** Default C.primary. */
  iconColor?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function defaultIconWrapRadius(size: number) {
  return size <= 36 ? radius.lg : radius.xl;
}

export function defaultIconWrapIconSize(size: number) {
  if (size <= 36) return 18;
  if (size <= 40) return 20;
  if (size <= 44) return 22;
  return Math.round(size / 2);
}

/** Centered square (default 38×38 r12 C.primaryXLight) that holds an icon. */
export function IconWrap({
  size = 38,
  radius: radiusProp,
  bg = C.primaryXLight,
  circle = false,
  icon,
  iconSize,
  iconColor = C.primary,
  children,
  style,
  testID,
}: IconWrapProps) {
  const borderRadius = circle ? size / 2 : radiusProp ?? defaultIconWrapRadius(size);
  return (
    <View style={[styles.base, { width: size, height: size, borderRadius, backgroundColor: bg }, style]} testID={testID}>
      {icon ? <MaterialCommunityIcons name={icon} size={iconSize ?? defaultIconWrapIconSize(size)} color={iconColor} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
});
