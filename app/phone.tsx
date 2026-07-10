import { router } from "expo-router";
import React, { useState } from "react";
import {
    Alert,
    Image,
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
import { sendOTP } from "../lib/authService";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PhoneScreen() {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loadingOtp, setLoadingOtp] = useState(false);

  const onlyDigits = (value: string) => value.replace(/[^0-9]/g, "");

  const handleChange = (value: string) => {
    const digits = onlyDigits(value).slice(0, 10);
    setPhone(digits);
  };

  const emailValid = EMAIL_REGEX.test(email.trim());
  const isValid = phone.length === 10 && emailValid;

  const handleContinueWithOtp = async () => {
    if (!isValid || loadingOtp) return;
    const fullPhone = `+91${phone}`;
    try {
      setLoadingOtp(true);
      await sendOTP(fullPhone);
      router.push({
        pathname: "/otp",
        params: { phone: fullPhone, email: email.trim() },
      });
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to send OTP. Try again.");
    } finally {
      setLoadingOtp(false);
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
          {/* Logo */}
          <View style={styles.logoSection}>
            <Image
              source={require("../assets/near_now_image.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Input */}
          <View style={styles.inputBlock}>
            <Text style={styles.title}>Let&apos;s get you in</Text>
            <Text style={styles.subtitle}>Enter your phone number to continue</Text>

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
              We&apos;ll send you a one-time code to verify your number.
            </Text>

            <TextInput
              style={styles.emailInput}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>
              Used for order receipts. You can verify it after logging in.
            </Text>
          </View>

          {/* Bottom */}
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
                {loadingOtp ? "Sending…" : "Continue with OTP"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.termsText}>
              By continuing, you agree to our{" "}
              <Text style={styles.termsLink}>Terms</Text> &amp;{" "}
              <Text style={styles.termsLink}>Privacy Policy</Text>.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFFFFF" },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 36,
    justifyContent: "space-between",
  },

  logoSection: {
    alignItems: "center",
    paddingTop: 16,
  },
  logo: {
    width: 200,
    height: 180,
  },

  inputBlock: { gap: 10 },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1f2937",
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  subtitle: { fontSize: 14, color: "#6b7280" },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
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
  countryCodeText: { color: "#1f2937", fontSize: 14, fontWeight: "600" },
  phoneInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: "#1f2937",
    letterSpacing: 1,
  },
  helperText: { fontSize: 12, color: "#6b7280" },
  emailInput: {
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1f2937",
    marginTop: 12,
  },

  bottomSection: { gap: 14 },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  buttonDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  termsText: {
    fontSize: 11,
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: 16,
  },
  termsLink: { color: C.primary, fontWeight: "600" },
});
