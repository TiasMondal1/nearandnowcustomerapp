// codename: zephyr
// Post-login interstitial (M34): one fade, tappable to skip, auto-advances after 1.2 s. The whole screen is the
// skip target; nothing here plays feedback (OTP already played `success`).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { enter, IconWrap, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useDevFlag } from "../lib/devFlags";
import { isNativePromptPending } from "../lib/pendingNativePrompts";

/** Auto-advance delay (DECISIONS D11 Q7 — 1.2 s). */
const AUTO_ADVANCE_MS = 1200;
/** Legacy delay under Dev_Zephyr_inhibit_Feature (the pre-zephyr 2 s, not tappable). */
const LEGACY_ADVANCE_MS = 2000;
/** How often to re-check for a pending native dialog before navigating (ms). */
const PROMPT_POLL_MS = 250;
/** A stuck / never-released prompt flag must not strand the user here forever (ms). */
const PROMPT_HARD_CAP_MS = 8000;

function getLocationIcon(label: string | null): keyof typeof MaterialCommunityIcons.glyphMap {
  if (!label) return "map-marker-outline";
  const l = label.toLowerCase();
  if (l.includes("home")) return "home-outline";
  if (l.includes("work") || l.includes("office")) return "office-building-outline";
  if (l.includes("hotel")) return "bed-outline";
  return "map-marker-outline";
}

export default function WelcomeScreen() {
  const { user } = useAuth();
  const { location } = useLocation();
  const legacy = useDevFlag("Dev_Zephyr_inhibit_Feature");
  const skipInterstitial = useDevFlag("Dev_Zephyr_inhibit_WelcomeInterstitial");
  const [skipRequested, setSkipRequested] = useState(false);
  const advancedRef = useRef(false);

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const displayLabel = location?.label ?? null;
  const displayAddress = location?.address ?? null;

  // 0 = go now (tap, or the interstitial is switched off); otherwise the auto-advance delay.
  const delay = skipInterstitial || skipRequested ? 0 : legacy ? LEGACY_ADVANCE_MS : AUTO_ADVANCE_MS;

  // Navigate to home after `delay` — unless a native permission dialog (push
  // notifications, fired the instant login succeeded — see
  // usePushNotifications.dev.ts) may still be up. That's only possible on a
  // clean install (permissions still undetermined there; already-decided on
  // every later app open, so this extra wait is a no-op in the overwhelmingly
  // common case). Navigating blind into that dialog is a known hard-crash
  // class — a native OS dialog racing a JS-driven screen transition kills the
  // process below the JS layer, so ErrorBoundary never even sees it. Found +
  // fixed 2026-09-09, see bug_fixes_2026-07-23.md. Capped so a stuck/never-
  // released flag can't strand the user on this screen forever.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hardDeadline = Date.now() + delay + PROMPT_HARD_CAP_MS;

    const tryAdvance = () => {
      if (cancelled || advancedRef.current) return;
      if (isNativePromptPending() && Date.now() < hardDeadline) {
        timer = setTimeout(tryAdvance, PROMPT_POLL_MS);
        return;
      }
      advancedRef.current = true;
      router.replace("/(tabs)/home");
    };

    timer = setTimeout(tryAdvance, delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [delay]);

  const skip = () => setSkipRequested(true);

  return (
    <Screen bg={C.card}>
      {/* The whole screen is the (silent) skip target; under the legacy flag it is not tappable. */}
      <Pressable
        style={styles.fill}
        onPress={legacy ? undefined : skip}
        disabled={legacy}
        accessibilityRole={legacy ? "none" : "button"}
        accessibilityLabel={legacy ? undefined : "Continue to Home"}
        accessibilityHint={legacy ? undefined : "Skips the welcome screen"}
      >
        <Animated.View entering={enter.fade()} style={styles.container}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Image
              source={require("../assets/near_now_image_640.png")}
              style={styles.logo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
          </View>

          {/* Greeting */}
          <View style={styles.greetSection}>
            <Text style={styles.greetTitle} accessibilityRole="header">
              Welcome{user ? `, ${firstName}` : ""}!
            </Text>
            <Text style={styles.greetSub}>You&apos;re all set to start shopping.</Text>
          </View>

          {/* Location */}
          <View style={styles.locationSection}>
            <IconWrap
              size={56}
              circle
              bg={C.primaryXLight}
              icon={getLocationIcon(displayLabel)}
              iconSize={26}
              iconColor={C.primary}
              style={styles.locationIconCircle}
            />
            <Text style={styles.locationLabel} numberOfLines={1}>
              {displayLabel ?? "Your location"}
            </Text>
            {displayAddress ? (
              <Text style={styles.locationAddress} numberOfLines={3}>
                {displayAddress}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 28,
    paddingVertical: 32,
  },

  logoSection: { alignItems: "center" },
  logo: { width: 160, height: 145 },

  greetSection: { alignItems: "center", gap: 8 },
  greetTitle: {
    fontSize: 28,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.text,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  greetSub: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 14, color: C.textSub, textAlign: "center" },

  locationSection: { alignItems: "center", gap: 8, width: "100%" },
  locationIconCircle: { marginBottom: 4 },
  locationLabel: {
    fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 18,
    color: C.text,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  locationAddress: {
    fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 13,
    color: C.textSub,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 16,
  },
});
