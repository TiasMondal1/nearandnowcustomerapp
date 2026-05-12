import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  bark: "#3C2F1E",
  barkLight: "#A89282",
  white: "#FFFFFF",
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
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* ── Logo ─── */}
        <View style={styles.logoSection}>
          <Image
            source={require("../assets/near_now_image.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {/* ── Location card ─── */}
        <View style={styles.locationCard}>
          <View style={styles.locationIconCircle}>
            <MaterialCommunityIcons
              name={getLocationIcon(displayLabel)}
              size={26}
              color={T.green}
            />
          </View>

          {displayLabel ? (
            <Text style={styles.locationLabel}>{displayLabel}</Text>
          ) : isNewUser && !gpsAddress ? (
            <Text style={styles.locationLabel}>Detecting location…</Text>
          ) : (
            <Text style={styles.locationLabel}>Your location</Text>
          )}

          {displayAddress ? (
            <Text style={styles.locationAddress} numberOfLines={3}>
              {displayAddress}
            </Text>
          ) : isNewUser && !gpsAddress ? (
            <ActivityIndicator size="small" color={T.green} style={{ marginTop: 4 }} />
          ) : null}

          {!isHydrated && (
            <ActivityIndicator size="small" color={T.green} style={{ marginTop: 4 }} />
          )}
        </View>

        <ActivityIndicator size="small" color={T.green} style={styles.spinner} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.white },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 28,
  },
  logoSection: {
    alignItems: "center",
  },
  logoImage: {
    width: 220,
    height: 200,
  },
  locationCard: {
    width: "100%",
    backgroundColor: T.white,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  locationIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  locationLabel: {
    fontSize: 18,
    fontWeight: "800",
    color: T.bark,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  locationAddress: {
    fontSize: 13,
    color: T.barkLight,
    textAlign: "center",
    lineHeight: 19,
    fontWeight: "500",
    marginTop: 2,
  },
  spinner: { marginTop: 12 },
});
