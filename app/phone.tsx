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
import { sendOTP } from "../lib/authService";

const PRIMARY = "#059669";

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
      await sendOTP(fullPhone);
      router.push({
        pathname: "/otp",
        params: { phone: fullPhone },
      });
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to send OTP. Try again.");
    } finally {
      setLoadingOtp(false);
    }
  };

  const handleContinueWithPassword = () => {
    if (!isValid) return;
    const fullPhone = `+91${phone}`;
    router.push({ pathname: "/login-password", params: { phone: fullPhone } });
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
                placeholderTextColor="#9ca3af"
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

const PRIMARY_BG = "#f9fafb";

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
    color: "#1f2937",
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#6b7280",
  },
  inputBlock: {
    marginTop: 32,
  },
  label: {
    fontSize: 13,
    color: "#4b5563",
    marginBottom: 8,
    fontWeight: "600",
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countryCodeContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginRight: 8,
  },
  countryCodeText: {
    color: "#1f2937",
    fontSize: 14,
    fontWeight: "600",
  },
  phoneInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: "#1f2937",
    letterSpacing: 1,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
  bottomSection: {
    gap: 14,
  },
  primaryButton: {
    borderRadius: 12,
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
    backgroundColor: "rgba(5, 150, 105, 0.45)",
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
    backgroundColor: "#e5e7eb",
  },
  separatorText: {
    fontSize: 11,
    color: "#6b7280",
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#e5e7eb",
  },
  secondaryButtonDisabled: {
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1f2937",
  },
  termsText: {
    fontSize: 11,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
  termsLink: {
    color: PRIMARY,
    fontWeight: "600",
  },
});
