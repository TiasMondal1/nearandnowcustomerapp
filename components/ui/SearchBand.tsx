// codename: lyra
// SearchBand — the search field on Home (button mode: a 48 px pressable field whose quoted placeholder word
// rotates) and on the search screen (input mode: a real TextInput with clear + an indeterminate loading bar).
// CONTRACTS §4.11 · design/blinkit-parity §2.1 / BP-07 · motion M31 (the rotation is the one time-driven motion the
// plan allows, so it pauses whenever the band is not actually being looked at). The button press is navigation and
// therefore silent.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  AppState,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  FadeInUp,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, shadow } from "../../constants/ui";
import { SEARCH_PLACEHOLDER_WORDS } from "../../constants/searchTrending";
import { useDevFlag } from "../../lib/devFlags";
import { IconButton } from "./IconButton";
import { PressableScale } from "./motion/PressableScale";
import { dur, ease, useMotionReduced } from "./motion/presets";

export type SearchBandProps = {
  /** 'button' = pressable field with the rotating placeholder · 'input' = live TextInput. */
  mode: "button" | "input";
  /** input mode: controlled value. */
  value?: string;
  /** input mode: text change. */
  onChangeText?: (t: string) => void;
  /** input mode: keyboard "search" / return. Receives the current value. */
  onSubmit?: (t: string) => void;
  /** input mode: the clear (×) button; `onChangeText("")` is also called so an uncontrolled consumer still clears. */
  onClear?: () => void;
  /** input mode: focus on mount. Default false. */
  autoFocus?: boolean;
  /** button mode: press handler. Default `router.push('/support/search')`. */
  onPress?: () => void;
  /** Words the quoted placeholder cycles through. Default `SEARCH_PLACEHOLDER_WORDS`; rotates every 3000 ms in button mode only. */
  placeholderWords?: readonly string[];
  /**
   * Keep rotating. Default true; pass false while the list scrolls, a sheet is open or the tab is blurred. The rotation
   * is also off while the app is not active and — statically, with "Search for milk, bread…" — under reduced motion,
   * `Dev_Lyra_inhibit_PlaceholderRotation` and `Dev_Lyra_inhibit_Feature`.
   */
  rotate?: boolean;
  /** input mode: 2 px indeterminate bar along the bottom edge of the field while true. Default false. */
  loading?: boolean;
  /** Outer wrapper (margins). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Field height in px (C.card, r12, 1 px C.border, shadow.card). */
export const SEARCH_BAND_HEIGHT = 48;

/** Placeholder rotation period (design M31). */
const ROTATE_MS = 3000;
/** Word entering / exiting durations (motion M31). */
const WORD_IN_MS = 200;
const WORD_OUT_MS = 160;
/** Indeterminate bar: fraction of the track the sweep occupies and one sweep's duration. */
const BAR_FRACTION = 0.4;
const BAR_SWEEP_MS = 1100;

/**
 * 48 h field, `C.card`, r12, 1 px `C.border`, `shadow.card`, `magnify` 20 `C.textSub`, placeholder 14/500 `C.textSub`.
 * Button mode: `accessibilityRole="search"`, label "Search products"; only the quoted word animates (keyed
 * `Animated.Text`, FadeInUp 200 / FadeOutUp 160). Input mode: 16 px Medium text, `returnKeyType="search"`, clear
 * `IconButton icon="close-circle"` when there is a value, optional 2 px loading sweep (the one allowed loop: it is an
 * indeterminate progress indicator and runs only while `loading`; static under reduced motion).
 */
export function SearchBand(props: SearchBandProps): React.JSX.Element {
  return props.mode === "input" ? <SearchInput {...props} /> : <SearchButton {...props} />;
}

// ─── Button mode ──────────────────────────────────────────────────────────────

function defaultSearchPress(): void {
  router.push("/support/search");
}

function SearchButton({ onPress, placeholderWords, rotate = true, style, testID }: SearchBandProps) {
  const words = placeholderWords && placeholderWords.length > 0 ? placeholderWords : SEARCH_PLACEHOLDER_WORDS;
  const reduced = useMotionReduced();
  const inhibitRotation = useDevFlag("Dev_Lyra_inhibit_PlaceholderRotation");
  const inhibitFeature = useDevFlag("Dev_Lyra_inhibit_Feature");
  const isStatic = reduced || inhibitRotation || inhibitFeature;
  const wantsRotation = rotate && !isStatic && words.length > 1;

  // AppState is only watched while rotation is wanted (no listener on blurred / static bands).
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    if (!wantsRotation) return;
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, [wantsRotation]);

  const rotating = wantsRotation && appActive;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [rotating]);

  const word = words[tick % words.length];
  const staticCopy = `Search for ${words.slice(0, 2).join(", ")}…`;

  return (
    <PressableScale
      scale={motion.scale.card}
      onPress={onPress ?? defaultSearchPress}
      accessibilityRole="search"
      accessibilityLabel="Search products"
      accessibilityHint="Opens search"
      style={style}
      innerStyle={styles.field}
      pressedStyle={styles.fieldPressed}
      testID={testID}
    >
      <MaterialCommunityIcons name="magnify" size={20} color={C.textSub} />
      {isStatic ? (
        <Text style={styles.placeholder} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {staticCopy}
        </Text>
      ) : (
        <View style={styles.placeholderRow}>
          <Text style={styles.placeholder} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            Search for{" "}
          </Text>
          <Animated.Text
            key={`${tick}-${word}`}
            entering={tick > 0 ? FadeInUp.duration(dur(WORD_IN_MS)) : undefined}
            exiting={FadeOutUp.duration(dur(WORD_OUT_MS))}
            style={styles.placeholder}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {`"${word}"`}
          </Animated.Text>
        </View>
      )}
    </PressableScale>
  );
}

