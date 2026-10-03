// TipSection — "Tip your delivery partner" (design/blinkit-parity §3.7, motion M19, C36 tip cap). Four Chips
// (₹10 ₹20 ₹30 Other) with the `toggle` haptic — the one place a chip press is a state change AND a tip — a "Most
// tipped" tag above ₹20, the custom amount inside a Collapsible on an underline Input, and the "Thanks!" moment:
// a 16 px hand-heart pops on `motion.spring.bouncy` while "Thanks!" fades in for 900 ms. The ₹500 cap lives in the
// screen (clamp + error text + one `feedback.error()` on blur); this component only renders the error and lets the
// Input shake on the new message. Memoised on primitives.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type TextInput } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, text } from "../../constants/ui";
import { feedback } from "../../lib/feedback";
import { Chip, Collapsible, enter, exit, Input, spr, useMotionReduced } from "../ui";

export type TipPreset = 10 | 20 | 30 | "custom";

export type TipSectionProps = {
  /** Selected chip; null = no tip. */
  preset: TipPreset | null;
  /** Raw text of the "Other" field (digits only; the screen parses + caps it). */
  customTip: string;
  /** "Max ₹500" after a capped blur; null otherwise. Clears as the user edits. */
  customError: string | null;
  /** Increment to play the "Thanks!" moment (the screen bumps it on a preset pick and on a valid custom blur). */
  thanksNonce: number;
  onPresetChange: (next: TipPreset | null) => void;
  onCustomChange: (digits: string) => void;
  onCustomBlur: () => void;
  /** Lets the screen remember which section owns the keyboard (scroll-into-view on keyboardDidShow). */
  onCustomFocus?: () => void;
  inputRef?: React.Ref<TextInput>;
  testID?: string;
};

const PRESETS: readonly (10 | 20 | 30)[] = [10, 20, 30];
const MOST_TIPPED: TipPreset = 20;
/** How long "Thanks!" stays (M19). */
const THANKS_MS = 900;

function TipSectionBase({
  preset,
  customTip,
  customError,
  thanksNonce,
  onPresetChange,
  onCustomChange,
  onCustomBlur,
  onCustomFocus,
  inputRef,
  testID,
}: TipSectionProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const popScale = useSharedValue(1);
  const [thanksVisible, setThanksVisible] = useState(false);
  const lastNonceRef = useRef(thanksNonce);

  // The nonce present at mount does not play (restored state stays still, like Shake).
  useEffect(() => {
    if (lastNonceRef.current === thanksNonce) return;
    lastNonceRef.current = thanksNonce;
    setThanksVisible(true);
    if (!reduced) {
      popScale.set(0.4);
      popScale.set(withSpring(1, spr(motion.spring.bouncy)));
    }
    const timer = setTimeout(() => setThanksVisible(false), THANKS_MS);
    return () => clearTimeout(timer);
  }, [thanksNonce, reduced, popScale]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: popScale.get() }] }));

  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          Tip your delivery partner
        </Text>
        {thanksVisible ? (
          <Animated.View entering={enter.fade()} exiting={exit.fade()} style={styles.thanks} accessibilityLiveRegion="polite">
            <Animated.View style={popStyle}>
              <MaterialCommunityIcons name="hand-heart" size={16} color={C.primary} />
            </Animated.View>
            <Text style={styles.thanksText} maxFontSizeMultiplier={1.3}>
              Thanks!
            </Text>
          </Animated.View>
        ) : null}
      </View>
      <Text style={styles.helper} maxFontSizeMultiplier={1.3}>
        A small tip, a big gesture — your delivery partner keeps all of it.
      </Text>

      <View style={styles.chips}>
        {PRESETS.map((value) => {
          const selected = preset === value;
          return (
            <View key={value} style={styles.chipSlot}>
              {value === MOST_TIPPED ? (
                <View style={styles.tag} pointerEvents="none">
                  <Text style={styles.tagText} maxFontSizeMultiplier={1.3}>
                    Most tipped
                  </Text>
                </View>
              ) : null}
              <Chip
                label={`₹${value}`}
                selected={selected}
                haptic={false}
                onPress={() => {
                  // `toggle(on)` carries the direction (Android Toggle_On/Off + ui_toggle); the prop path cannot (W3 R4-13).
                  feedback.toggle(!selected);
                  onPresetChange(selected ? null : value);
                }}
                style={styles.chip}
                accessibilityLabel={`Tip ₹${value}${value === MOST_TIPPED ? ", most tipped" : ""}`}
              />
            </View>
          );
        })}
        <View style={styles.chipSlot}>
          <Chip
            label="Other"
            selected={preset === "custom"}
            haptic={false}
            onPress={() => {
              feedback.toggle(preset !== "custom");
              onPresetChange(preset === "custom" ? null : "custom");
            }}
            style={styles.chip}
            accessibilityLabel="Other tip amount"
          />
        </View>
      </View>

      <Collapsible open={preset === "custom"}>
        <Input
          label="Tip amount (₹)"
          variant="underline"
          keyboardType="number-pad"
          value={customTip}
          onChangeText={onCustomChange}
          onBlur={onCustomBlur}
          onFocus={onCustomFocus}
          error={customError}
          helper="Up to ₹500"
          placeholder="e.g. 40"
          maxLength={4}
          returnKeyType="done"
          inputRef={inputRef}
          containerStyle={styles.customInput}
          accessibilityLabel="Custom tip amount in rupees"
        />
      </Collapsible>
    </View>
  );
}

/** Memoised on primitives; the screen passes stable handlers. */
export const TipSection = React.memo(TipSectionBase);
TipSection.displayName = "TipSection";

const styles = StyleSheet.create({
  section: { backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { ...text.h3, flexShrink: 1 },
  thanks: { flexDirection: "row", alignItems: "center", gap: 4 },
  thanksText: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.primary },
  helper: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 17, color: C.textSub, marginTop: 4, marginBottom: 14 },
  // Top padding leaves room for the "Most tipped" tag that overhangs the ₹20 chip.
  chips: { flexDirection: "row", gap: 8, paddingTop: 8 },
  chipSlot: { flex: 1 },
  chip: { alignSelf: "stretch" },
  tag: {
    position: "absolute",
    top: -9,
    alignSelf: "center",
    zIndex: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: C.primaryXLight,
  },
  tagText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 13, color: C.primary },
  customInput: { marginTop: 12 },
});
