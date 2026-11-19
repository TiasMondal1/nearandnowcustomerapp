import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { PhotoScrim, hasPhoto, type PhotoSlot } from "../brand";
import { PressableScale } from "../ui";

export type PhotoCardProps = {
  slot: PhotoSlot;
  /** text.h3 (17/22) in C.onPrimary, 2 lines; shrinks to fit the column (floor 0.8). */
  title: string;
  /** 12/16 medium in C.onPrimary, 2 lines; shrinks to fit the column (floor 0.85). */
  subtitle?: string;
  /** White pill label (height 28). Drawn only when onPress is set. */
  cta?: string;
  /** Omitted: a plain view, not a button. */
  onPress?: () => void;
  /** Minimum height in dp. Default layout.photoCardMinHeight (156). */
  height?: number;
  /** expo-image priority. Default "low". */
  priority?: "high" | "normal" | "low";
  /** Outer margins. Width is 100 % of the parent. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Floors for the two-line title's and subtitle's shrink-to-fit inside the 55 % column. */
const TITLE_MIN_FONT_SCALE = 0.8;
const SUBTITLE_MIN_FONT_SCALE = 0.85;

/**
 * A wide photo card: the photo fills the card and the text sits in the left 55 %, on the solid part of
 * the scrim. All text is C.onPrimary. Returns null when the slot is unfilled. The press is silent.
 */
function PhotoCardBase({
  slot,
  title,
  subtitle,
  cta,
  onPress,
  height = layout.photoCardMinHeight,
  priority = "low",
  style,
  testID,
}: PhotoCardProps) {
  if (!hasPhoto(slot)) return null;
  const label = subtitle ? `${title}. ${subtitle}` : title;

  const copy = (
    <View style={styles.copy}>
      <Text
        style={styles.title}
        numberOfLines={2}
        maxFontSizeMultiplier={1.2}
        // The column is narrow (55 % of the card): shrink a little before a third line would cut the last word.
        adjustsFontSizeToFit
        minimumFontScale={TITLE_MIN_FONT_SCALE}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={styles.subtitle}
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}
          adjustsFontSizeToFit
          minimumFontScale={SUBTITLE_MIN_FONT_SCALE}
        >
          {subtitle}
        </Text>
      ) : null}
      {cta && onPress ? (
        <View style={styles.cta}>
          <Text style={styles.ctaLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {cta}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={14} color={C.primaryDark} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View style={style} accessible accessibilityLabel={label} testID={testID}>
        <PhotoScrim slot={slot} side="left" priority={priority} style={[styles.scrim, { minHeight: height }]}>
          {copy}
        </PhotoScrim>
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      scale={motion.scale.card}
      haptic={false}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <PhotoScrim slot={slot} side="left" priority={priority} style={[styles.scrim, { minHeight: height }]}>
        {copy}
      </PhotoScrim>
    </PressableScale>
  );
}

export const PhotoCard = React.memo(PhotoCardBase);

const styles = StyleSheet.create({
  scrim: { justifyContent: "center" },
  // The solid scrim covers the left 55 %; the column never leaves it.
  copy: { width: "55%", paddingLeft: 16, paddingRight: 8, paddingVertical: 16, gap: 4 },
  title: { ...text.h3, color: C.onPrimary },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.onPrimary },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    // With flexShrink on the label: a long label ends in "…" inside the pill instead of spilling onto the photo.
    maxWidth: "100%",
    marginTop: 8,
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: C.card,
  },
  ctaLabel: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.primaryDark, flexShrink: 1 },
});
