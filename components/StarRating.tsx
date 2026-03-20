import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../constants/colors";

type StarRatingProps = {
  rating: number; // 0..5 (can be fractional)
  reviewCount?: number;
  starSize?: number;
};

export default function StarRating({
  rating,
  reviewCount,
  starSize = 13,
}: StarRatingProps) {
  const safeRating = Number.isFinite(rating) ? rating : 0;

  // Snap to nearest half-star for a clean compact display.
  const snapped = useMemo(() => {
    const clamped = Math.max(0, Math.min(5, safeRating));
    return Math.round(clamped * 2) / 2;
  }, [safeRating]);

  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const name =
      snapped >= i
        ? "star"
        : snapped >= i - 0.5
          ? "star-half-full"
          : "star-outline";
    const color =
      name === "star-outline" ? C.textLight : C.warning;

    stars.push(
      <MaterialCommunityIcons
        key={i}
        name={name as any}
        size={starSize}
        color={color}
      />,
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.starsRow}>{stars}</View>
      {typeof reviewCount === "number" && reviewCount > 0 ? (
        <Text style={styles.reviewText}>({reviewCount})</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  starsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  reviewText: {
    color: C.textSub,
    fontSize: 12,
    fontWeight: "600",
  },
});

