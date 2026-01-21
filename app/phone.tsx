// app/phone.tsx
import { router } from "expo-router";
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

const PRIMARY = "#765fba";
const API_BASE = "http://192.168.1.117:3001";

export default function PhoneScreen() {
  const [phone, setPhone] = useState("");
  const [loadingOtp, setLoadingOtp] = useState(false);

  const onlyDigits = (value: string) => value.replace(/[^0-9]/g, "");

  const handleChange = (value: string) => {
    const digits = onlyDigits(value).slice(0, 10);
    setPhone(digits);
  };

  const isValid = phone.length === 10;

  const handleContinueWithOtp = async () => {
    if (!isValid || loadingOtp) return;
    const fullPhone = `+91${phone}`;
    try {
      setLoadingOtp(true);
      const res = await fetch(`${API_BASE}/auth/phone/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        Alert.alert("Error", json.error || "Failed to start verification");
        return;
      }
      router.push({
        pathname: "/otp",
        params: {
          phone: fullPhone,
          sessionId: json.sessionId,
          exists: json.exists ? "true" : "false",
        },
      });
    } catch {
      Alert.alert("Error", "Network error. Try again.");
    } finally {
      setLoadingOtp(false);
    }
  };

  const handleContinueWithPassword = () => {
    if (!isValid) return;
    const fullPhone = `+91${phone}`;
    router.push({
      pathname: "/login-password",
      params: { phone: fullPhone },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.container}>
          <View style={styles.topSection}>
            <Text style={styles.title}>Let&apos;s get you in</Text>
            <Text style={styles.subtitle}>
              Enter your phone number to continue
            </Text>
          </View>

          <View style={styles.inputBlock}>
            <Text style={styles.label}>Phone number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryCodeContainer}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={handleChange}
                placeholder="XXXXXXXXXX"
                placeholderTextColor="#8278A6"
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            <Text style={styles.helperText}>
              We’ll send you a one-time code to verify your number.
            </Text>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={isValid && !loadingOtp ? 0.85 : 1}
              onPress={handleContinueWithOtp}
              style={[
                styles.primaryButton,
                (!isValid || loadingOtp) && styles.buttonDisabled,
              ]}
              disabled={!isValid || loadingOtp}
            >
              <Text style={styles.primaryButtonText}>
                {loadingOtp ? "Sending..." : "Continue with OTP"}
              </Text>
            </TouchableOpacity>

            <View style={styles.separatorRow}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorText}>or</Text>
              <View style={styles.separatorLine} />
            </View>

            <TouchableOpacity
              activeOpacity={isValid ? 0.85 : 1}
              onPress={handleContinueWithPassword}
              style={[
                styles.secondaryButton,
                !isValid && styles.secondaryButtonDisabled,
              ]}
              disabled={!isValid}
            >
              <Text style={styles.secondaryButtonText}>
                Login with password
              </Text>
            </TouchableOpacity>

            <Text style={styles.termsText}>
              By continuing, you agree to our{" "}
              <Text style={styles.termsLink}>Terms</Text> &{" "}
              <Text style={styles.termsLink}>Privacy Policy</Text>.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const PRIMARY_BG = "#05030A";

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PRIMARY_BG,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    justifyContent: "space-between",
  },
  topSection: {
    paddingTop: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#C4BDEA",
  },
  inputBlock: {
    marginTop: 32,
  },
  label: {
    fontSize: 13,
    color: "#B3A9E6",
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countryCodeContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1A1234",
    borderWidth: 1,
    borderColor: "#4A3A80",
    marginRight: 8,
  },
  countryCodeText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  phoneInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: "#FFFFFF",
    letterSpacing: 1,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: "#8278A6",
  },
  bottomSection: {
    gap: 14,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  buttonDisabled: {
    backgroundColor: "rgba(118, 95, 186, 0.45)",
  },
  separatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#2C2346",
  },
  separatorText: {
    fontSize: 11,
    color: "#7E74B0",
  },
  secondaryButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1234",
    borderWidth: 1,
    borderColor: "#4A3A80",
  },
  secondaryButtonDisabled: {
    backgroundColor: "#100B21",
    borderColor: "#2D244C",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#E0DAFF",
  },
  termsText: {
    fontSize: 11,
    color: "#9C94D7",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
  termsLink: {
    color: "#DAD1FF",
    fontWeight: "600",
  },
});
