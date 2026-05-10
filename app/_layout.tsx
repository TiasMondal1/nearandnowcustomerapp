import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { LocationProvider } from "../context/LocationContext";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { loadOrderHistoryFlag } from "../lib/orderHistoryFlag";
import { readHomeCatalogCache } from "../lib/productService";

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
readHomeCatalogCache().catch(() => {});

// Hydrate the "has placed an order?" flag during splash so the payment-options
// screen can decide synchronously whether to show the Preferred Payment empty
// state (first-time user) or a skeleton + fetch (returning user). Without this
// the first visit to payment-options would always flash a skeleton for one
// frame while AsyncStorage resolves.
loadOrderHistoryFlag().catch(() => {});

function AppShell() {
  const { isLoading, userId } = useAuth();
  usePushNotifications(userId);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  return (
    <CartProvider>
      <LocationProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </LocationProvider>
    </CartProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
