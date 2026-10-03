// Collapsible — animated show/hide that replaces every legacy global layout-animation call (scoped to this
// subtree; the global API animates the whole commit and flickers over MapView — MAP §7.17, motion doc C12).
// The REAL height is animated (body `height` = measured content height × progress), so siblings below flow with
// it — a bare `layout={LinearTransition}` on the outer view would only animate its own frame and leave the rest
// of the screen jumping. Reanimated 4; snaps under reduced motion and `Dev_Onyx_inhibit_LayoutTransitions`.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { C } from "../../../constants/colors";
import { motion } from "../../../constants/ui";
import { dur, ease, useLayoutTransitionsEnabled, useMotionReduced } from "./presets";

export type CollapsibleProps = {
  /** Shows the children when true. */
  open: boolean;
  children: React.ReactNode;
  /** Outer container — padding/margins go here; the clipping body inside animates its height. */
  style?: StyleProp<ViewStyle>;
  /**
   * Default `true`: children unmount once the close animation has finished (and mount as the open one starts).
   * `false`: children stay mounted but collapsed to 0 px, untouchable and hidden from assistive tech — for inputs
   * whose state must survive a collapse.
   */
  unmountWhenClosed?: boolean;
  testID?: string;
};

/**
 * Open/close over `motion.duration.base` (220 ms, standard easing, × speed factor): the body's height runs
 * 0 ↔ measured content height while the content fades with the same progress. The content is measured with
 * `onLayout` inside an overflow-hidden body, so it follows its own size changes while open; keep elevated /
 * shadowed children OUTSIDE a Collapsible (Android drops elevation under overflow hidden — MAP §7.4). An
 * initially-open Collapsible paints its content in normal flow until the first measurement, so there is no 0 px
 * frame on mount. Reduced motion / `Dev_Onyx_inhibit_LayoutTransitions`: snaps.
 */
export function Collapsible({ open, children, style, unmountWhenClosed = true, testID }: CollapsibleProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const layoutEnabled = useLayoutTransitionsEnabled();
  const animated = !reduced && layoutEnabled;
  // The `open` value we are settled at; null while an animation runs. Drives unmounting only.
  const [settledAt, setSettledAt] = useState<boolean | null>(open);
  // Attach-only switch: content is laid out in flow until measured once, then the animated body height owns it.
  const [initiallyOpen] = useState(open);
  const [measured, setMeasured] = useState(false);
  const progress = useSharedValue(open ? 1 : 0);
  const contentHeight = useSharedValue(0);

  useEffect(() => {
    const target = open ? 1 : 0;
    if (!animated || progress.get() === target) {
      cancelAnimation(progress);
      progress.set(target);
      setSettledAt(open);
      return;
    }
    setSettledAt(null);
    const settle = (finished: boolean) => {
      if (finished) setSettledAt(open);
    };
    progress.set(
      withTiming(target, { duration: dur(motion.duration.base), easing: ease.standard }, (finished) => {
        "worklet";
        runOnJS(settle)(finished === true);
      }),
    );
  }, [open, animated, progress]);

  const settledClosed = !open && settledAt === false;
  const mounted = !unmountWhenClosed || !settledClosed;
  const inFlow = initiallyOpen && !measured;

  // progress is exactly 1 while settled open, so the body tracks the measured height of changing content.
  const bodyStyle = useAnimatedStyle(() => ({ height: progress.get() * contentHeight.get() }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const onContentLayout = (e: LayoutChangeEvent) => {
    contentHeight.set(e.nativeEvent.layout.height);
    setMeasured(true);
  };

  return (
    <View style={style} testID={testID}>
      <Animated.View style={inFlow ? null : [styles.body, bodyStyle]}>
        {mounted ? (
          <Animated.View
            onLayout={onContentLayout}
            style={inFlow ? null : [styles.measured, contentStyle]}
            pointerEvents={open ? "auto" : "none"}
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          >
            {children}
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

export type ChevronRotateProps = {
  /** Points down when false, up (rotated 180°) when true. */
  open: boolean;
  /** Icon size in px. Default 20. */
  size?: number;
  /** Icon colour. Default `C.textSub`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * `chevron-down` rotating 0° → 180° with `withTiming(dur(motion.duration.base))` (220 ms, standard easing).
 * Snaps under reduced motion. Decorative: hidden from assistive tech — put `accessibilityState={{ expanded }}` on
 * the row that toggles the Collapsible.
 */
export function ChevronRotate({ open, size = 20, color = C.textSub, style, testID }: ChevronRotateProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const rotation = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    if (reduced) {
      cancelAnimation(rotation);
      rotation.set(target);
      return;
    }
    rotation.set(withTiming(target, { duration: dur(motion.duration.base), easing: ease.standard }));
  }, [open, reduced, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get() * 180}deg` }] }));

  return (
    <Animated.View
      style={[styles.chevron, animatedStyle, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <MaterialCommunityIcons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Clips ONLY the measured content of this flat body (no elevation inside — MAP §7.4).
  body: { overflow: "hidden" },
  measured: { position: "absolute", left: 0, right: 0, top: 0 },
  chevron: { alignItems: "center", justifyContent: "center" },
});
