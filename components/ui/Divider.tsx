import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";

export type DividerProps = {
  /** marginVertical. Default 12 (cart divider). Others in use: 4 (bill rows), 10, 14. */
  spacing?: number;
  /** Default C.border. */
  color?: string;
  /** marginHorizontal, to inset the line inside a padded card. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
};

/** 1px C.border rule with vertical margin. */
export function Divider({ spacing = 12, color = C.border, inset, style }: DividerProps) {
  return (
    <View
      style={[
        styles.line,
        { marginVertical: spacing, backgroundColor: color },
        inset !== undefined && { marginHorizontal: inset },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  line: { height: 1, backgroundColor: C.border },
});
