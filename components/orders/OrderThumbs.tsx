import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { motion, radius, text } from "../../constants/ui";
import { cdnImage } from "../../lib/imageUrl";
import type { OrderItem } from "../../lib/orderService";

export type OrderThumbsProps = {
  /** Order lines; the first `max` become thumbs (image or a package glyph), the remainder a "+N" counter. */
  items: readonly OrderItem[] | undefined;
  /** Thumb side in px. Default 40 (r8). */
  size?: number;
  /** Thumbs drawn before the "+N" counter. Default 3. */
  max?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Pixels each thumb overlaps the previous one (BP-21: "overlapping −8"). */
const OVERLAP = 8;

function thumbKey(it: OrderItem, i: number): string {
  return `${it.master_product_id ?? it.product_id ?? it.name}-${i}`;
}

/**
 * Up to three overlapping 40 px r8 `C.bgSoft` contain thumbs (`expo-image`, `cdnImage(url, 2 × size)`) plus a
 * "+N" 11/700 counter for the rest. Decorative — hidden from assistive tech; the row label carries the item count.
 */
export function OrderThumbs({ items, size = 40, max = 3, style, testID }: OrderThumbsProps) {
  const list = items ?? [];
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  const glyph = Math.round(size * 0.45);

  return (
    <View
      style={[styles.row, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {shown.length === 0 ? (
        <View style={[styles.thumb, { width: size, height: size }]}>
          <MaterialCommunityIcons name="package-variant" size={glyph} color={C.textLight} />
        </View>
      ) : null}
      {shown.map((it, i) => {
        const uri = cdnImage(it.image, size * 2);
        return (
          <View
            key={thumbKey(it, i)}
            style={[
              styles.thumb,
              { width: size, height: size, marginLeft: i === 0 ? 0 : -OVERLAP, zIndex: shown.length - i },
            ]}
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.img}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={motion.imageFade}
                recyclingKey={thumbKey(it, i)}
                priority="low"
              />
            ) : (
              <MaterialCommunityIcons name="package-variant" size={glyph} color={C.textLight} />
            )}
          </View>
        );
      })}
      {rest > 0 ? (
        <Text style={styles.more} maxFontSizeMultiplier={1.3}>
          +{rest}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  thumb: {
    borderRadius: radius.md,
    backgroundColor: C.bgSoft,
    // A card-coloured ring keeps overlapping thumbs legible against each other.
    borderWidth: 1.5,
    borderColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%" },
  more: { ...text.badgeSm, color: C.textSub, marginLeft: 6 },
});
