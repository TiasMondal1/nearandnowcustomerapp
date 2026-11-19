import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

import { SPROUT } from "./brand";

export type SproutProps = {
  /** Width in dp; height = round(width / 1.7). Default 34. */
  width?: number;
  style?: StyleProp<ImageStyle>;
  testID?: string;
};

/**
 * The logo's green leaves. Always decorative. The colour is baked into the file (leaf green,
 * equal to C.success). Resting and positive moments only: never on errors or buttons.
 */
export function Sprout({ width = 34, style, testID }: SproutProps) {
  const height = Math.round(width / SPROUT.aspect);
  return (
    <Image
      source={SPROUT.source}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityIgnoresInvertColors
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width, height }, style]}
      testID={testID}
    />
  );
}
