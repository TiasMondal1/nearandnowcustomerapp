// codename: cobalt
// Offline banner (CONTRACTS §4.6): a 36 px band that reads `useIsOnline()`. Mounted ONCE in AppShell, IN FLOW above the
// Stack (W3 R3-05: an absolute band hid every back glyph / title for the whole offline duration). The host passes
// `topInset` so the band pays the status bar itself and `onVisibleChange` so it can zero the top safe-area inset for
// the screens below. lib/network debounces the offline flip by 1.5 s, so the band appears after 1.5 s offline; on
// reconnect it turns into a green "Back online" state for 1.5 s, toasts once (id 'back-online') and lifts away.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { motion } from "../../constants/ui";
import { useIsOnline } from "../../hooks/useIsOnline";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { dur, enter, exit, useMotionReduced } from "./motion/presets";
import { notify } from "./Toast";

export type OfflineBannerProps = {
  /** Extra style for the band. */
  style?: StyleProp<ViewStyle>;
  /** Status-bar inset the band pays itself when rendered in flow (its height grows by this). Default 0. */
  topInset?: number;
  /** Fires with `true` when the band mounts (offline / back-online) and `false` when it hides — the host shifts its content by it. */
  onVisibleChange?: (visible: boolean) => void;
  testID?: string;
};

/** Band height in px — hosts offset content by this while the banner shows. */
export const OFFLINE_BANNER_HEIGHT = 36;

/** How long the green "Back online" state stays before the band lifts away (ms). Also the toast's duration. */
const BACK_ONLINE_MS = 1500;
const OFFLINE_LABEL = "You're offline — showing saved data";
const BACK_ONLINE_LABEL = "Back online";

type BannerMode = "hidden" | "offline" | "back-online";

/**
 * Visuals: 36 px band, C.warningLight bg, `wifi-off` 16 C.warningText, label 12/600 C.warningText; "Back online" state
 * C.successLight / C.successText (colour crossfades over motion.duration.base; snaps under reduced motion).
 * Motion: `enter.drop()` / `exit.lift()`. Feedback: `feedback.passive('error')` once per online → offline transition,
 * nothing on reconnect except the toast. Hidden (and silent) under Dev_Cobalt_inhibit_Feature.
 */
export function OfflineBanner({ style, topInset = 0, onVisibleChange, testID }: OfflineBannerProps = {}): React.JSX.Element | null {
  const online = useIsOnline();
  const inhibited = useDevFlag("Dev_Cobalt_inhibit_Feature");
  const reduced = useMotionReduced();
  const [mode, setMode] = useState<BannerMode>("hidden");
  // Starts true so a cold start while offline shows the band (and fires the one passive haptic).
  const prevOnlineRef = useRef(true);
  /** 0 = warning (offline) palette, 1 = success (back online) palette. */
  const tone = useSharedValue(0);

  // ── Transitions ──
  useEffect(() => {
    const was = prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (inhibited) {
      setMode("hidden");
      return;
    }
    if (was && !online) {
      tone.set(0);
      setMode("offline");
      feedback.passive("error");
      return;
    }
    if (!was && online) {
      tone.set(reduced ? 1 : withTiming(1, { duration: dur(motion.duration.base) }));
      setMode("back-online");
      notify({ id: "back-online", title: BACK_ONLINE_LABEL, tone: "success", duration: BACK_ONLINE_MS });
    }
  }, [online, inhibited, reduced, tone]);

  // ── "Back online" lingers 1.5 s, then the band lifts away ──
  useEffect(() => {
    if (mode !== "back-online") return;
    const timer = setTimeout(() => setMode("hidden"), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [mode]);

  // ── Tell the host when the band occupies space (it zeroes the top inset for the Stack while visible) ──
  const onVisibleChangeRef = useRef(onVisibleChange);
  useEffect(() => {
    onVisibleChangeRef.current = onVisibleChange;
  }, [onVisibleChange]);
  const visible = mode !== "hidden";
  useEffect(() => {
    onVisibleChangeRef.current?.(visible);
  }, [visible]);

  const bandStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tone.get(), [0, 1], [C.warningLight, C.successLight]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(tone.get(), [0, 1], [C.warningText, C.successText]),
  }));

  if (mode === "hidden") return null;

  const offline = mode === "offline";
  const label = offline ? OFFLINE_LABEL : BACK_ONLINE_LABEL;

  return (
    <Animated.View
      entering={enter.drop()}
      exiting={exit.lift()}
      style={[styles.band, topInset > 0 && { height: OFFLINE_BANNER_HEIGHT + topInset, paddingTop: topInset }, bandStyle, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <MaterialCommunityIcons name={offline ? "wifi-off" : "wifi"} size={16} color={offline ? C.warningText : C.successText} />
      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    height: OFFLINE_BANNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    backgroundColor: C.warningLight,
  },
  label: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: C.warningText },
});
