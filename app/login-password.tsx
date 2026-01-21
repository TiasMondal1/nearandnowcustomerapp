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
import { saveSession } from "../session";

const PRIMARY = "#765fba";
const BG = "#05030A";
const API_BASE = "http://192.168.1.117:3001";

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

      const res = await fetch(`${API_BASE}/auth/password/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        Alert.alert("Error", json.error || "Login failed");
        return;
      }

      if (json.token && json.user) {
        await saveSession({
          token: json.token,
          user: {
            id: json.user.id,
            name: json.user.name,
            role: json.user.role,
            isActivated:
              json.user.isActivated ?? json.user.is_activated ?? false,
            phone: json.user.phone ?? phone,
          },
        });
      }

      router.replace("/(tabs)/home");
    } catch {
      Alert.alert("Error", "Network error, please try again.");
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
                placeholderTextColor="#8278A6"
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
                placeholderTextColor="#8278A6"
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
    backgroundColor: BG,
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
    color: "#9C94D7",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: "#C4BDEA",
  },
  phoneChip: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
  },
  phoneChipLabel: {
    fontSize: 10,
    color: "#9C94D7",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  phoneChipValue: {
    fontSize: 14,
    color: "#FFFFFF",
    marginTop: 2,
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
    color: "#B3A9E6",
    marginBottom: 6,
  },
  textInput: {
    borderRadius: 14,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#FFFFFF",
    fontSize: 15,
  },
  linkRow: {
    marginTop: 4,
    alignItems: "flex-end",
  },
  linkText: {
    fontSize: 12,
    color: PRIMARY,
    fontWeight: "500",
  },
  bottomSection: {
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
  },
  buttonDisabled: {
    backgroundColor: "rgba(118, 95, 186, 0.45)",
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
    color: "#C4BDEA",
  },
});
