// codename: antares
// EtaLine — "⚡ Delivery in 12 minutes" (CONTRACTS §4.11 · motion M13 · speed-and-ease #31). Reads the delivery ETA
// store itself, so every surface (tab headers, PDP, checkout) shows the same number with zero extra requests. The
// minutes roll; the bolt pops once when the number goes DOWN (good news). Nothing here plays feedback (machine event).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion } from "../../constants/ui";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import type { DeliveryEta } from "../../lib/deliveryEta";
import { useDevFlag } from "../../lib/devFlags";
import { AnimatedNumber } from "./motion/AnimatedNumber";
import { spr, useMotionReduced } from "./motion/presets";

export type EtaLineProps = {
  /** sm: 13/600, bolt 14 · md: 14/600, bolt 16. Default 'sm'. */
  size?: "sm" | "md";
  /** Override the live value (tests, previews). Default `useDeliveryEta()`. */
  eta?: DeliveryEta;
  /** Applied to the text runs (colour / size overrides). */
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * open → "⚡ Delivery in <N> minutes" in C.primary with the number on `AnimatedNumber mode="roll"` (snaps under
 * `Dev_Antares_inhibit_Ticker` and reduced motion) · closed → "Store closed · opens later today" in C.warningText ·
 * unknown → "Finding stores…" in C.textSub · none → renders null. One accessible text element whose label is the full
 * sentence. The bolt springs 1 → 1.2 → 1 (`motion.spring.pop` then `.press`) only when the minutes decrease.
 */
export function EtaLine({ size = "sm", eta: etaProp, style, testID }: EtaLineProps = {}): React.JSX.Element | null {
  const liveEta = useDeliveryEta();
  const eta = etaProp ?? liveEta;
  const inhibitTicker = useDevFlag("Dev_Antares_inhibit_Ticker");
  const reduced = useMotionReduced();

  const boltScale = useSharedValue(1);
  const boltStyle = useAnimatedStyle(() => ({ transform: [{ scale: boltScale.get() }] }));
  const prevMinutesRef = useRef<number | null>(eta.minutes);

  useEffect(() => {
    const prev = prevMinutesRef.current;
    prevMinutesRef.current = eta.minutes;
    if (prev == null || eta.minutes == null || eta.minutes >= prev || reduced) return;
    boltScale.set(withSequence(withSpring(1.2, spr(motion.spring.pop)), withSpring(1, spr(motion.spring.press))));
  }, [eta.minutes, reduced, boltScale]);

  if (eta.state === "none") return null;

  const md = size === "md";
  const textStyle = [md ? styles.textMd : styles.textSm, style];
  const iconSize = md ? 16 : 14;

  if (eta.state === "closed") {
    return (
      <View
        style={styles.line}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Store closed, opens later today"
        testID={testID}
      >
        <MaterialCommunityIcons name="clock-outline" size={iconSize} color={C.warningText} />
        <Text style={[textStyle, styles.closed]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          Store closed · opens later today
        </Text>
      </View>
    );
  }

  if (eta.state === "unknown" || eta.minutes == null) {
    return (
      <View style={styles.line} accessible accessibilityRole="text" accessibilityLabel="Finding stores near you" testID={testID}>
        <MaterialCommunityIcons name="flash" size={iconSize} color={C.textSub} />
        <Text style={[textStyle, styles.unknown]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          Finding stores…
        </Text>
      </View>
    );
  }

  const minutes = eta.minutes;
  return (
    <View
      style={styles.line}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Delivery in ${minutes} minutes`}
      testID={testID}
    >
      <Animated.View style={boltStyle}>
        <MaterialCommunityIcons name="flash" size={iconSize} color={C.primary} />
      </Animated.View>
      <Text style={textStyle} maxFontSizeMultiplier={1.3}>
        Delivery in{" "}
      </Text>
      {inhibitTicker ? (
        <Text style={textStyle} maxFontSizeMultiplier={1.3}>
          {minutes}
        </Text>
      ) : (
        <AnimatedNumber mode="roll" value={minutes} style={textStyle} accessibilityLabel={`${minutes}`} />
      )}
      <Text style={textStyle} maxFontSizeMultiplier={1.3}>
        {" "}
        {minutes === 1 ? "minute" : "minutes"}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4 },
  textSm: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: C.primary },
  textMd: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: C.primary },
  closed: { color: C.warningText },
  unknown: { color: C.textSub },
});
