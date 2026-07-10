import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
    ActivityIndicator,
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
import { useAuth } from "../context/AuthContext";

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
    <SafeAreaView style={styles.safeArea}>
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
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.subtitle}>
              We sent a 4-digit code to {email || "your email"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <View style={styles.otpBoxesWrapper}>
              {digits.map((d, idx) => (
                <TextInput
                  key={idx}
                  ref={(el) => { inputsRef.current[idx] = el; }}
                  style={[styles.otpBox, d !== "" && styles.otpBoxFilled]}
                  value={d}
                  onChangeText={(val) => handleChangeDigit(val, idx)}
                  onKeyPress={(e) => handleKeyPress(e, idx)}
                  keyboardType="number-pad"
                  maxLength={1}
                  autoFocus={idx === 0}
                />
              ))}
            </View>

            <TouchableOpacity onPress={handleResend} disabled={resending}>
              <Text style={styles.resendText}>
                {resending ? "Resending..." : "Resend code"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={code.length === 4 && !loading ? 0.85 : 1}
              onPress={handleVerify}
              disabled={code.length !== 4 || loading}
              style={[styles.button, (code.length !== 4 || loading) && styles.buttonDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipRow} onPress={handleSkip}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
            <Text style={styles.noteText}>
              You can browse without verifying, but you&apos;ll need to verify your email before placing an order.
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    justifyContent: "space-between",
  },
  logoSection: { alignItems: "center", paddingTop: 4 },
  logo: { width: 160, height: 145 },
  header: { gap: 6 },
  pageName: {
    fontSize: 11,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: "600",
  },
  title: { fontSize: 28, fontWeight: "700", color: "#1f2937", letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: "#6b7280" },
  otpSection: { alignItems: "center" },
  otpBoxesWrapper: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    marginTop: 32,
    marginBottom: 16,
  },
  otpBox: {
    width: 56,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    textAlign: "center",
    fontSize: 22,
    fontWeight: "600",
    color: "#1f2937",
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  resendText: { fontSize: 13, color: C.primary, fontWeight: "600" },
  bottomSection: { gap: 12 },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },
  skipRow: { alignItems: "center", marginTop: 4 },
  skipText: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  noteText: { fontSize: 11, color: "#9ca3af", textAlign: "center", lineHeight: 16 },
});
