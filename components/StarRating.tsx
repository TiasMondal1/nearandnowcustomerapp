import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../constants/colors";
import { text } from "../constants/ui";
import type { IconName } from "./ui";

export type StarRatingProps = {
  /** 0..5, fractional allowed; snapped to the nearest half star for display. */
  rating: number;
  /** When > 0, "(N)" is drawn after the stars (12/600 C.textSub). */
  reviewCount?: number;
  /** Glyph size. Default 13. */
  starSize?: number;
};

const STAR_INDICES = [1, 2, 3, 4, 5] as const;

function starIcon(snapped: number, i: number): IconName {
  if (snapped >= i) return "star";
  if (snapped >= i - 0.5) return "star-half-full";
  return "star-outline";
}

/**
 * Read-only star row (display only — the interactive picker is components/orders/StarPicker.tsx).
 * Memoised because it sits inside product grids, rails and search rows (speed-and-ease #13).
 */
const StarRating = React.memo(function StarRating({ rating, reviewCount, starSize = 13 }: StarRatingProps) {
  const safeRating = Number.isFinite(rating) ? rating : 0;
  // Snap to the nearest half star for a clean compact display.
  const snapped = Math.round(Math.max(0, Math.min(5, safeRating)) * 2) / 2;
  const showCount = typeof reviewCount === "number" && reviewCount > 0;

  const accessibilityLabel = `Rated ${snapped} out of 5${showCount ? `, ${reviewCount} reviews` : ""}`;

  return (
    <View style={styles.wrap} accessible accessibilityLabel={accessibilityLabel}>
      <View style={styles.starsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {STAR_INDICES.map((i) => {
          const name = starIcon(snapped, i);
          return (
            <MaterialCommunityIcons
              key={i}
              name={name}
              size={starSize}
              color={name === "star-outline" ? C.textLight : C.warning}
            />
          );
        })}
      </View>
      {showCount ? (
        <Text style={styles.reviewText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          ({reviewCount})
        </Text>
      ) : null}
    </View>
  );
});

export default StarRating;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  starsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  reviewText: { ...text.label },
});
