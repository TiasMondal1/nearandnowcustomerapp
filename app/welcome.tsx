import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect } from "react";
import {
    Image,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bark: "#3C2F1E",
  barkLight: "#A89282",
};

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

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const displayLabel = location?.label ?? null;
  const displayAddress = location?.address ?? null;

  // Always navigate to home after exactly 2s — no dependencies so this fires
  // once on mount and is never reset by state changes.
  useEffect(() => {
    const timer = setTimeout(() => router.replace("/(tabs)/home"), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Logo */}
        <View style={styles.logoSection}>
          <Image
            source={require("../assets/near_now_image.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* Greeting */}
        <View style={styles.greetSection}>
          <Text style={styles.greetTitle}>Welcome{user ? `, ${firstName}` : ""}!</Text>
          <Text style={styles.greetSub}>You&apos;re all set to start shopping.</Text>
        </View>

        {/* Location */}
        <View style={styles.locationSection}>
          <View style={styles.locationIconCircle}>
            <MaterialCommunityIcons
              name={getLocationIcon(displayLabel)}
              size={26}
              color={T.green}
            />
          </View>
          <Text style={styles.locationLabel}>
            {displayLabel ?? "Your location"}
          </Text>
          {displayAddress ? (
            <Text style={styles.locationAddress} numberOfLines={3}>
              {displayAddress}
            </Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.white },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 28,
    paddingVertical: 32,
  },

  logoSection: { alignItems: "center" },
  logo: { width: 210, height: 190 },

  greetSection: { alignItems: "center", gap: 6 },
  greetTitle: { fontSize: 26, fontWeight: "900", color: T.bark, letterSpacing: -0.4 },
  greetSub: { fontSize: 14, color: T.barkLight, fontWeight: "500" },

  locationSection: { alignItems: "center", gap: 8, width: "100%" },
  locationIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  locationLabel: {
    fontSize: 17,
    fontWeight: "800",
    color: T.bark,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  locationAddress: {
    fontSize: 13,
    color: T.barkLight,
    textAlign: "center",
    lineHeight: 19,
    fontWeight: "500",
    paddingHorizontal: 16,
  },
});
