import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

export default function OtpScreen() {
  const params = useLocalSearchParams();
  const phone = typeof params.phone === "string" ? params.phone : "";

  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [loading, setLoading] = useState(false);

  const hiddenInputRef = useRef<TextInput | null>(null);

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
    if (code.length === 6 && !loading) {
      handleVerify();
    }
  }, [code]);

  const handleChangeCode = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 6);
    setCode(digits);
  };

  const handleBoxPress = () => {
    hiddenInputRef.current?.focus();
  };

  const formatTimer = (s: number) => {
    const mm = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleVerify = async () => {
    if (code.length !== 6 || loading) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 1000);
  };

  const handleResend = () => {
    if (secondsLeft > 0 || loading) return;
    setCode("");
    setSecondsLeft(60);
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
            <Text style={styles.pageName}>OTP Verification</Text>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to {phone || "your number"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.otpBoxesWrapper}
              onPress={handleBoxPress}
            >
              {Array.from({ length: 6 }).map((_, idx) => {
                const char = code[idx] || "";
                const isFocused = code.length === idx;
                const isFilled = idx < code.length;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.otpBox,
                      isFocused && styles.otpBoxFocused,
                      isFilled && styles.otpBoxFilled,
                    ]}
                  >
                    <Text style={styles.otpChar}>{char}</Text>
                  </View>
                );
              })}
            </TouchableOpacity>

            <TextInput
              ref={hiddenInputRef}
              style={styles.hiddenInput}
              keyboardType="number-pad"
              value={code}
              onChangeText={handleChangeCode}
              maxLength={6}
              autoFocus
            />

            <View style={styles.infoRow}>
              {secondsLeft > 0 ? (
                <Text style={styles.timerText}>
                  Didn&apos;t receive it? Resend in {formatTimer(secondsLeft)}
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResend} activeOpacity={0.8}>
                  <Text style={styles.resendText}>Resend code</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={code.length === 6 && !loading ? 0.85 : 1}
              onPress={handleVerify}
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
    alignItems: "center",
    justifyContent: "center",
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
  otpChar: {
    fontSize: 20,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  hiddenInput: {
    opacity: 0,
    height: 0,
    width: 0,
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
