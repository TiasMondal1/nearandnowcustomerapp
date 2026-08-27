import type { Href } from "expo-router";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { header, text } from "../../constants/ui";
import { BackButton, type BackButtonProps } from "./IconButton";

export type ScreenHeaderProps = {
  title: string;
  /** 12/600 C.textSub under the title (list screens: "3 orders", "2 unread"). */
  subtitle?: string;
  /** Override back navigation. Default: `router.canGoBack() ? router.back() : router.replace(backFallbackHref)`. */
  onBack?: () => void;
  /** Fallback route when there is no history. Default "/(tabs)/home". */
  backFallbackHref?: Href;
  /** Extra props for the default BackButton (`iconSize: 20`, `bordered`, `size: 40`…). Ignored when `left` is given. */
  backProps?: Omit<BackButtonProps, "onPress" | "fallbackHref">;
  /** Replaces the BackButton. Pass `null` to render no left control (a 38px spacer is kept when centered). */
  left?: React.ReactNode;
  /** Trailing slot. When omitted and `align="center"`, a 38px spacer keeps the title centered. */
  right?: React.ReactNode;
  /** "center" (default, md only) = title centered between back button and right slot/spacer; "left" = title flush after the back button with a 12px gap. */
  align?: "center" | "left";
  /** "md" (default) = ph16 pv14, title 18/800. "lg" = list-screen header: ph12 pt16 pb14 gap10, circle back button, title 20/900, left aligned, no spacer. */
  size?: "md" | "lg";
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** C.card bar with 1px C.border bottom: BackButton · title · right slot. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backFallbackHref,
  backProps,
  left,
  right,
  align = "center",
  size = "md",
  titleStyle,
  subtitleStyle,
  style,
  testID,
}: ScreenHeaderProps) {
  const isLg = size === "lg";
  const centered = !isLg && align === "center";

  let leftNode: React.ReactNode;
  if (left !== undefined) {
    leftNode = left === null && centered ? <View style={styles.spacer} /> : left;
  } else {
    leftNode = (
      <BackButton
        {...backProps}
        shape={backProps?.shape ?? (isLg ? "circle" : "rounded")}
        onPress={onBack}
        fallbackHref={backFallbackHref}
      />
    );
  }

  const rightNode = right !== undefined && right !== null ? right : centered ? <View style={styles.spacer} /> : null;

  return (
    <View
      style={[styles.row, isLg ? styles.rowLg : styles.rowMd, !isLg && !centered && styles.rowLeft, style]}
      testID={testID}
    >
      {leftNode}
      <View style={styles.titleWrap}>
        <Text
          style={[isLg ? styles.titleLg : styles.title, centered && styles.centerText, titleStyle]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, centered && styles.centerText, subtitleStyle]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightNode}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderBottomWidth: header.borderWidth,
    borderBottomColor: C.border,
  },
  rowMd: {
    justifyContent: "space-between",
    paddingHorizontal: header.paddingX,
    paddingVertical: header.paddingY,
  },
  rowLeft: { gap: 12 },
  rowLg: {
    gap: header.lg.gap,
    paddingHorizontal: header.lg.paddingX,
    paddingTop: header.lg.paddingTop,
    paddingBottom: header.lg.paddingBottom,
  },
  titleWrap: { flex: 1 },
  title: { ...text.screenTitle },
  titleLg: { ...text.screenTitleLg },
  subtitle: { ...text.screenSubtitle },
  centerText: { textAlign: "center" },
  spacer: { width: header.iconButton },
});
