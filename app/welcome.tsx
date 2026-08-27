import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    Animated,
    Image,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { IconWrap, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
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

/** Fade in + 12px rise, driven by a 0→1 Animated.Value. */
const rise = (v: Animated.Value) => ({
  opacity: v,
  transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
});

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

  // Entrance motion for the greeting and location bands (staggered). Purely
  // visual and independent of the auto-advance timer above.
  const [greetAnim] = useState(() => new Animated.Value(0));
  const [locationAnim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const entrance = Animated.stagger(120, [
      Animated.timing(greetAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(locationAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [greetAnim, locationAnim]);

  return (
    <Screen bg={C.card}>
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
        <Animated.View style={[styles.greetSection, rise(greetAnim)]}>
          <Text style={styles.greetTitle} accessibilityRole="header">
            Welcome{user ? `, ${firstName}` : ""}!
          </Text>
          <Text style={styles.greetSub}>You&apos;re all set to start shopping.</Text>
        </Animated.View>

        {/* Location */}
        <Animated.View style={[styles.locationSection, rise(locationAnim)]}>
          <IconWrap
            size={56}
            circle
            bg={T.greenXLight}
            icon={getLocationIcon(displayLabel)}
            iconSize={26}
            iconColor={T.green}
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
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    color: T.bark,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  greetSub: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 14, color: T.barkLight, textAlign: "center" },

  locationSection: { alignItems: "center", gap: 8, width: "100%" },
  locationIconCircle: { marginBottom: 4 },
  locationLabel: { fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 18,
    color: T.bark,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  locationAddress: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 13,
    color: T.barkLight,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 16,
  },
});
