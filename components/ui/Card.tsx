import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { clipOverflow, layout, radius, shadow, type ShadowName } from "../../constants/ui";

export type CardProps = {
  children?: React.ReactNode;
  /** "md" (default) = radius 14 / padding 14; "lg" = radius 16 / padding 16. */
  size?: "md" | "lg";
  /** Default true. `false` = padding 0 + overflow clipping (row-list container). */
  padded?: boolean;
  /** Shadow preset name from constants/ui. Default none. */
  shadow?: ShadowName;
  /** Background override. Default C.card. */
  bg?: string;
  /** Border color override. Default C.border. */
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * C.card surface with 1px C.border. Unpadded cards clip their children: with a shadow the
 * clip uses `clipOverflow` (Android-only "hidden", so iOS keeps the shadow), otherwise "hidden".
 */
export function Card({ children, size = "md", padded = true, shadow: shadowName, bg, borderColor, style, testID }: CardProps) {
  const lg = size === "lg";
  return (
    <View
      style={[
        styles.base,
        lg ? styles.lg : styles.md,
        padded ? (lg ? styles.padLg : styles.padMd) : shadowName ? styles.clipGuarded : styles.clip,
        shadowName && shadow[shadowName],
        bg !== undefined && { backgroundColor: bg },
        borderColor !== undefined && { borderColor },
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  md: { borderRadius: radius.xxl },
  lg: { borderRadius: radius.card },
  padMd: { padding: layout.cardPadding },
  padLg: { padding: layout.cardPaddingLg },
  clip: { overflow: "hidden" },
  clipGuarded: { overflow: clipOverflow },
});
