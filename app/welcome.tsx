// codename: zephyr
// Post-login interstitial (M34): one fade, tappable to skip, auto-advances after 1.2 s. The whole screen is the
// skip target; nothing here plays feedback (OTP already played `success`).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";

import { BRAND_TAGLINE, BrandPhoto } from "../components/brand";
import { enter, IconWrap, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { fontFamily, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useDevFlag } from "../lib/devFlags";
import { onNativePromptsSettled } from "../lib/pendingNativePrompts";

/** Auto-advance delay (DECISIONS D11 Q7 — 1.2 s). */
const AUTO_ADVANCE_MS = 1200;
/** Below this window height the column is too tight for the photo, so it is left out. */
const PHOTO_MIN_WINDOW_HEIGHT = 640;
/** Above this system font scale the text needs the photo's room (a three-line address would clip), so it is left out. */
const PHOTO_MAX_FONT_SCALE = 1.15;
/** Legacy delay under Dev_Zephyr_inhibit_Feature (the pre-zephyr 2 s, not tappable). */
const LEGACY_ADVANCE_MS = 2000;

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
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const showPhoto = windowHeight >= PHOTO_MIN_WINDOW_HEIGHT && fontScale <= PHOTO_MAX_FONT_SCALE;

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const displayLabel = location?.label ?? null;
  const displayAddress = location?.address ?? null;

  // 0 = go now (tap, or the interstitial is switched off); otherwise the auto-advance delay.
  const delay = skipInterstitial || skipRequested ? 0 : legacy ? LEGACY_ADVANCE_MS : AUTO_ADVANCE_MS;

  // Navigate to home after `delay` — but never into a native permission dialog, and never in the frame the
  // Activity resumes from one. A dialog pauses the Activity (this timer with it), so the old "poll, then go at an
  // 8 s cap" fired the instant the user answered, together with everything else that had queued up — the first-
  // login blank page (2026-09-09 and 2026-11-19, see lib/pendingNativePrompts.ts and bug_fixes_2026-07-23.md).
  // `onNativePromptsSettled` waits until nothing native is up AND things have been quiet for a moment; there is
  // no cap while a dialog is showing (a leaked flag is dropped by the gate itself). The first-run prompts now
  // wait for Home, so on every normal run this fires the moment the delay elapses.
  useEffect(() => {
    let cancelSettled: (() => void) | null = null;
    const timer = setTimeout(() => {
      cancelSettled = onNativePromptsSettled(() => {
        if (advancedRef.current) return;
        advancedRef.current = true;
        router.replace("/(tabs)/home");
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelSettled?.();
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
              source={require("../assets/brand/logo-stacked.png")}
              style={styles.logo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <Text style={styles.tagline} maxFontSizeMultiplier={1.3}>
              {BRAND_TAGLINE}
            </Text>
          </View>

          {/* Greeting */}
          <View style={styles.greetSection}>
            <Text style={styles.greetTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Welcome{user ? `, ${firstName}` : ""}!
            </Text>
            <Text style={styles.greetSub} maxFontSizeMultiplier={1.3}>You&apos;re all set to start shopping.</Text>
          </View>

          {/* Photo: decorative, taller windows at near-default text size only (returns null if the slot is unfilled) */}
          {showPhoto ? (
            <View style={styles.photoWrap}>
              <BrandPhoto slot="welcome" shape="card" priority="high" />
            </View>
          ) : null}

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
            <Text style={styles.locationLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {displayLabel ?? "Your location"}
            </Text>
            {displayAddress ? (
              <Text style={styles.locationAddress} numberOfLines={3} maxFontSizeMultiplier={1.3}>
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
  logo: { width: 160, height: 117 },
  tagline: { ...text.label, color: C.textSub, marginTop: 8, textAlign: "center" },

  greetSection: { alignItems: "center", gap: 8 },
  greetTitle: { ...text.price, letterSpacing: -0.3, textAlign: "center" },
  greetSub: { fontFamily: fontFamily.medium, fontSize: 14, color: C.textSub, textAlign: "center" },

  photoWrap: { width: "100%" },

  locationSection: { alignItems: "center", gap: 8, width: "100%" },
  locationIconCircle: { marginBottom: 4 },
  locationLabel: { ...text.screenTitle, letterSpacing: -0.3, textAlign: "center" },
  locationAddress: { ...text.bodySm, fontFamily: fontFamily.medium, textAlign: "center", paddingHorizontal: 16 },
});
