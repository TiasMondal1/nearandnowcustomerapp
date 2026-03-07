import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";

export default function SplashScreen() {
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace("/(tabs)/home");
    } else {
      router.replace("/phone");
    }
  }, [isLoading, isAuthenticated]);

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Near &amp; Now</Text>
      <Text style={styles.tagline}>Digital Dukan, Local Dil Se</Text>
      <ActivityIndicator
        size="small"
        color={C.primary}
        style={styles.spinner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: C.primary,
    letterSpacing: 0.5,
  },
  tagline: {
    marginTop: 8,
    fontSize: 14,
    color: C.textSub,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  spinner: {
    marginTop: 40,
  },
});
