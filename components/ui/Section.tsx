import React from "react";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { layout } from "../../constants/ui";
import { Card, type CardProps } from "./Card";
import { SectionLabel } from "./SectionLabel";

export type SectionProps = {
  title: string;
  children: React.ReactNode;
  /** Card size. Default "md" (radius 14). */
  size?: CardProps["size"];
  /** Card shadow preset. Default none. */
  shadow?: CardProps["shadow"];
  /** Card padding. Default false (rows manage their own padding). */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/** `SectionLabel` + unpadded `Card`, marginBottom 20 — support.tsx's local `Section`. */
export function Section({ title, children, size, shadow, padded = false, style, labelStyle, cardStyle, testID }: SectionProps) {
  return (
    <View style={[styles.section, style]} testID={testID}>
      <SectionLabel style={labelStyle}>{title}</SectionLabel>
      <Card size={size} shadow={shadow} padded={padded} style={cardStyle}>
        {children}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: layout.sectionGap },
});
