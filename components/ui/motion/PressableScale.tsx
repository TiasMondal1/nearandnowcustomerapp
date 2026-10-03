// codename: onyx
// The one press recipe (DECISIONS D10, PLAN §5.5): a reanimated scale spring on press-in/out plus an optional
// pressed background. Replaces every legacy opacity-fade / RN-Animated press in the app. SILENT by default —
// a haptic is opted into only where the press itself changes state (BRIEF ask 9, CONTRACTS §8).
import React from "react";
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type AnimatedStyle } from "react-native-reanimated";

import { motion } from "../../../constants/ui";
import { useDevFlag } from "../../../lib/devFlags";
import { feedback, haptic as playHaptic, type HapticKind } from "../../../lib/feedback";
import { spr, useMotionReduced } from "./presets";

export type PressableScaleProps = Omit<PressableProps, "style" | "children"> & {
  /**
   * Press-in scale target. Default `motion.scale.card` (0.97). Rows pass `motion.scale.row` (0.98), full-width
   * CTAs `motion.scale.cta` (0.97), tiles/chips `motion.scale.tile` / `motion.scale.chip` (0.94), icon buttons
   * `motion.scale.icon` (0.9).
   */
  scale?: number;
  /**
   * Spring used for press-in AND release. Default `motion.spring.press` ({ damping: 18, stiffness: 280 } — the
   * home ProductCard press). Reshaped live by `Dev_Motion_inhibit_SpeedFactor` through `spr()`.
   */
  spring?: { damping: number; stiffness: number; mass?: number };
  /**
   * Haptic fired in `onPress` BEFORE your handler (so it lands on the touch, not after async work).
   * **Default `false`** (rev. 2 — BRIEF ask 9): a haptic marks a state change, never pure navigation, so tiles,
   * banners, avatars, icon buttons, rows, cards, CTAs, back/close/share stay silent.
   * Opt in ONLY where the press itself changes state in place: Chip `'select'`, Toggle `'toggle'`,
   * SegmentedControl `'select'`, rating stars `'select'`, dev-panel controls.
   * NEVER pass a haptic to a control whose handler mutates the cart (ADD / + / − / remove / clear) —
   * `CartContext` fires `feedback.add()` / `feedback.remove()` itself (one gesture → one haptic).
   * Ignored when `sound` is true: `feedback.tapSound()` already includes the tap haptic.
   */
  haptic?: HapticKind | false;
  /**
   * Plays `feedback.tapSound()` (ui_tap at 0.45 + tap haptic) in `onPress` instead of `haptic`. Default `false`.
   * ONLY the tab bar, dev controls and pull-to-refresh pass true (CONTRACTS §8; motion doc C4).
   */
  sound?: boolean;
  /**
   * Applied to the inner Pressable while pressed, e.g. `{ backgroundColor: C.bgSoft }` (rows),
   * `{ backgroundColor: C.border }` (tiles), `{ backgroundColor: C.primaryDark }` (primary CTA). It survives
   * reduced motion and `Dev_Onyx_inhibit_PressScale` — it is the only press feedback left then.
   */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Outer `Animated.View` — receives the scale transform. Put LAYOUT here: flex, width/height, margins, alignSelf. */
  style?: StyleProp<ViewStyle>;
  /**
   * The Pressable itself — padding, background, border radius, min height. Dividers/hairlines belong OUTSIDE the
   * scaled view (on `style`'s view or as siblings) so they never shrink with the press.
   */
  innerStyle?: StyleProp<ViewStyle>;
  /** Static children, or a render function receiving `{ pressed }` exactly like RN Pressable. */
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
};

/**
 * Scale-on-press wrapper. `accessibilityRole` defaults to `"button"`; `accessibilityLabel`, `accessibilityState`
 * (merged with `disabled`), `hitSlop`, `disabled`, `testID`, `android_ripple` (callers may pass `null`) and every
 * other PressableProp are forwarded to the inner Pressable. The scale stays at 1 (no motion) under OS
 * reduce-motion, `Dev_Onyx_inhibit_Animations`, `Dev_Onyx_inhibit_Feature` and `Dev_Onyx_inhibit_PressScale`;
 * `pressedStyle` still applies. Pure navigation is silent: nothing is played unless `haptic` / `sound` is passed.
 */
export function PressableScale(props: PressableScaleProps): React.JSX.Element {
  const {
    scale,
    spring,
    haptic = false,
    sound = false,
    pressedStyle,
    style,
    innerStyle,
    children,
    onPress,
    onPressIn,
    onPressOut,
    accessibilityRole = "button",
    accessibilityState,
    disabled,
    ...rest
  } = props;
  const press = usePressScale({ scale, spring });

  const handlePressIn = (e: GestureResponderEvent) => {
    press.onPressIn();
    onPressIn?.(e);
  };
  const handlePressOut = (e: GestureResponderEvent) => {
    press.onPressOut();
    onPressOut?.(e);
  };
  const handlePress = (e: GestureResponderEvent) => {
    // Feedback first, so the tick lands on the touch. `sound` wins: tapSound() already carries the tap haptic.
    if (sound) feedback.tapSound();
    else if (haptic) playHaptic(haptic);
    onPress?.(e);
  };

  return (
    <Animated.View style={[style, press.animatedStyle]}>
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityState={disabled ? { ...accessibilityState, disabled: true } : accessibilityState}
        disabled={disabled}
        {...rest}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={({ pressed }) => [innerStyle, pressed ? pressedStyle : null]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The scale half of PressableScale for cells that own their Pressable (ListRow, FlashList cells). Returns the
 * `animatedStyle` (`transform: [{ scale }]`) for the wrapping `Animated.View` and the two handlers to spread onto
 * the Pressable. Defaults: `scale` = `motion.scale.card` (0.97), `spring` = `motion.spring.press`. Same
 * reduced-motion / `Dev_Onyx_inhibit_PressScale` logic as the component: the target becomes 1, so nothing moves.
 */
export function usePressScale(opts?: { scale?: number; spring?: PressableScaleProps["spring"] }): {
  animatedStyle: AnimatedStyle<ViewStyle>;
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const target = opts?.scale ?? motion.scale.card;
  const spring = opts?.spring ?? motion.spring.press;
  const reduced = useMotionReduced();
  const inhibitScale = useDevFlag("Dev_Onyx_inhibit_PressScale");
  const still = reduced || inhibitScale;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const onPressIn = () => {
    scale.set(withSpring(still ? 1 : target, spr(spring)));
  };
  const onPressOut = () => {
    scale.set(withSpring(1, spr(spring)));
  };

  return { animatedStyle, onPressIn, onPressOut };
}
