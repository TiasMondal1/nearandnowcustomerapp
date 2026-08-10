import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import { sendOTP } from "../lib/authService";

export default function OtpScreen() {
  const params = useLocalSearchParams();
  const phone = typeof params.phone === "string" ? params.phone : "";
  const email = typeof params.email === "string" ? params.email : "";

  const { verifyOTPCode } = useAuth();

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const inputsRef = useRef<Array<TextInput | null>>([]);
  // Synchronous double-submit lock — `loading` is React state, so a fast
  // double-tap (or a tap racing the auto-submit effect below) could invoke
  // verifyOTPCode twice concurrently before a re-render ever disabled the
  // button. Mirrors app/support/checkout.tsx's identical `placingRef` fix
  // for the same race.
  const verifyingRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const code = digits.join("");
    if (code.length === 6 && !loading) {
      handleVerify(code);
    }
  }, [digits]);

  const handleChangeDigit = (value: string, index: number) => {
    const clean = value.replace(/[^0-9]/g, "");
    if (!clean) {
      const updated = [...digits];
      updated[index] = "";
      setDigits(updated);
      return;
    }
    // The OS can deliver more than one character to a single box — an
    // SMS-autofill banner tap or a manual paste of a copied code both hand
    // the full string to whichever box has focus. Previously only the last
    // character survived (`clean[clean.length - 1]`), silently dropping the
    // other 5 digits. Distribute across the remaining boxes instead,
    // mirroring the shopkeeper/rider apps' identical `handleDigitChange` fix.
    if (clean.length > 1) {
      const updated = [...digits];
      for (let i = 0; i < clean.length && index + i < 6; i++) {
        updated[index + i] = clean[i];
      }
      setDigits(updated);
      inputsRef.current[Math.min(index + clean.length, 5)]?.focus();
      return;
    }
    const updated = [...digits];
    updated[index] = clean;
    setDigits(updated);
    if (index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace") {
      if (digits[index] === "" && index > 0) {
        inputsRef.current[index - 1]?.focus();
      }
    }
  };

  const formatTimer = (s: number) => {
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleVerify = async (code: string) => {
    if (code.length !== 6 || verifyingRef.current) return;
    if (!phone) {
      Alert.alert("Error", "Missing phone number.");
      return;
    }
    verifyingRef.current = true;
    try {
      setLoading(true);
      const { isNewUser } = await verifyOTPCode(phone, code, "Customer", email || undefined);
      // Email verification step disabled for now — email is captured (mandatory) during
      // signup but not verified. Re-enable by routing new users to "/verify-email" instead.
      // if (isNewUser) {
      //   router.replace({ pathname: "/verify-email", params: { email } });
      // } else {
      //   router.replace("/welcome");
      // }
      if (isNewUser) {
        router.replace("/onboarding");
      } else {
        router.replace("/welcome");
      }
    } catch (err: any) {
      const message = err?.message || "Verification failed";
      if (message.toLowerCase().includes("email")) {
        // Backend rejects brand-new signups without an email (auth.controller.ts).
        // Send the user back to add one rather than showing a raw error.
        Alert.alert("Email required", "Please enter your email address to finish creating your account.", [
          { text: "OK", onPress: () => router.replace({ pathname: "/phone", params: { phone: phone.replace("+91", "") } }) },
        ]);
      } else {
        Alert.alert("Error", message);
      }
      setDigits(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || resending || !phone) return;
    try {
      setResending(true);
      await sendOTP(phone);
      setDigits(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
      setSecondsLeft(60);
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not resend code");
    } finally {
      setResending(false);
    }
  };

  const code = digits.join("");

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

          <View style={styles.header}>
            <Text style={styles.pageName}>OTP Verification</Text>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to {phone || "your number"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <View style={styles.otpBoxesWrapper}>
              {digits.map((d, idx) => {
                const isFilled = d !== "";
                const isFocused = code.length === idx;
                return (
                  <TextInput
                    key={idx}
                    ref={(el) => { inputsRef.current[idx] = el; }}
                    style={[
                      styles.otpBox,
                      isFocused && styles.otpBoxFocused,
                      isFilled && styles.otpBoxFilled,
                    ]}
                    value={d}
                    onChangeText={(val) => handleChangeDigit(val, idx)}
                    onKeyPress={(e) => handleKeyPress(e, idx)}
                    keyboardType="number-pad"
                    returnKeyType="next"
                    autoFocus={idx === 0}
                    textContentType="oneTimeCode"
                    autoComplete={idx === 0 ? "sms-otp" : "off"}
                    importantForAutofill={idx === 0 ? "yes" : "no"}
                  />
                );
              })}
            </View>

            <View style={styles.infoRow}>
              {secondsLeft > 0 ? (
                <Text style={styles.timerText}>
                  Didn&apos;t receive it? Resend in {formatTimer(secondsLeft)}
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={handleResend}
                  activeOpacity={0.8}
                  disabled={resending}
                >
                  <Text style={styles.resendText}>
                    {resending ? "Resending..." : "Resend code"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={code.length === 6 && !loading ? 0.85 : 1}
              onPress={() => handleVerify(code)}
              disabled={code.length !== 6 || loading}
              style={[
                styles.button,
                (code.length !== 6 || loading) && styles.buttonDisabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backRow}
              onPress={() => router.back()}
            >
              <Text style={styles.backText}>Use a different number</Text>
            </TouchableOpacity>
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
    justifyContent: "space-between",
    width: "100%",
    marginTop: 32,
    marginBottom: 16,
  },
  otpBox: {
    width: 48,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "#1f2937",
  },
  otpBoxFocused: {
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  infoRow: { marginTop: 8 },
  timerText: { fontSize: 12, color: "#6b7280" },
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
  backRow: { alignItems: "center", marginTop: 4 },
  backText: { fontSize: 12, color: "#6b7280" },
});
