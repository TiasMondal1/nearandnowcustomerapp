// Boot redirect: the first route. Decides Home vs phone login once auth is known and signals the boot gate
// (lib/bootGate) so AppShell can drop the native splash the moment navigation has committed — the user never
// sees this frame on a normal cold start. Location prompting is Home's job (S4): no GPS work here.
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";

import { Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { isFontsReady, markNavReady } from "../lib/bootGate";
import { isNativePromptPending } from "../lib/pendingNativePrompts";

/** How often to re-check for a pending native dialog before navigating (ms). */
const PROMPT_POLL_MS = 250;
/** A stuck / never-released prompt flag must not strand the splash forever (ms). */
const PROMPT_HARD_CAP_MS = 8000;

export default function BootRedirectScreen() {
  const { isLoading, isAuthenticated } = useAuth();

  // Waits out a pending native permission dialog before navigating — with the GPS effect gone this resolves
  // immediately in practice, but the push-registration prompt (hooks/usePushNotifications.dev.ts) can still be
  // up on a clean install. Navigating blind into a native dialog is the hard-crash class fixed in welcome.tsx
  // 2026-09-09 — see lib/pendingNativePrompts.ts and bug_fixes_2026-07-23.md. It also waits for the Jakarta
  // faces (lib/bootGate `isFontsReady`, same hard cap) so Home's first frame never renders an unregistered
  // family under the held splash (W3 R6-17).
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const hardDeadline = Date.now() + PROMPT_HARD_CAP_MS;

    const tryAdvance = () => {
      if (cancelled) return;
      if ((isNativePromptPending() || !isFontsReady()) && Date.now() < hardDeadline) {
        pollTimer = setTimeout(tryAdvance, PROMPT_POLL_MS);
        return;
      }
      router.replace(isAuthenticated ? "/(tabs)/home" : "/phone");
      // Boot gate (speed-and-ease #6): flip nav-ready on the frame after the replace is issued. Deliberately
      // NOT cancelled in cleanup — this screen unmounts as a result of that very navigation, and the call is
      // idempotent (it stamps the `nav-ready` mark itself), so letting the frame run is what keeps the splash
      // from waiting out the 2 s cap.
      requestAnimationFrame(() => {
        markNavReady();
      });
    };

    tryAdvance();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [isLoading, isAuthenticated]);

  return (
    <Screen bg={C.card}>
      <View style={styles.container}>
        {/* Same mark as the native splash so the hand-off is invisible if this frame is ever seen. */}
        <Image
          source={require("../assets/near_now_image_640.png")}
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
  logo: { width: 160, height: 145 },
});
