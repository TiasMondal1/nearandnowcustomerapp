import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { layout, text } from "../../constants/ui";
import { IconWrap } from "./IconWrap";
import type { IconName } from "./types";

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Leading glyph rendered in an IconWrap (md: 34 r10 icon 18; lg: 44 r12 icon 22). */
  icon?: IconName;
  /** Default C.primary. */
  iconColor?: string;
  /** Default C.primaryXLight. */
  iconBg?: string;
  /** Custom leading node (avatar, thumbnail). Replaces `icon`. */
  left?: React.ReactNode;
  /** Trailing 13px C.textSub text. Suppresses the chevron. */
  value?: string;
  /** Trailing custom node (Badge, Switch, …). Suppresses the chevron. */
  right?: React.ReactNode;
  /** When omitted the row renders as a plain View (not a button). */
  onPress?: () => void;
  /** borderBottom 1 C.border — pass `divider={!isLast}`. */
  divider?: boolean;
  /** "md" (default) = ph14 pv13 gap12, title 14/700, subtitle 12; "lg" = ph16 pv16 gap14, title 15/700, subtitle 13 (ProfileMenu). */
  size?: "md" | "lg";
  disabled?: boolean;
  /** Default 0.75 (support). ProfileMenu uses 0.7. */
  activeOpacity?: number;
  /** numberOfLines for the title. Default unlimited. */
  titleLines?: number;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

/** Row: [icon] title/subtitle … value | right | chevron-right (chevron only when pressable and no trailing content). */
export function ListRow({
  title,
  subtitle,
  icon,
  iconColor = C.primary,
  iconBg = C.primaryXLight,
  left,
  value,
  right,
  onPress,
  divider = false,
  size = "md",
  disabled = false,
  activeOpacity = 0.75,
  titleLines,
  titleStyle,
  subtitleStyle,
  valueStyle,
  style,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const lg = size === "lg";
  const showChevron = !!onPress && right === undefined && value === undefined;

  const content = (
    <>
      {left !== undefined ? (
        left
      ) : icon ? (
        <IconWrap size={lg ? 44 : 34} bg={iconBg} icon={icon} iconSize={lg ? 22 : 18} iconColor={iconColor} />
      ) : null}
      <View style={styles.textCol}>
        <Text style={[lg ? styles.titleLg : styles.title, titleStyle]} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? <Text style={[lg ? styles.subtitleLg : styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
      </View>
      {value !== undefined ? <Text style={[styles.value, valueStyle]}>{value}</Text> : null}
      {right}
      {showChevron ? <MaterialCommunityIcons name="chevron-right" size={lg ? 20 : 18} color={C.textLight} /> : null}
    </>
  );

  const rowStyle = [styles.row, lg ? styles.rowLg : styles.rowMd, divider && styles.divider, style];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      activeOpacity={activeOpacity}
      disabled={disabled}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowMd: { paddingHorizontal: layout.rowPaddingX, paddingVertical: layout.rowPaddingY, gap: layout.rowGap },
  rowLg: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: C.border },
  textCol: { flex: 1 },
  title: { ...text.rowTitle },
  titleLg: { color: C.text, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  subtitle: { ...text.rowSubtitle, marginTop: 1 },
  subtitleLg: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 13, marginTop: 2 },
  value: { ...text.rowValue },
});
