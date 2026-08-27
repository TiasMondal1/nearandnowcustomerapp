import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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

import { PrimaryButton, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";

// Text-link hit areas — top slop stays inside the gap to the element above
// so it never overlaps the code boxes / Verify button (see otp.tsx).
const LINK_HIT_SLOP = { top: 8, bottom: 12, left: 16, right: 16 };

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams();
  const email = typeof params.email === "string" ? params.email : "";

  const { verifyEmailCode, resendEmailCode } = useAuth();

  const [digits, setDigits] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const inputsRef = useRef<Array<TextInput | null>>([]);

  const handleChangeDigit = (value: string, index: number) => {
    const clean = value.replace(/[^0-9]/g, "");
    const updated = [...digits];
    if (!clean) {
      updated[index] = "";
      setDigits(updated);
      return;
    }
    updated[index] = clean[clean.length - 1];
    setDigits(updated);
    if (index < 3) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && digits[index] === "" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const code = digits.join("");

  useEffect(() => {
    if (code.length === 4 && !loading) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const handleVerify = async () => {
    if (code.length !== 4 || loading) return;
    try {
      setLoading(true);
      await verifyEmailCode(code);
      router.replace("/onboarding");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Invalid or expired code");
      setDigits(["", "", "", ""]);
      inputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;
    try {
      setResending(true);
      await resendEmailCode();
      Alert.alert("Code sent", "A new verification code has been sent to your email.");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not resend code");
    } finally {
      setResending(false);
    }
  };

  const handleSkip = () => {
    router.replace("/onboarding");
  };

  return (
    <Screen bg={C.card}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.container}>
          <View style={styles.logoSection}>
            <Image
              source={require("../assets/near_now_image.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <View style={styles.header}>
            <Text style={styles.pageName}>Email Verification</Text>
            <Text style={styles.title} accessibilityRole="header">Verify your email</Text>
            <Text style={styles.subtitle}>
              We sent a 4-digit code to {email || "your email"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <View style={styles.otpBoxesWrapper}>
              {digits.map((d, idx) => {
                const isFocused = code.length === idx;
                return (
                  <TextInput
                    key={idx}
                    ref={(el) => { inputsRef.current[idx] = el; }}
                    style={[
                      styles.otpBox,
                      isFocused && styles.otpBoxFocused,
                      d !== "" && styles.otpBoxFilled,
                    ]}
                    value={d}
                    onChangeText={(val) => handleChangeDigit(val, idx)}
                    onKeyPress={(e) => handleKeyPress(e, idx)}
                    keyboardType="number-pad"
                    maxLength={1}
                    autoFocus={idx === 0}
                    accessibilityLabel={`Digit ${idx + 1} of 4`}
                  />
                );
              })}
            </View>

            <TouchableOpacity
              onPress={handleResend}
              disabled={resending}
              activeOpacity={0.7}
              hitSlop={LINK_HIT_SLOP}
              style={styles.linkBtn}
              accessibilityRole="button"
              accessibilityState={{ disabled: resending, busy: resending }}
            >
              <Text style={styles.resendText}>
                {resending ? "Resending…" : "Resend code"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSection}>
            <PrimaryButton
              label="Verify"
              onPress={handleVerify}
              disabled={code.length !== 4 || loading}
              loading={loading}
              shadow
              style={(code.length !== 4 || loading) && styles.ctaDisabled}
              textStyle={styles.ctaText}
            />

            <TouchableOpacity
              style={styles.skipRow}
              onPress={handleSkip}
              activeOpacity={0.7}
              hitSlop={LINK_HIT_SLOP}
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
            <Text style={styles.noteText}>
              You can browse without verifying, but you&apos;ll need to verify your email before placing an order.
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
  logoSection: { alignItems: "center", paddingTop: 4 },
  logo: { width: 160, height: 145 },
  header: { gap: 8 },
  pageName: {
    fontSize: 11,
    color: C.textSub,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  title: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14, color: C.textSub },
  otpSection: { alignItems: "center" },
  otpBoxesWrapper: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    marginTop: 32,
    marginBottom: 16,
  },
  otpBox: { fontFamily: "PlusJakartaSans_600SemiBold",
    flex: 1,
    maxWidth: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.border,
    backgroundColor: C.card,
    textAlign: "center",
    fontSize: 20,
    color: C.text,
  },
  otpBoxFocused: {
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  linkBtn: { paddingVertical: 4 },
  resendText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: C.primary },
  bottomSection: { gap: 12 },
  ctaDisabled: { shadowOpacity: 0, elevation: 0 },
  ctaText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 },
  skipRow: { alignItems: "center", marginTop: 4, paddingVertical: 8 },
  skipText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: C.textSub },
  noteText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 12, color: C.textLight, textAlign: "center", lineHeight: 18 },
});
