// Boot redirect: the first route. Decides Home vs phone login once auth is known and signals the boot gate
// (lib/bootGate) so AppShell can drop the native splash the moment navigation has committed — the user never
// sees this frame on a normal cold start. Location prompting is Home's job (S4): no GPS work here.
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";

import { Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { isFontsReady, markNavReady, subscribeFontsReady } from "../lib/bootGate";
import { onNativePromptsSettled } from "../lib/pendingNativePrompts";

/** Fonts that never settle must not strand the splash forever (ms). Applies to the fonts wait only. */
const FONTS_HARD_CAP_MS = 8000;

export default function BootRedirectScreen() {
  const { isLoading, isAuthenticated } = useAuth();

  // Two waits before the redirect. First the Jakarta faces (lib/bootGate `isFontsReady`, capped at 8 s) so Home's
  // first frame never renders an unregistered family under the held splash (W3 R6-17). Then the native-prompt
  // gate (lib/pendingNativePrompts): never navigate into a permission dialog or in the frame the Activity
  // resumes from one — the first-login blank page, see bug_fixes_2026-07-23.md. Nothing prompts before login and
  // the first-run prompts wait for Home, so that second wait passes at once on a normal cold start; it has no
  // cap of its own while a dialog is up (a leaked flag is dropped by the gate).
  useEffect(() => {
    if (isLoading) return;
    let started = false;
    let cancelSettled: (() => void) | null = null;
    let unsubscribeFonts: (() => void) | null = null;
    let fontsTimer: ReturnType<typeof setTimeout> | null = null;

    const redirect = () => {
      router.replace(isAuthenticated ? "/(tabs)/home" : "/phone");
      // Boot gate (speed-and-ease #6): flip nav-ready on the frame after the replace is issued. Deliberately
      // NOT cancelled in cleanup — this screen unmounts as a result of that very navigation, and the call is
      // idempotent (it stamps the `nav-ready` mark itself), so letting the frame run is what keeps the splash
      // from waiting out the 2 s cap.
      requestAnimationFrame(() => {
        markNavReady();
      });
    };

    // Fonts settled (or the cap ran out): hand over to the prompt gate, once.
    const afterFonts = () => {
      if (started) return;
      started = true;
      unsubscribeFonts?.();
      if (fontsTimer) clearTimeout(fontsTimer);
      cancelSettled = onNativePromptsSettled(redirect);
    };

    if (isFontsReady()) {
      afterFonts();
    } else {
      unsubscribeFonts = subscribeFontsReady(afterFonts);
      fontsTimer = setTimeout(afterFonts, FONTS_HARD_CAP_MS);
    }

    return () => {
      // `started` also stops a fonts callback that is already queued from redirecting after cleanup.
      started = true;
      unsubscribeFonts?.();
      if (fontsTimer) clearTimeout(fontsTimer);
      cancelSettled?.();
    };
  }, [isLoading, isAuthenticated]);

  return (
    <Screen bg={C.card}>
      <View style={styles.container}>
        {/* Same logo as the native splash so the hand-off is invisible if this frame is ever seen. */}
        <Image
          source={require("../assets/brand/logo-stacked.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessible={false}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  // The native splash draws this logo 240 dp x 0.62 wide (scripts/generate-icons.js); 1024 x 749 artwork.
  logo: { width: 149, height: 109 },
});
