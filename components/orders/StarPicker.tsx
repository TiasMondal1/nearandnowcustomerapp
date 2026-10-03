// codename: pavo
// Five explicit star buttons for the rating flow (replaces the old `locationX` half-star picker, which was
// undiscoverable and not operable by assistive tech — MAP U5). Integers only. One `feedback.select()` per tap;
// the NEWLY filled stars pop left → right, 30 ms apart (motion doc M14); un-filling has no pop.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { C } from "../../constants/colors";
import { motion } from "../../constants/ui";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { dur, PressableScale, spr, useMotionReduced } from "../ui";

export type StarPickerProps = {
  /** 0 (none) … 5. Integers only. */
  value: number;
  /** Called with the tapped star's number AFTER `feedback.select()`; tapping the current value again is a no-op. */
  onChange: (n: number) => void;
  /** Glyph size. Default 28, centred in a 44 × 44 target. */
  size?: number;
  disabled?: boolean;
  /** Label for the radiogroup, e.g. "Rate Amul milk". Default "Rating". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const STARS = [1, 2, 3, 4, 5] as const;
/** Touch target per star (a11y minimum). */
const TARGET = 44;
/** Delay between consecutive newly-filled stars' pops. */
const STAGGER_MS = 30;
const POP_SCALE = 1.25;

type StarProps = {
  n: number;
  filled: boolean;
  checked: boolean;
  size: number;
  disabled: boolean;
  scale: SharedValue<number>;
  onPress: () => void;
};

function Star({ n, filled, checked, size, disabled, scale, onPress }: StarProps) {
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <PressableScale
      scale={motion.scale.icon}
      haptic={false}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
      accessibilityState={{ checked, disabled }}
      accessibilityValue={{ min: 1, max: 5, now: n }}
      innerStyle={styles.target}
    >
      <Animated.View style={popStyle}>
        <MaterialCommunityIcons
          name={filled ? "star" : "star-outline"}
          size={size}
          color={filled ? C.warning : C.textLight}
        />
      </Animated.View>
    </PressableScale>
  );
}

/**
 * Radiogroup of five 44 × 44 `PressableScale` stars (`motion.scale.icon`, no built-in haptic — `feedback.select()`
 * fires once per change here). Colour `C.textLight` → `C.warning`; newly filled stars pop
 * `withSequence(withSpring(1.25, bouncy), withSpring(1, press))` staggered 30 ms, skipped under reduced motion,
 * `Dev_Pavo_inhibit_StarStagger` and `Dev_Pavo_inhibit_Feature` (colour only).
 */
export function StarPicker({
  value,
  onChange,
  size = 28,
  disabled = false,
  accessibilityLabel = "Rating",
  style,
  testID,
}: StarPickerProps) {
  const reduced = useMotionReduced();
  const inhibitStagger = useDevFlag("Dev_Pavo_inhibit_StarStagger");
  const inhibitFeature = useDevFlag("Dev_Pavo_inhibit_Feature");

  // Exactly five shared values (fixed hook count) so the handler can drive each star without effects.
  const s1 = useSharedValue(1);
  const s2 = useSharedValue(1);
  const s3 = useSharedValue(1);
  const s4 = useSharedValue(1);
  const s5 = useSharedValue(1);
  const scales = [s1, s2, s3, s4, s5];

  useEffect(
    () => () => {
      cancelAnimation(s1);
      cancelAnimation(s2);
      cancelAnimation(s3);
      cancelAnimation(s4);
      cancelAnimation(s5);
    },
    [s1, s2, s3, s4, s5],
  );

  const select = (n: number) => {
    if (disabled || n === value) return;
    feedback.select();
    const pop = !reduced && !inhibitStagger && !inhibitFeature;
    if (pop && n > value) {
      for (let i = value; i < n; i += 1) {
        const sv = scales[i];
        cancelAnimation(sv);
        sv.set(1);
        sv.set(
          withDelay(
            dur((i - value) * STAGGER_MS),
            withSequence(withSpring(POP_SCALE, spr(motion.spring.bouncy)), withSpring(1, spr(motion.spring.press))),
          ),
        );
      }
    }
    onChange(n);
  };

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.row, style]} testID={testID}>
      {STARS.map((n) => (
        <Star
          key={n}
          n={n}
          filled={n <= value}
          checked={n === value}
          size={size}
          disabled={disabled}
          scale={scales[n - 1]}
          onPress={() => select(n)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // −6 compensates the first star's inner padding so the glyphs line up with the text column above them.
  row: { flexDirection: "row", alignItems: "center", marginLeft: -6 },
  target: { width: TARGET, height: TARGET, alignItems: "center", justifyContent: "center" },
});
