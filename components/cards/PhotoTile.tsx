import React from "react";
import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, motion } from "../../constants/ui";
import { PhotoScrim, hasPhoto, type PhotoSlot } from "../brand";
import { PressableScale } from "../ui";

export type PhotoTileProps = {
  slot: PhotoSlot;
  /** 14/18 bold in C.onPrimary, 2 lines, bottom-left, 10 dp padding. */
  label: string;
  onPress: () => void;
  /** Default layout.aisleTileWidth (136). Height is round(width x 1.25) = 170. */
  width?: number;
  /** Default: the label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A portrait photo tile with its label on the bottom scrim (solid over the bottom 45 %, 76 dp at
 * the default size; two lines plus padding need 46 dp). Returns null when the slot is unfilled.
 * The press is silent.
 */
function PhotoTileBase({
  slot,
  label,
  onPress,
  width = layout.aisleTileWidth,
  accessibilityLabel,
  style,
  testID,
}: PhotoTileProps) {
  if (!hasPhoto(slot)) return null;
  return (
    <PressableScale
      onPress={onPress}
      scale={motion.scale.card}
      haptic={false}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <PhotoScrim slot={slot} side="bottom" style={[styles.scrim, { width, height: Math.round(width * 1.25) }]}>
        <Text style={styles.label} numberOfLines={2} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </PhotoScrim>
    </PressableScale>
  );
}

export const PhotoTile = React.memo(PhotoTileBase);

const styles = StyleSheet.create({
  scrim: { justifyContent: "flex-end" },
  label: { fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 18, color: C.onPrimary, padding: 10 },
});
