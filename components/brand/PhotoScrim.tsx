import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { surface } from "../../constants/ui";
import { BrandPhoto } from "./BrandPhoto";
import { hasPhoto, type PhotoSlot } from "./photos";

export type PhotoScrimProps = {
  slot: PhotoSlot;
  /**
   * Where the solid scrim sits, which is where text may go. "left": the left 55 % of the width.
   * "bottom": the bottom 45 % of the height. Default "left".
   */
  side?: "left" | "bottom";
  /** expo-image priority. Default "low". */
  priority?: "high" | "normal" | "low";
  /** Laid out over the scrim. Must stay inside the solid zone and use C.onPrimary for text. */
  children?: React.ReactNode;
  /** Size, margins and child layout. Built in: surface.photo (radius 16, hairline, C.bgSoft ground, overflow hidden). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// White text over C.photoScrim measures 5.5:1 even when the pixel under it is pure white.
const COLORS = [C.photoScrim, C.photoScrim, C.photoScrimClear] as const;
const LEFT = { locations: [0, 0.55, 0.95], start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } as const;
const BOTTOM = { locations: [0, 0.45, 0.9], start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } } as const;

/**
 * The only way text sits on a photo: a bundled photo, a cocoa scrim that is solid under the text
 * zone and clear at the far side, then the children. Returns null when the slot is unfilled. Static:
 * no animation beyond the photo's own fade-in, no shadow.
 */
export function PhotoScrim({ slot, side = "left", priority = "low", children, style, testID }: PhotoScrimProps) {
  if (!hasPhoto(slot)) return null;
  const g = side === "bottom" ? BOTTOM : LEFT;
  return (
    <View style={[styles.root, style]} testID={testID}>
      <BrandPhoto slot={slot} shape="fill" priority={priority} />
      <LinearGradient
        colors={COLORS}
        locations={g.locations}
        start={g.start}
        end={g.end}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...surface.photo },
});
