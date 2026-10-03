import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, shadow } from "../../constants/ui";
import { feedback } from "../../lib/feedback";
import { spr, useMotionReduced } from "./motion/presets";

/** Track height 36 (BP §2.10). */
const TRACK_HEIGHT = 36;
/** Thumb inset: track r10 − 3 = thumb r8 keeps the corners concentric (CONTRACTS §4.12: track r10, thumb r8). */
const TRACK_PAD = 3;
/** 36 px track → 44 pt target. */
const SEGMENT_HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 } as const;

export type Segment<K extends string = string> = {
  key: K;
  label: string;
  /** Optional count drawn after the label in 12/600 ("Active 2"). */
  count?: number;
};

export type SegmentedControlProps<K extends string = string> = {
  segments: readonly Segment<K>[];
  value: K;
  /** Called only when a DIFFERENT segment is pressed, after `feedback.select()`. */
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * C.bgSoft track r10 h36 with a C.card r8 `shadow.card` thumb that slides `withSpring(motion.spring.press)`
 * (snaps under reduced motion and on the first layout). Labels 13/600 C.textSub, selected 13/700 C.text.
 * Roles: `tablist` on the track, `tab` + `selected` on each segment. One `feedback.select()` per change.
 */
export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
  style,
  testID,
}: SegmentedControlProps<K>): React.JSX.Element {
  const reduced = useMotionReduced();
  const [trackWidth, setTrackWidth] = useState(0);
  const count = Math.max(segments.length, 1);
  const segmentWidth = trackWidth > 0 ? (trackWidth - TRACK_PAD * 2) / count : 0;
  const foundIndex = segments.findIndex((s) => s.key === value);
  const index = foundIndex < 0 ? 0 : foundIndex;

  const thumbX = useSharedValue(0);
  // Read/written only inside the effect (never in render): first layout and width changes snap, selections spring.
  const settledWidthRef = useRef(0);

  useEffect(() => {
    if (segmentWidth <= 0) return;
    const target = index * segmentWidth;
    const widthChanged = settledWidthRef.current !== segmentWidth;
    settledWidthRef.current = segmentWidth;
    if (reduced || widthChanged) {
      thumbX.set(target);
      return;
    }
    thumbX.set(withSpring(target, spr(motion.spring.press)));
  }, [index, segmentWidth, reduced, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumbX.get() }] }));

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== trackWidth) setTrackWidth(w);
  };

  const handleSelect = (key: K) => {
    if (key === value) return;
    feedback.select();
    onChange(key);
  };

  return (
    <View accessibilityRole="tablist" onLayout={handleLayout} style={[styles.track, style]} testID={testID}>
      {segmentWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.thumb, { width: segmentWidth }, thumbStyle]} />
      ) : null}
      {segments.map((s) => {
        const selected = s.key === value;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityLabel={s.count !== undefined ? `${s.label}, ${s.count}` : s.label}
            accessibilityState={{ selected }}
            hitSlop={SEGMENT_HIT_SLOP}
            onPress={() => handleSelect(s.key)}
            style={styles.segment}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {s.label}
            </Text>
            {s.count !== undefined ? (
              <Text style={[styles.count, selected && styles.countSelected]} maxFontSizeMultiplier={1.3}>
                {s.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "stretch",
    height: TRACK_HEIGHT,
    padding: TRACK_PAD,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
  },
  thumb: {
    position: "absolute",
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    borderRadius: radius.md,
    backgroundColor: C.card,
    ...shadow.card,
  },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 8 },
  label: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  labelSelected: { fontFamily: fontFamily.bold, color: C.text },
  count: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub },
  countSelected: { color: C.text },
});
