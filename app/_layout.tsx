// codename: zephyr
// Root layout: module-scope boot work (runs during the native splash), the provider tree per CONTRACTS §6.1,
// the Stack transitions (zephyr) and the four shell hosts (OfflineBanner, CartBar, ToastHost, PushBootstrap).
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import * as Sentry from "@sentry/react-native";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { NavReadyProbe } from "../components/NavReadyProbe";
import { PushBootstrap } from "../components/PushBootstrap";
import { CartBar, MotionConfig, OfflineBanner, ToastHost, useMotionReduced } from "../components/ui";
import { C } from "../constants/colors";
import { motion } from "../constants/ui";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { CartProvider, loadCartStore } from "../context/CartContext";
import { DevModeProvider } from "../context/DevModeContext";
import { getActiveLocationSync, loadLocationStore, LocationProvider } from "../context/LocationContext";
import { ProfileMenuProvider } from "../context/ProfileMenuContext";
import { getAppExtra } from "../lib/appExtra";
import { markBoot, markFontsReady, useNavReady } from "../lib/bootGate";
import { seedCategoriesFromDisk } from "../lib/categoryService";
import { loadDevFlags, useDevFlag } from "../lib/devFlags";
import { loadFeedbackPrefs, warmFeedback } from "../lib/feedback";
import { logSilentFailure } from "../lib/logSilentFailure";
import { startNetworkWatch } from "../lib/network";
import { loadOrderHistoryFlag } from "../lib/orderHistoryFlag";
import { loadPaymentSelection } from "../lib/paymentSelection";
import { prefetchHomeImages, readHomeCatalogCache } from "../lib/productService";
import { loadRecentSearches } from "../lib/recentSearches";
import { seedNearbyFromDisk } from "../lib/storeService";
import { isSupabaseConfigured } from "../lib/supabase";

// ─── Module scope (runs during the native splash) ────────────────────────────

// Sentry (DECISIONS D7): DSN from the inlined env var, else app.config.js `extra.sentryDsn` (typed through
// lib/appExtra — the one sanctioned cast of `extra`). Empty DSN (every local build today) → `enabled: false`, harmless.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || getAppExtra().sentryDsn || "";
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN && !__DEV__,
  tracesSampleRate: 0.2,
  // Updates.channel is null in local Gradle builds and only populated in EAS builds (MAP §7.10).
  environment: Updates.channel ?? "local",
});

// iOS 'modal' presents a UIKit view controller ABOVE every AppShell sibling (toasts, offline banner, dev stripe
// vanish behind it); 'containedModal' (UIModalPresentationCurrentContext) stays inside the Stack's view, so the
// hosts keep painting. Android has no such distinction (CONTRACTS §6.1 rev. 2).
const MODAL = Platform.OS === "ios" ? "containedModal" : "modal";

/** The boot gate's cap: the splash never waits longer than this for index's first `router.replace` (MAP §7.23). */
const BOOT_GATE_CAP_MS = 2000;

// Hold the native splash until auth state is known so we don't flash the app's
// own spinner screen during the AsyncStorage read.
SplashScreen.preventAutoHideAsync().catch(() => {});

markBoot("module-eval");

// Hydrate the "has placed an order?" flag during splash so the payment-options
// screen can decide synchronously whether to show the Preferred Payment empty
// state (first-time user) or a skeleton + fetch (returning user). Without this
// the first visit to payment-options would always flash a skeleton for one
// frame while AsyncStorage resolves.
loadOrderHistoryFlag().catch((err) => logSilentFailure("Hydrate order-history flag", err));

// Module-store hydrations (CONTRACTS §2.1/§2.2/§2.8/§2.19/§3.1/§3.3) — every one is idempotent and never rejects
// in practice; the catch keeps a storage failure from surfacing as an unhandled rejection. The providers do NOT
// self-hydrate: until these resolve `useCart().isHydrated` / `useLocation().isHydrated` stay false by design.
loadFeedbackPrefs().catch((err) => logSilentFailure("Hydrate feedback prefs", err));
loadCartStore().catch((err) => logSilentFailure("Hydrate cart", err));
loadRecentSearches().catch((err) => logSilentFailure("Hydrate recent searches", err));
// kepler (W3 R1-02): the persisted queryCache rows are seeded back into memory (TTL 0, so the first `cached()` still
// revalidates). Categories need nothing; the nearby filter is keyed by the active location, so it waits for the
// location store and seeds only when the single disk row matches that location.
seedCategoriesFromDisk().catch((err) => logSilentFailure("Seed categories from disk", err));
loadLocationStore()
  .then(() => {
    const active = getActiveLocationSync();
    return active ? seedNearbyFromDisk(active.latitude, active.longitude) : undefined;
  })
  .catch((err) => logSilentFailure("Hydrate location", err));
