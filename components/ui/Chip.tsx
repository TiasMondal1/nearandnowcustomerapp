import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius } from "../../constants/ui";
import type { HapticKind } from "../../lib/feedback";
import { PressableScale } from "./motion/PressableScale";
import { dur, useMotionReduced } from "./motion/presets";
import type { IconName } from "./types";

// Vertical slop lifts the 32 / 28 px pill to 44 pt; horizontal stays 0 because chips sit 8 px apart in rails
// and overlapping slop would steal taps from the neighbour.
const CHIP_HIT_SLOP_MD = { top: 6, bottom: 6, left: 0, right: 0 } as const;
const CHIP_HIT_SLOP_SM = { top: 8, bottom: 8, left: 0, right: 0 } as const;
const THUMB = 24;

export type ChipProps = {
  label: string;
  /** Fills C.primary with a C.onPrimary label (owner's "pills fill solid"); crossfades over `motion.duration.fast`. */
  selected?: boolean;
  onPress?: () => void;
  /** Leading glyph (16 md / 14 sm) in the label colour. Ignored when `thumbUri` is set. */
  icon?: IconName;
  /** 24 px round `expo-image` thumb (category chips); the pill's left padding shrinks to 4 to seat it. */
  thumbUri?: string;
  /** md (default): minHeight 32, ph14, 13/600 · sm: minHeight 28, ph12, 12/600. */
  size?: "sm" | "md";
  /** Static `opacity.disabled`-free dim (0.5) + presses ignored. */
  disabled?: boolean;
  /**
   * Haptic fired before `onPress`. Default 'select' — a chip press changes a selection, the one place a default
   * haptic is right (CONTRACTS §8). Tip chips pass 'toggle'; pass `false` for chips that only navigate.
   */
  haptic?: HapticKind | false;
  /** Outer (scaled) wrapper: margins, flex. */
  style?: StyleProp<ViewStyle>;
  /** Default: the label. */
  accessibilityLabel?: string;
  /**
   * 'button' (default) · 'tab' inside a `tablist` strip (category / sort / filter chips) · 'radio' inside a
   * `radiogroup` (address label pickers; also sets `accessibilityState.checked`). W3 R3-07.
   */
  accessibilityRole?: "button" | "tab" | "radio";
  testID?: string;
};

/**
 * Pill chip: idle C.card + 1px C.border + C.text; selected C.primary + C.onPrimary (`interpolateColor`, UI thread);
 * pressed-while-idle C.bgSoft; `PressableScale` scale 0.94 (`motion.scale.chip`); `accessibilityState.selected`.
 */
function ChipBase({
  label,
  selected = false,
  onPress,
  icon,
  thumbUri,
  size = "md",
  disabled = false,
  haptic = "select",
  style,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
}: ChipProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const sm = size === "sm";
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    const target = selected ? 1 : 0;
    sel.set(reduced ? target : withTiming(target, { duration: dur(motion.duration.fast) }));
  }, [selected, reduced, sel]);

  const faceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.get(), [0, 1], [C.card, C.primary]),
    borderColor: interpolateColor(sel.get(), [0, 1], [C.border, C.primary]),
  }));
  const labelColorStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.get(), [0, 1], [C.text, C.onPrimary]),
  }));

  return (
    <PressableScale
      scale={motion.scale.chip}
      haptic={haptic}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityRole === "radio" ? { selected, checked: selected, disabled } : { selected, disabled }}
      hitSlop={sm ? CHIP_HIT_SLOP_SM : CHIP_HIT_SLOP_MD}
      disabled={disabled}
      onPress={onPress}
      style={style}
      testID={testID}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.face,
            sm ? styles.faceSm : styles.faceMd,
            thumbUri ? styles.faceWithThumb : null,
            disabled && styles.disabled,
            faceStyle,
          ]}
        >
          {/* Pressed highlight is a static overlay so it never fights the animated background on the same view. */}
          {pressed && !selected && !disabled ? <View pointerEvents="none" style={styles.pressedOverlay} /> : null}
          {thumbUri ? (
            <Image
              source={{ uri: thumbUri }}
              style={styles.thumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={motion.imageFade}
              accessibilityIgnoresInvertColors
            />
          ) : icon ? (
            <MaterialCommunityIcons name={icon} size={sm ? 14 : 16} color={selected ? C.onPrimary : C.text} />
          ) : null}
          <Animated.Text
            style={[sm ? styles.labelSm : styles.labelMd, labelColorStyle]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Animated.Text>
        </Animated.View>
      )}
    </PressableScale>
  );
}

/** Memoised — chips render inside horizontal rails; the parent must pass stable `onPress` handlers. */
export const Chip = React.memo(ChipBase);
Chip.displayName = "Chip";

const styles = StyleSheet.create({
  face: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    gap: 6,
  },
  faceMd: { minHeight: 32, paddingHorizontal: 14 },
  faceSm: { minHeight: 28, paddingHorizontal: 12 },
  faceWithThumb: { paddingLeft: 4 },
  disabled: { opacity: 0.5 },
  pressedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bgSoft, borderRadius: radius.pill },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: C.bgSoft },
  labelMd: { fontFamily: fontFamily.semibold, fontSize: 13 },
  labelSm: { fontFamily: fontFamily.semibold, fontSize: 12 },
});
