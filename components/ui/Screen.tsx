import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type SafeAreaViewProps } from "react-native-safe-area-context";

import { C } from "../../constants/colors";

export type ScreenProps = {
  children?: React.ReactNode;
  /** Safe-area edges to pad. Omit for all edges; pass `["top"]` on screens with a bottom dock / tab bar. */
  edges?: SafeAreaViewProps["edges"];
  /** Background color. Default `C.bg`. T-palette screens pass T.white / T.cream. */
  bg?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** `SafeAreaView` (react-native-safe-area-context) with `flex: 1, backgroundColor: C.bg`. */
export function Screen({ children, edges, bg = C.bg, style, testID }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor: bg }, style]} testID={testID}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
});
