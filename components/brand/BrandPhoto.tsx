import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { border, motion, radius } from "../../constants/ui";
import { PHOTOS, type PhotoSlot } from "./photos";
import { doorwayRadii, sproutOnFrame } from "./shape";
import { Sprout } from "./Sprout";

/** Wide card aspect (width / height). Matches the Home banner card. */
const CARD_ASPECT = 2.25;
/** Doorway frame height / width (5:6 portrait). */
const DOORWAY_RATIO = 1.2;

export type BrandPhotoProps = {
  slot: PhotoSlot;
  /**
   * "doorway": portrait 5:6 frame with doorway corners. "card": fills its parent's width at 2.25:1
   * with radius.card (16). "fill": fills its parent absolutely with no radius, border or ground of its
   * own; the parent clips (PhotoScrim, the banner photo panel). Default "doorway".
   */
  shape?: "doorway" | "card" | "fill";
  /** Doorway only: frame width in dp; height = round(width x 1.2). Default 112 (height 134). */
  width?: number;
  /** Doorway only: sprout above the top-left corner (same geometry as BrandFrame; overhang 35 dp at 112). Default false. */
  sprout?: boolean;
  /** expo-image priority. Default "low". */
  priority?: "high" | "normal" | "low";
  /** Outer box. Ignored for "fill" except as extra style on the absolute layer. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The only way a bundled photo is drawn. Returns null when the slot is unfilled, so call sites
 * keep their non-photo fallback. Decorative, no shadow. Text may sit on a photo only through
 * PhotoScrim. The photo fades in over 220 ms (motion.photoFade).
 */
export function BrandPhoto({
  slot,
  shape = "doorway",
  width = 112,
  sprout = false,
  priority = "low",
  style,
  testID,
}: BrandPhotoProps) {
  const photo = PHOTOS[slot];
  if (!photo) return null;

  const image = (
    <Image
      source={photo.source}
      // A recycled list cell (two Home promo cards share one pool) drops the previous photo at once instead of
      // showing it under the new copy while the next one fades in.
      recyclingKey={slot}
      contentFit="cover"
      transition={motion.photoFade}
      cachePolicy="memory"
      priority={priority}
      accessible={false}
      style={styles.image}
    />
  );

  if (shape === "fill") {
    return (
      <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none" testID={testID}>
        {image}
      </View>
    );
  }

  if (shape === "card") {
    return (
      <View style={[styles.clip, styles.card, style]} testID={testID}>
        {image}
      </View>
    );
  }

  const leaf = sprout ? sproutOnFrame(width) : null;
  return (
    <View style={[styles.outer, leaf ? { paddingTop: leaf.overhang } : null, style]} testID={testID}>
      <View style={{ width }}>
        <View style={[styles.clip, doorwayRadii(width), { width, height: Math.round(width * DOORWAY_RATIO) }]}>
          {image}
        </View>
        {leaf ? <Sprout width={leaf.width} style={[styles.sprout, { left: leaf.left, top: leaf.top }]} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { alignItems: "center" },
  clip: {
    overflow: "hidden",
    backgroundColor: C.bgSoft,
    borderWidth: border.thin,
    borderColor: C.hairline,
  },
  card: { width: "100%", aspectRatio: CARD_ASPECT, borderRadius: radius.card },
  image: { width: "100%", height: "100%" },
  sprout: { position: "absolute" },
});