// Payment selection reads Dev_Payment_inhibit_PersistSelection at load time, so it follows the dev flags.
const devFlagsHydrated = loadDevFlags().catch((err) => logSilentFailure("Hydrate dev flags", err));
devFlagsHydrated.then(() => loadPaymentSelection()).catch((err) => logSilentFailure("Hydrate payment selection", err));

// ─── Pre-warm the home catalog cache during splash ──────────────────────────
// This read fires as soon as the dev flags are in (~5 ms; `Dev_Cache_inhibit_HomeCatalog` and
// `Dev_Images_inhibit_Prefetch` must be live before it — W3 R1-12) — still *during* the native splash, in parallel
// with auth restore. By the time the home screen mounts and runs its own `readHomeCatalogCache()`, the OS has the
// SQLite page in disk cache and the JSON parser has been JIT-warmed, so the app's first read takes ~5 ms instead of
// ~150 ms: the home grid paints on the very first frame after the splash hides. Once it resolves, the first nine
// product images are prefetched (speed-and-ease #6) so the grid paints with pictures, not placeholders.
devFlagsHydrated
  .then(() => readHomeCatalogCache())
  .then(() => prefetchHomeImages())
  .catch((err) => logSilentFailure("Pre-warm home catalog cache", err));

// Cobalt: expo-network listener + periodic recheck; idempotent (the hooks also self-start it).
startNetworkWatch();

// ─── Shell ──────────────────────────────────────────────────────────────────

