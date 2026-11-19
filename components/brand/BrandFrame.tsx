import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { border } from "../../constants/ui";
import { doorwayRadii, sproutOnFrame } from "./shape";
import { Sprout } from "./Sprout";

export type BrandFrameProps = {
  /** Frame width in dp. Default 80. */
  size?: number;
  /** height / width. Default 1. */
  ratio?: number;
  /**
   * Draw the sprout above the top-left corner. The frame adds the sprout's overhang as top padding
   * (25 dp at size 80), so it is never clipped and layout accounts for it. Default false.
   */
  sprout?: boolean;
  /** Fill. Default C.primaryXLight. */
  bg?: string;
  /** 1.5 px border colour. Default C.primaryLight. */
  borderColor?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The doorway tile behind a glyph: the logo's n silhouette, 80 x 80 by default. No shadow. */
export function BrandFrame({
  size = 80,
  ratio = 1,
  sprout = false,
  bg = C.primaryXLight,
  borderColor = C.primaryLight,
  children,
  style,
  testID,
}: BrandFrameProps) {
  const leaf = sprout ? sproutOnFrame(size) : null;
  return (
    <View style={[styles.outer, leaf ? { paddingTop: leaf.overhang } : null, style]} testID={testID}>
      <View style={{ width: size }}>
        <View
          style={[
            styles.frame,
            doorwayRadii(size),
            { width: size, height: Math.round(size * ratio), backgroundColor: bg, borderColor },
          ]}
        >
          {children}
        </View>
        {leaf ? <Sprout width={leaf.width} style={[styles.sprout, { left: leaf.left, top: leaf.top }]} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { alignItems: "center" },
  frame: { alignItems: "center", justifyContent: "center", borderWidth: border.input },
  sprout: { position: "absolute" },
});
