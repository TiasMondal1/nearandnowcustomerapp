import {
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { C } from "../constants/colors";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { LocationProvider } from "../context/LocationContext";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { logSilentFailure } from "../lib/logSilentFailure";
import { loadOrderHistoryFlag } from "../lib/orderHistoryFlag";
import { readHomeCatalogCache } from "../lib/productService";
import { isSupabaseConfigured } from "../lib/supabase";

// Hold the native splash until auth state is known so we don't flash the app's
// own spinner screen during the AsyncStorage read.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ─── Pre-warm the home catalog cache during splash ──────────────────────────
// This single read fires the moment the JS bundle is parsed — *during* the
// native splash screen, in parallel with auth restore. By the time the home
// screen mounts and runs its own `readHomeCatalogCache()`, the OS has the
// SQLite page in disk cache and the JSON parser has been JIT-warmed, so the
// app's first read takes ~5 ms instead of ~150 ms. Result: the home grid
// paints on the very first frame after splash hides, instead of one frame
// later.
readHomeCatalogCache().catch((err) => logSilentFailure("Pre-warm home catalog cache", err));

// Hydrate the "has placed an order?" flag during splash so the payment-options
// screen can decide synchronously whether to show the Preferred Payment empty
// state (first-time user) or a skeleton + fetch (returning user). Without this
// the first visit to payment-options would always flash a skeleton for one
// frame while AsyncStorage resolves.
loadOrderHistoryFlag().catch((err) => logSilentFailure("Hydrate order-history flag", err));

function AppShell() {
  const { isLoading, isAuthenticated, userId } = useAuth();
  const router = useRouter();
  usePushNotifications(userId);

  // App-wide typeface. Splash stays up until faces are ready so no screen
  // ever paints in the system font first; fontError falls back gracefully
  // (styles keep working — RN just uses the platform font).
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_300Light,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (!isLoading && (fontsLoaded || fontError)) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading, fontsLoaded, fontError]);

  // Session can expire (25 days of inactivity) while the user is deep in the
  // app, not just at cold start — app/index.tsx only handles the cold-start
  // redirect. Catch the true→false transition here, from wherever they are.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true;
    } else if (wasAuthenticated.current && !isLoading) {
      wasAuthenticated.current = false;
      router.replace("/phone");
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <CartProvider>
      <LocationProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </LocationProvider>
    </CartProvider>
  );
}

export default function RootLayout() {
  // Fail fast and visibly instead of silently limping into a broken app
  // where every screen's Supabase call mysteriously fails one at a time —
  // see lib/supabase.ts's isSupabaseConfigured for the reasoning.
  if (!isSupabaseConfigured) {
    SplashScreen.hideAsync().catch(() => {});
    return (
      <View style={styles.configErrorContainer}>
        <Text style={styles.configErrorTitle}>Configuration Error</Text>
        <Text style={styles.configErrorText}>
          This app is missing required configuration and can&apos;t start. Please contact support.
        </Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  configErrorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: C.card,
  },
  configErrorTitle: {
    fontSize: 20,
    fontFamily: "PlusJakartaSans_700Bold",
    marginBottom: 12,
    textAlign: "center",
    maxWidth: 360,
  },
  configErrorText: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 360,
  },
});
