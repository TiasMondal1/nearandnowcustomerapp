import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { layout, text } from "../../constants/ui";

export type SectionLabelProps = {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Uppercase eyebrow: C.textSub 11/700, letterSpacing 0.7, marginBottom 8, paddingHorizontal 2. */
export function SectionLabel({ children, style, numberOfLines }: SectionLabelProps) {
  return (
    <Text style={[styles.label, style]} numberOfLines={numberOfLines} accessibilityRole="header">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { ...text.eyebrow, marginBottom: layout.sectionLabelGap, paddingHorizontal: 2 },
});