function AppShell() {
  const { isLoading, isAuthenticated, userId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const navReady = useNavReady();
  // The same reduced-motion source every primitive uses (OS toggle + the Onyx dev flags), not reanimated's
  // startup-only `useReducedMotion()` (W3 R6-12 / R4-11).
  const reduced = useMotionReduced();
  // cobalt (W3 R3-05): while the offline band occupies the top of the shell column, the screens below start under
  // it, so their top safe-area inset is zeroed through the context (native SafeAreaView measures itself anyway).
  const [offlineBannerVisible, setOfflineBannerVisible] = useState(false);
  const shellInsets = useMemo(() => (offlineBannerVisible ? { ...insets, top: 0 } : insets), [insets, offlineBannerVisible]);
  // Both zephyr flags are read LIVE (no restart): the Stack re-renders with new options on change.
  const transitionsOff = useDevFlag("Dev_Zephyr_inhibit_Transitions");
  const zephyrOff = useDevFlag("Dev_Zephyr_inhibit_Feature");

  // App-wide typeface — five faces (the Light face is no longer loaded; nothing renders it). Splash stays up
  // until faces are ready so no screen ever paints in the system font first; fontError falls back gracefully
  // (styles keep working — RN just uses the platform font).
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // One-shot cap for the boot gate: if index's first replace has not happened within 2 s (it always should),
  // the splash hides anyway — it must never wait on anything that can stall (MAP §7.23).
  const [gateElapsed, setGateElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGateElapsed(true), BOOT_GATE_CAP_MS);
    return () => clearTimeout(timer);
  }, []);

  // Fonts settled (loaded OR errored — styles keep working either way): publish it to the boot gate so index can
  // wait for it and the boot timeline stamps `fonts-ready` at the right moment (W3 R1-14 / R6-17).
  useEffect(() => {
    if (fontsLoaded || fontError) markFontsReady();
  }, [fontsLoaded, fontError]);

  // Splash hide = auth known + fonts settled + (navigation committed to Home/phone OR the 2 s cap). Waiting for
  // nav-ready means the user never sees the `index` frame between the native splash and Home. Known residual:
  // with corrupt `userData` and no network the splash can still show for up to 6 s — that is AuthContext's
  // 6 s profile race (MAP §7.23), not this gate. After the hide: warm the feedback players (never on the
  // isLoading path) and record the boot mark.
  const splashHiddenRef = useRef(false);
  useEffect(() => {
    if (splashHiddenRef.current) return;
    if (!isLoading && (fontsLoaded || fontError) && (navReady || gateElapsed)) {
      splashHiddenRef.current = true;
      SplashScreen.hideAsync()
        .catch(() => {})
        .then(() => {
          warmFeedback();
          markBoot("splash-hidden");
        });
    }
  }, [isLoading, fontsLoaded, fontError, navReady, gateElapsed]);

  // Session can expire (25 days of inactivity) while the user is deep in the
  // app, not just at cold start — app/index.tsx only handles the cold-start
  // redirect. Catch the true→false transition here, from wherever they are.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true;
    } else if (wasAuthenticated.current && !isLoading) {
      wasAuthenticated.current = false;
      // A 401 deep in the app (apiClient → clearStoredSession) must not leave the previous user's screens under
      // /phone: unwind to the root first (a no-op when only the tabs route exists — W3 R6-06).
      if (router.canDismiss()) router.dismissAll();
      router.replace("/phone");
    }
  }, [isAuthenticated, isLoading, router]);

  // zephyr (M16): slide_from_right by default, fade under reduced motion, none under the Transitions flag;
  // index/welcome always fade; the four sheet-like routes present as modals and slide from the bottom (Android
  // would otherwise inherit slide_from_right for them — W3 R6-10). Under Dev_Zephyr_inhibit_Feature the Stack
  // renders with react-navigation's defaults and no per-route options. `animationDuration` is honoured only by
  // the iOS fade / bottom-sheet-class transitions; slide_from_right on iOS and every Android transition keep the
  // platform default (W3 R6-18).
  const animation = transitionsOff ? "none" : reduced ? "fade" : "slide_from_right";
  const modalAnimation = transitionsOff ? "none" : reduced ? "fade" : "slide_from_bottom";

  return (
    <CartProvider>
      <LocationProvider>
        <ProfileMenuProvider>
          <DevModeProvider>
            <View style={styles.shell}>
              <StatusBar style="dark" />
              {/* cobalt: IN FLOW above the Stack so content shifts by the band instead of losing its header (W3 R3-05);
                  the band pays the status-bar inset itself and the Stack's top inset is zeroed while it shows. */}
              <OfflineBanner topInset={insets.top} onVisibleChange={setOfflineBannerVisible} />
              <SafeAreaInsetsContext.Provider value={shellInsets}>
                <View style={styles.shell}>
                  <Stack
                    screenOptions={
                      zephyrOff
                        ? { headerShown: false }
                        : { headerShown: false, animation, animationDuration: motion.duration.base }
                    }
                  >
                    {zephyrOff ? null : (
                      <>
                        <Stack.Screen name="index" options={{ animation: "fade" }} />
                        <Stack.Screen name="welcome" options={{ animation: "fade" }} />
                        <Stack.Screen name="select-location" options={{ presentation: MODAL, animation: modalAnimation }} />
                        <Stack.Screen name="product/coupons" options={{ presentation: MODAL, animation: modalAnimation }} />
                        <Stack.Screen name="support/payment-options" options={{ presentation: MODAL, animation: modalAnimation }} />
                        <Stack.Screen name="notification-preferences" options={{ presentation: MODAL, animation: modalAnimation }} />
                      </>
                    )}
                  </Stack>
                </View>
              </SafeAreaInsetsContext.Provider>
              {/* cyan: mounted exactly once; it computes its own tab-bar offset from the pathname. */}
              <CartBar />
              {/* vulcan: a plain absolute View (NOT a Modal) — it paints above the CartBar and never blocks touches. */}
              <ToastHost />
              {/* Push registration + deep links live in a leaf so AppShell never re-renders on navigation state (P29). */}
              <PushBootstrap userId={userId} />
              {/* Boot gate from the root navigation state for URL cold starts where index never mounts (W3 R6-09). */}
              <NavReadyProbe />
            </View>
          </DevModeProvider>
        </ProfileMenuProvider>
      </LocationProvider>
    </CartProvider>
  );
}

function RootLayout() {
  // Fail fast and visibly instead of silently limping into a broken app
  // where every screen's Supabase call mysteriously fails one at a time —
  // see lib/supabase.ts's isSupabaseConfigured for the reasoning.
  // No Jakarta fontFamily here: this renders before useFonts resolves (C45).
  if (!isSupabaseConfigured) {
    SplashScreen.hideAsync().catch(() => {});
    return (
      <View style={styles.configErrorContainer}>
        <Text style={styles.configErrorTitle}>Configuration error</Text>
        <Text style={styles.configErrorText}>
          This app is missing required configuration and can&apos;t start. Please contact support.
        </Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.shell}>
        <SafeAreaProvider>
          <MotionConfig>
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          </MotionConfig>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  shell: { flex: 1 },
  configErrorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: C.card,
  },
  configErrorTitle: {
    fontSize: 20,
    color: C.text,
    marginBottom: 12,
    textAlign: "center",
    maxWidth: 360,
  },
  configErrorText: {
    fontSize: 15,
    color: C.textSub,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 360,
  },
});
