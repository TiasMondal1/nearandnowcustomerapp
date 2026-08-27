import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { PrimaryButton, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { sendOTP } from "../lib/authService";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PhoneScreen() {
  const params = useLocalSearchParams();
  const prefillPhone = typeof params.phone === "string" ? params.phone : "";

  const [phone, setPhone] = useState(prefillPhone);
  const [email, setEmail] = useState("");
  const [loadingOtp, setLoadingOtp] = useState(false);
  // Visual only — drives the focused border on whichever field is active.
  const [focus, setFocus] = useState<"phone" | "email" | null>(null);

  const onlyDigits = (value: string) => value.replace(/[^0-9]/g, "");

  const handleChange = (value: string) => {
    const digits = onlyDigits(value).slice(0, 10);
    setPhone(digits);
  };

  const emailValid = EMAIL_REGEX.test(email.trim());
  // This screen serves both login and signup, and we don't know which one
  // this phone number is until after OTP verification — so email can't be
  // force-required here without also nagging returning users on every login.
  // The backend enforces email as mandatory for brand-new signups (see
  // auth.controller.ts); otp.tsx sends the user back here to fill it in if
  // that happens. No verification is required at this point — only capture.
  const isValid = phone.length === 10 && (email.trim().length === 0 || emailValid);

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
    <Screen bg={C.card}>
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
            <Text style={styles.title} accessibilityRole="header">Let&apos;s get you in</Text>
            <Text style={styles.subtitle}>Enter your phone number to continue</Text>

            <View style={[styles.phoneRow, focus === "phone" && styles.inputFocused]}>
              <View style={styles.countryCodeContainer}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={handleChange}
                placeholder="XXXXXXXXXX"
                placeholderTextColor={C.textLight}
                keyboardType="number-pad"
                maxLength={10}
                accessibilityLabel="Phone number"
                onFocus={() => setFocus("phone")}
                onBlur={() => setFocus(null)}
              />
            </View>
            <Text style={styles.helperText}>
              We&apos;ll send you a one-time code to verify your number.
            </Text>

            <TextInput
              style={[styles.emailInput, focus === "email" && styles.inputFocused]}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              placeholderTextColor={C.textLight}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Email address"
              onFocus={() => setFocus("email")}
              onBlur={() => setFocus(null)}
            />
            <Text style={styles.helperText}>
              Used for order receipts. You can verify it after logging in.
            </Text>
          </View>

          {/* Bottom */}
          <View style={styles.bottomSection}>
            <PrimaryButton
              label={loadingOtp ? "Sending…" : "Continue with OTP"}
              onPress={handleContinueWithOtp}
              disabled={!isValid || loadingOtp}
              shadow
              style={(!isValid || loadingOtp) && styles.ctaDisabled}
              textStyle={styles.ctaText}
            />

            <Text style={styles.termsText}>
              By continuing, you agree to our{" "}
              <Text
                style={styles.termsLink}
                accessibilityRole="link"
                onPress={() => router.push("/settings/terms")}
              >
                Terms
              </Text>{" "}
              &amp;{" "}
              <Text
                style={styles.termsLink}
                accessibilityRole="link"
                onPress={() => router.push("/settings/terms")}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    justifyContent: "space-between",
  },

  logoSection: {
    alignItems: "center",
    paddingTop: 4,
  },
  logo: {
    width: 160,
    height: 145,
  },

  inputBlock: { gap: 8 },
  title: {
    fontSize: 28,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.text,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14, color: C.textSub },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 52,
    marginTop: 8,
  },
  inputFocused: { borderColor: C.primary },
  countryCodeContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginRight: 8,
  },
  countryCodeText: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.text, fontSize: 16 },
  phoneInput: { fontFamily: "PlusJakartaSans_500Medium",
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: C.text,
    letterSpacing: 1,
  },
  helperText: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, color: C.textSub },
  emailInput: { fontFamily: "PlusJakartaSans_400Regular",
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
    fontSize: 15,
    color: C.text,
    marginTop: 12,
  },

  bottomSection: { gap: 16 },
  ctaDisabled: { shadowOpacity: 0, elevation: 0 },
  ctaText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 },
  termsText: { fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 12,
    color: C.textLight,
    textAlign: "center",
    lineHeight: 18,
    paddingVertical: 4,
  },
  termsLink: { color: C.primary },
});
