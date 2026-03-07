import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../constants/colors";

export default function LoginPasswordScreen() {
  const params = useLocalSearchParams();

  const rawPhone = typeof params.phone === "string" ? params.phone : "";
  const phone = rawPhone || "";

  const rawEmail = typeof params.email === "string" ? params.email : "";
  const [email, setEmail] = useState(rawEmail || "");

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = email.trim().includes("@") && password.trim().length >= 6;

  const handleLogin = async () => {
    if (!isValid || loading) return;
    try {
      setLoading(true);
      Alert.alert(
        "Not supported",
        "Password login is not available. Please use OTP login.",
      );
      router.replace("/phone");
    } catch {
      Alert.alert("Error", "Login failed");
    } finally {
      setLoading(false);
    }
  };


  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.pageName}>Login</Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Login with your password instead of an OTP.
            </Text>

            <View style={styles.phoneChip}>
              <Text style={styles.phoneChipLabel}>Phone</Text>
              <Text style={styles.phoneChipValue}>
                {phone || "+91 ••••••••••"}
              </Text>
            </View>
          </View>

          <View style={styles.form}>
            <View style={styles.inputBlock}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.textInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => Alert.alert("Coming soon", "Reset password flow")}
            >
              <Text style={styles.linkText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={isValid && !loading ? 0.85 : 1}
              onPress={handleLogin}
              disabled={!isValid || loading}
              style={[
                styles.button,
                (!isValid || loading) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {loading ? "Logging in..." : "Login"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backRow}
              onPress={() => router.back()}
            >
              <Text style={styles.backText}>Back to OTP login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.bg,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    justifyContent: "space-between",
  },
  header: {
    paddingTop: 24,
    gap: 8,
  },
  pageName: {
    fontSize: 11,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: "600",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#1f2937",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
  },
  phoneChip: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  phoneChipLabel: {
    fontSize: 10,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  phoneChipValue: {
    fontSize: 14,
    color: "#1f2937",
    marginTop: 2,
    fontWeight: "600",
  },
  form: {
    marginTop: 32,
    gap: 12,
  },
  inputBlock: {
    width: "100%",
  },
  label: {
    fontSize: 13,
    color: "#4b5563",
    marginBottom: 6,
    fontWeight: "600",
  },
  textInput: {
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#1f2937",
    fontSize: 15,
  },
  linkRow: {
    marginTop: 4,
    alignItems: "flex-end",
  },
  linkText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: "600",
  },
  bottomSection: {
    gap: 10,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  backRow: {
    alignItems: "center",
  },
  backText: {
    fontSize: 12,
    color: "#6b7280",
  },
});
