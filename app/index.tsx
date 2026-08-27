import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";

import { IconWrap, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  bark: "#3C2F1E",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.08)",
};

function getLocationIcon(label: string | null): keyof typeof MaterialCommunityIcons.glyphMap {
  if (!label) return "map-marker-outline";
  const l = label.toLowerCase();
  if (l.includes("home")) return "home-outline";
  if (l.includes("work") || l.includes("office")) return "office-building-outline";
  if (l.includes("hotel")) return "bed-outline";
  return "map-marker-outline";
}

export default function SplashScreen() {
  const { isLoading, isAuthenticated } = useAuth();
  const { location, isHydrated } = useLocation();
  const [gpsAddress, setGpsAddress] = useState<string | null>(null);
  const gpsAttempted = useRef(false);

  // For new users with no saved location, try to get GPS address
  useEffect(() => {
    if (!isHydrated || location || gpsAttempted.current) return;
    gpsAttempted.current = true;
    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        const [result] = await ExpoLocation.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (result) {
          const parts = [result.name, result.street, result.district, result.city].filter(Boolean);
          setGpsAddress(parts.slice(0, 3).join(", ") || result.city || "Your location");
        }
      } catch {
        // silently ignore
      }
    })();
  }, [isHydrated, location]);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace("/(tabs)/home");
    } else {
      router.replace("/phone");
    }
  }, [isLoading, isAuthenticated]);

  const displayLabel = location?.label ?? null;
  const displayAddress = location?.address ?? gpsAddress;
  const isNewUser = isHydrated && !location;

  return (
    <Screen bg={C.card}>
      <View style={styles.container}>
        {/* ── Logo — sized to land where the native splash (imageWidth 240) drew it ─── */}
        <View style={styles.logoSection}>
          <Image
            source={require("../assets/near_now_image.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {/* ── Location card ─── */}
        <View style={styles.locationCard}>
          <IconWrap
            size={56}
            circle
            bg={T.greenXLight}
            icon={getLocationIcon(displayLabel)}
            iconSize={26}
            iconColor={T.green}
            style={styles.locationIconCircle}
          />

          {displayLabel ? (
            <Text style={styles.locationLabel} numberOfLines={1}>{displayLabel}</Text>
          ) : isNewUser && !gpsAddress ? (
            <Text style={styles.locationLabel} numberOfLines={1}>Detecting location…</Text>
          ) : (
            <Text style={styles.locationLabel} numberOfLines={1}>Your location</Text>
          )}

          {displayAddress ? (
            <Text style={styles.locationAddress} numberOfLines={3}>
              {displayAddress}
            </Text>
          ) : isNewUser && !gpsAddress ? (
            <ActivityIndicator size="small" color={T.green} style={styles.cardSpinner} accessibilityLabel="Loading" />
          ) : null}

          {!isHydrated && (
            <ActivityIndicator size="small" color={T.green} style={styles.cardSpinner} accessibilityLabel="Loading" />
          )}
        </View>

        <ActivityIndicator size="small" color={T.green} style={styles.spinner} accessibilityLabel="Loading" />
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
    gap: 32,
  },
  logoSection: {
    alignItems: "center",
  },
  logoImage: {
    width: 240,
    height: 218,
  },
  locationCard: {
    width: "100%",
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  locationIconCircle: { marginBottom: 8 },
  locationLabel: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.bark,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  locationAddress: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 13,
    color: T.barkLight,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 4,
  },
  cardSpinner: { marginTop: 4 },
  spinner: { marginTop: 12 },
});
