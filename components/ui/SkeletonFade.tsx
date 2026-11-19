import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { exit } from "./motion/presets";

export type SkeletonFadeProps = {
  /** true: only `skeleton` is mounted. false: `children` mount and the skeleton fades out over them (220 ms). */
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  /** Ground behind the fading skeleton. Default C.bg. Pass C.card on white screens. */
  bg?: string;
  /** Outer box. Default { flex: 1 }. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Cross-fade from a skeleton to content. The skeleton layer comes after the content in the tree, so it
 * draws on top and the content appears under it as it fades. No entering animation. Under reduced
 * motion the exit is instant (MotionConfig). Not for recycled list cells.
 */
export function SkeletonFade({ loading, skeleton, children, bg = C.bg, style, testID }: SkeletonFadeProps) {
  return (
    <View style={style ?? styles.root} testID={testID}>
      {loading ? null : children}
      {loading ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} exiting={exit.soft()}>
          {skeleton}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
