import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityState,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, layout, motion, text } from "../../constants/ui";
import { IconWrap } from "./IconWrap";
import { usePressScale } from "./motion/PressableScale";
import type { IconName } from "./types";

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Leading glyph rendered in an IconWrap (md: 34 r10 icon 18; lg: 44 r12 icon 22). */
  icon?: IconName;
  /** Default C.primary. */
  iconColor?: string;
  /** Default C.primaryXLight. Pass "transparent" for a bare (Uber-style) glyph. */
  iconBg?: string;
  /** Custom leading node (avatar, thumbnail). Replaces `icon`. */
  left?: React.ReactNode;
  /** Trailing 13px C.textSub text. Suppresses the chevron. */
  value?: string;
  /** Trailing custom node (Badge, Switch, …). Suppresses the chevron. Pass `null` for no trailing content and no chevron. */
  right?: React.ReactNode;
  /** When omitted the row renders as a plain View (not a button). */
  onPress?: () => void;
  /** borderBottom 1 C.border — pass `divider={!isLast}`. Drawn OUTSIDE the scaled view so the hairline never shrinks on press. */
  divider?: boolean;
  /** "md" (default) = ph14 pv13 gap12, title 14/700, subtitle 12; "lg" = ph16 pv16 gap14, title 15/700, subtitle 13 (ProfileMenu). */
  size?: "md" | "lg";
  disabled?: boolean;
  /** numberOfLines for the title. Default unlimited. */
  titleLines?: number;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
  /** Applied to the row itself (the Pressable when pressable), e.g. a wider horizontal padding. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Merged over `{ disabled }` — pass `{ expanded }` for expander rows, `{ selected }` for pickers (W3 R3-15). */
  accessibilityState?: AccessibilityState;
  testID?: string;
};

/** Row: [icon] title/subtitle … value | right | chevron-right (chevron only when pressable and no trailing content).
 *  Pressable rows give tactile feedback: an instant C.bgSoft highlight plus a
 *  quick 0.98 scale-down that springs back on release. No haptic — a row press is navigation. */
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
  titleLines,
  titleStyle,
  subtitleStyle,
  valueStyle,
  style,
  accessibilityLabel,
  accessibilityState,
  testID,
}: ListRowProps) {
  const lg = size === "lg";
  const showChevron = !!onPress && right === undefined && value === undefined;

  // 0.98 in / spring back out (motion.spring.press) on the UI thread; scale 1 under reduced motion.
  const { animatedStyle, onPressIn, onPressOut } = usePressScale({ scale: motion.scale.row });

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

  const rowStyle = [styles.row, lg ? styles.rowLg : styles.rowMd, style];

  if (!onPress) {
    return (
      <View style={[rowStyle, divider && styles.divider]} testID={testID} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  // Divider on the outer, unscaled View (the owner's known nit: it used to shrink with the row).
  return (
    <View style={divider ? styles.divider : undefined}>
      <Animated.View style={animatedStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ ...accessibilityState, disabled }}
          disabled={disabled}
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
          testID={testID}
        >
          {content}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowMd: { paddingHorizontal: layout.rowPaddingX, paddingVertical: layout.rowPaddingY, gap: layout.rowGap },
  rowLg: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: C.border },
  pressed: { backgroundColor: C.bgSoft },
  textCol: { flex: 1 },
  title: { ...text.rowTitle },
  titleLg: { color: C.text, fontSize: 15, fontFamily: fontFamily.bold },
  subtitle: { ...text.rowSubtitle, marginTop: 1 },
  subtitleLg: { fontFamily: fontFamily.regular, color: C.textSub, fontSize: 13, marginTop: 2 },
  value: { ...text.rowValue },
});