// ─── Input mode ───────────────────────────────────────────────────────────────

function SearchInput({ value = "", onChangeText, onSubmit, onClear, autoFocus = false, loading = false, style, testID }: SearchBandProps) {
  const reduced = useMotionReduced();

  const handleClear = () => {
    onChangeText?.("");
    onClear?.();
  };

  return (
    <View style={style} testID={testID}>
      <View style={[styles.field, styles.inputField]}>
        <MaterialCommunityIcons name="magnify" size={20} color={C.textSub} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={() => onSubmit?.(value)}
          returnKeyType="search"
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="Search for products"
          placeholderTextColor={C.textSub}
          selectionColor={C.primary}
          underlineColorAndroid="transparent"
          style={styles.input}
          accessibilityRole="search"
          accessibilityLabel="Search products"
          maxFontSizeMultiplier={1.3}
          testID={testID ? `${testID}-input` : undefined}
        />
        {value.length > 0 ? (
          <IconButton
            icon="close-circle"
            bg="transparent"
            color={C.textSub}
            size={32}
            iconSize={20}
            hitSlop={6}
            onPress={handleClear}
            accessibilityLabel="Clear search"
            testID={testID ? `${testID}-clear` : undefined}
          />
        ) : null}
        {loading ? <IndeterminateBar reduced={reduced} /> : null}
      </View>
    </View>
  );
}

/** 2 px sweep along the field's bottom edge. Loop allowed: indeterminate progress, mounted only while loading. */
function IndeterminateBar({ reduced }: { reduced: boolean }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (reduced || trackWidth <= 0) {
      cancelAnimation(x);
      x.set(0);
      return;
    }
    x.set(-trackWidth * BAR_FRACTION);
    x.set(withRepeat(withTiming(trackWidth, { duration: dur(BAR_SWEEP_MS), easing: ease.standard }), -1, false));
    return () => {
      cancelAnimation(x);
    };
  }, [reduced, trackWidth, x]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={onLayout} accessibilityRole="progressbar" accessibilityLabel="Searching">
      {reduced ? (
        <View style={[styles.sweep, styles.sweepStatic]} />
      ) : (
        <Animated.View style={[styles.sweep, { width: trackWidth * BAR_FRACTION }, sweepStyle]} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  field: {
    minHeight: SEARCH_BAND_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: C.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: C.border,
    ...shadow.card,
  },
  fieldPressed: { backgroundColor: C.bgSoft },
  inputField: { paddingRight: 6 },
  placeholderRow: { flex: 1, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  placeholder: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 18, color: C.textSub },
  input: { flex: 1, minHeight: 44, paddingVertical: 0, fontFamily: fontFamily.medium, fontSize: 16, color: C.text },
  // Track: inside the field, hugging the bottom edge within the radius; it clips the sweep and carries no elevation.
  track: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: C.border,
    overflow: "hidden",
  },
  sweep: { height: 2, borderRadius: 1, backgroundColor: C.primary },
  sweepStatic: { width: "100%" },
});
