import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { PressableScale } from "../ui";

export type SectionHeaderProps = {
  /** text.h3 (17/22), one line, accessibilityRole "header". */
  title: string;
  /** 3 x 18 bar left of the title, e.g. C.primary. Default none. */
  accent?: string;
  /** Trailing pill label, e.g. "See all". No pill when omitted or when onAction is missing. */
  actionLabel?: string;
  onAction?: () => void;
  /** Screen-reader label for the pill. Default `${actionLabel} ${title}`. */
  actionAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PILL_HIT_SLOP = { top: 10, bottom: 10, left: 8, right: 8 } as const;

/**
 * The one section header: a 44 dp row (12 above, a 22 dp line, 10 below) at gutter 16, with an
 * optional accent bar and an optional 24 dp action pill. The pill press is silent (navigation).
 */
function SectionHeaderBase({
  title,
  accent,
  actionLabel,
  onAction,
  actionAccessibilityLabel,
  style,
  testID,
}: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
      <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <PressableScale
          onPress={onAction}
          scale={motion.scale.row}
          haptic={false}
          hitSlop={PILL_HIT_SLOP}
          style={styles.pillOuter}
          innerStyle={styles.pill}
          pressedStyle={styles.pillPressed}
          accessibilityLabel={actionAccessibilityLabel ?? `${actionLabel} ${title}`}
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={styles.pillLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {actionLabel}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={14} color={C.primaryDark} />
        </PressableScale>
      ) : null}
    </View>
  );
}

export const SectionHeader = React.memo(SectionHeaderBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: layout.sectionHeaderHeight,
    paddingHorizontal: layout.gutter,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  accent: { width: 3, height: 18, borderRadius: radius.xs },
  title: { ...text.h3, flex: 1 },
  // The pill is 24 dp on a 22 dp line; the 1 dp negative margins keep the row at 44.
  pillOuter: { marginVertical: -1 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 24,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: C.primaryXLight,
  },
  pillPressed: { backgroundColor: C.primaryLight },
  pillLabel: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.primaryDark },
});
