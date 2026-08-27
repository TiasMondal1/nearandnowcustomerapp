import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { layout, shadow } from "../../constants/ui";

export type BottomDockProps = {
  children: React.ReactNode;
  /** Background. Default C.card. */
  bg?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Absolute bottom bar: C.card, ph16 pt14 pb28 (hardcoded — matches every existing dock; not inset-aware
 * on purpose), 1px C.border top, `shadow.dock` (elevation 10). Give the screen's scroll content
 * enough paddingBottom (layout.scrollBottomTab) so the last item clears it.
 */
export function BottomDock({ children, bg, style, testID }: BottomDockProps) {
  return (
    <View style={[styles.dock, bg !== undefined && { backgroundColor: bg }, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    paddingHorizontal: layout.gutter,
    paddingTop: 14,
    paddingBottom: layout.dockBottom,
    borderTopWidth: 1,
    borderTopColor: C.border,
    ...shadow.dock,
  },
});
