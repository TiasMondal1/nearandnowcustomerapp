// INTENTIONALLY UNLINKED (S7 / C43). Nothing navigates here: the only entry — new users after OTP — is
// commented out at app/otp.tsx (see the "Email verification step disabled for now" block in handleVerify).
// Email is captured at signup and verified later from app/settings/profile.tsx. The file stays so the typed
// `/verify-email` href remains valid and the flow can be re-enabled by restoring that one branch. Only a
// token/primitive migration was done here; the behaviour is unchanged.
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";

import { notify, PressableScale, PrimaryButton, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { border, fontFamily, motion, radius, space, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";

const CODE_LENGTH = 4;

// Text-link hit areas — top slop stays inside the gap to the element above
// so it never overlaps the code boxes / Verify button (see otp.tsx).
const LINK_HIT_SLOP = { top: 8, bottom: 12, left: 16, right: 16 };

const emptyCode = (): string[] => Array.from({ length: CODE_LENGTH }, () => "");

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams();
  const email = typeof params.email === "string" ? params.email : "";

  const { verifyEmailCode, resendEmailCode } = useAuth();

  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const inputsRef = useRef<(TextInput | null)[]>([]);

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
    if (index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === "Backspace" && digits[index] === "" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const code = digits.join("");

  useEffect(() => {
    if (code.length === CODE_LENGTH && !loading) {
      void handleVerify();
    }
    // Auto-submit fires on the digits only: `handleVerify` is recreated every render and `loading` flipping
    // back to false must not resubmit the (already cleared) code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const handleVerify = async () => {
    if (code.length !== CODE_LENGTH || loading) return;
    try {
      setLoading(true);
      await verifyEmailCode(code);
      // Unwind the login stack before the flow replace (W3 R6-05; same guard as otp.tsx).
      if (router.canDismiss()) router.dismissAll();
      router.replace("/onboarding");
    } catch (err) {
      notify({
        id: "verify-email-error",
        tone: "error",
        title: "Couldn't verify that code",
        message: err instanceof Error && err.message ? err.message : "Invalid or expired code",
      });
      setDigits(emptyCode());
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
      notify({ id: "verify-email-resent", tone: "success", title: "Code sent", message: "A new verification code has been sent to your email." });
    } catch (err) {
      notify({
        id: "verify-email-resend-error",
        tone: "error",
        title: "Couldn't resend the code",
        message: err instanceof Error && err.message ? err.message : "Please try again",
      });
    } finally {
      setResending(false);
    }
  };

  const handleSkip = () => {
    if (router.canDismiss()) router.dismissAll();
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
              source={require("../assets/near_now_image_640.png")}
              style={styles.logo}
              resizeMode="contain"
              accessible={false}
              accessibilityIgnoresInvertColors
            />
          </View>

          <View style={styles.header}>
            <Text style={styles.pageName} maxFontSizeMultiplier={1.3}>
              Email verification
            </Text>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Verify your email
            </Text>
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
              We sent a 4-digit code to {email || "your email"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <View style={styles.otpRow}>
              {digits.map((d, idx) => {
                const isFocused = code.length === idx;
                return (
                  <TextInput
                    key={idx}
                    ref={(el) => {
                      inputsRef.current[idx] = el;
                    }}
                    style={[styles.otpBox, isFocused && styles.otpBoxFocused]}
                    value={d}
                    onChangeText={(val) => handleChangeDigit(val, idx)}
                    onKeyPress={(e) => handleKeyPress(e, idx)}
                    keyboardType="number-pad"
                    maxLength={1}
                    autoFocus={idx === 0}
                    maxFontSizeMultiplier={1.3}
                    accessibilityLabel={`Digit ${idx + 1} of 4`}
                  />
                );
              })}
            </View>

            <PressableScale
              scale={motion.scale.row}
              onPress={() => void handleResend()}
              disabled={resending}
              hitSlop={LINK_HIT_SLOP}
              innerStyle={styles.linkBtn}
              accessibilityLabel="Resend code"
              accessibilityState={{ disabled: resending, busy: resending }}
            >
              {({ pressed }) => (
                <Text style={[styles.resendText, pressed && styles.linkPressed]} maxFontSizeMultiplier={1.3}>
                  {resending ? "Resending…" : "Resend code"}
                </Text>
              )}
            </PressableScale>
          </View>

          <View style={styles.bottomSection}>
            <PrimaryButton
              size="lg"
              label="Verify"
              onPress={() => void handleVerify()}
              disabled={code.length !== CODE_LENGTH}
              loading={loading}
            />

            <PressableScale
              scale={motion.scale.row}
              onPress={handleSkip}
              hitSlop={LINK_HIT_SLOP}
              style={styles.skipWrap}
              innerStyle={styles.skipRow}
              accessibilityLabel="Skip for now"
            >
              {({ pressed }) => (
                <Text style={[styles.skipText, pressed && styles.linkPressed]} maxFontSizeMultiplier={1.3}>
                  Skip for now
                </Text>
              )}
            </PressableScale>
            <Text style={styles.noteText} maxFontSizeMultiplier={1.3}>
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
    paddingHorizontal: space[24],
    paddingTop: space[16],
    paddingBottom: space[32],
    justifyContent: "space-between",
  },
  logoSection: { alignItems: "center", paddingTop: space[4] },
  logo: { width: 160, height: 145 },
  header: { gap: space[8] },
  pageName: { ...text.eyebrow },
  title: { ...text.h1 },
  subtitle: { ...text.bodySm },
  otpSection: { alignItems: "center" },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space[12],
    width: "100%",
    marginTop: space[32],
    marginBottom: space[16],
  },
  otpBox: {
    flex: 1,
    maxWidth: 56,
    minHeight: 56,
    borderRadius: radius.xl,
    borderWidth: border.input,
    borderColor: C.bgSoft,
    backgroundColor: C.bgSoft,
    textAlign: "center",
    fontFamily: fontFamily.semibold,
    fontSize: 20,
    color: C.text,
    paddingVertical: 0,
  },
  otpBoxFocused: { borderColor: C.primary },
  linkBtn: { paddingVertical: space[4] },
  resendText: { ...text.link },
  linkPressed: { color: C.primary },
  bottomSection: { gap: space[12] },
  skipWrap: { alignSelf: "center" },
  skipRow: { alignItems: "center", marginTop: space[4], paddingVertical: space[8] },
  skipText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  noteText: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 18, color: C.textSub, textAlign: "center" },
});
