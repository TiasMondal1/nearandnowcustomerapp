// app/otp.tsx
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

export default function OtpScreen() {
  const params = useLocalSearchParams();
  const phone = typeof params.phone === "string" ? params.phone : "";
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : "";
  const existsParam = typeof params.exists === "string" ? params.exists : "";
  const isExisting = existsParam === "true";

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const inputsRef = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
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
    const char = clean[clean.length - 1];
    const updated = [...digits];
    updated[index] = char;
    setDigits(updated);
    if (index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace") {
      if (digits[index] === "" && index > 0) {
        inputsRef.current[index - 1]?.focus();
      }
    }
  };

  const formatTimer = (s: number) => {
    const mm = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleVerify = async (code: string) => {
    if (code.length !== 6 || loading) return;
    if (!phone || !sessionId) {
      Alert.alert("Error", "Missing phone or session.");
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/auth/phone/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          sessionId,
          otp: code,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        Alert.alert("Error", json.error || "Verification failed");
        setDigits(["", "", "", "", "", ""]);
        inputsRef.current[0]?.focus();
        return;
      }

      if (json.mode === "login") {
        const name = json.user?.name || "";
        Alert.alert(
          "Welcome back",
          name ? `Welcome back, ${name}` : "Login successful."
        );
      } else if (json.mode === "signup") {
        router.replace({
          pathname: "/profile-setup",
          params: {
            phone,
          },
        });
      } else {
        Alert.alert("Success", "Verification completed.");
      }
    } catch {
      Alert.alert("Error", "Network error during verification.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || resending) return;
    if (!phone) return;
    try {
      setResending(true);
      const res = await fetch(`${API_BASE}/auth/phone/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        Alert.alert("Error", json.error || "Could not resend code");
        return;
      }
      setDigits(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
      setSecondsLeft(60);
    } catch {
      Alert.alert("Error", "Network error while resending.");
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
          <View style={styles.header}>
            <Text style={styles.pageName}>OTP Verification</Text>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to {phone || "your number"}.
            </Text>
            {isExisting && (
              <Text style={styles.subtitleHint}>Welcome back.</Text>
            )}
          </View>

          <View style={styles.otpSection}>
            <View style={styles.otpBoxesWrapper}>
              {digits.map((d, idx) => {
                const isFilled = d !== "";
                const isFocused = code.length === idx;
                return (
                  <TextInput
                    key={idx}
                    ref={(el) => (inputsRef.current[idx] = el)}
                    style={[
                      styles.otpBox,
                      isFocused && styles.otpBoxFocused,
                      isFilled && styles.otpBoxFilled,
                    ]}
                    value={d}
                    onChangeText={(val) => handleChangeDigit(val, idx)}
                    onKeyPress={(e) => handleKeyPress(e, idx)}
                    keyboardType="number-pad"
                    maxLength={1}
                    returnKeyType="next"
                    autoFocus={idx === 0}
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
  safeArea: {
    flex: 1,
    backgroundColor: "#05030A",
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
  header: {
    paddingTop: 32,
    gap: 6,
  },
  pageName: {
    fontSize: 11,
    color: "#9C94D7",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "#C4BDEA",
  },
  subtitleHint: {
    fontSize: 12,
    color: "#9C94D7",
  },
  otpSection: {
    alignItems: "center",
  },
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#392B6A",
    backgroundColor: "#120D24",
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  otpBoxFocused: {
    borderColor: PRIMARY,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  },
  otpBoxFilled: {
    borderColor: "#BCA7FF",
    backgroundColor: "#1A1234",
  },
  infoRow: {
    marginTop: 8,
  },
  timerText: {
    fontSize: 12,
    color: "#9C94D7",
  },
  resendText: {
    fontSize: 13,
    color: PRIMARY,
    fontWeight: "600",
  },
  bottomSection: {
    gap: 12,
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
    marginTop: 4,
  },
  backText: {
    fontSize: 12,
    color: "#C4BDEA",
  },
});
