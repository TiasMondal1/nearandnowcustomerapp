// Phone login (BP-37 / U36). White, logo 160, one underline `Input` with a +91 prefix that autofocuses, an
// optional email `Input` (captured, not verified — see the comment on `validate`), inline validation and
// request errors instead of Alerts, and a silent lg "Continue" (the OTP screen plays the result).
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { Input, PrimaryButton, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { fontFamily, space, text } from "../constants/ui";
import { sendOTP } from "../lib/authService";
import { feedback } from "../lib/feedback";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_LENGTH = 10;

const onlyDigits = (value: string) => value.replace(/[^0-9]/g, "");

export default function PhoneScreen() {
  const params = useLocalSearchParams();
  const prefillPhone = typeof params.phone === "string" ? params.phone : "";

  const [phone, setPhone] = useState(prefillPhone);
  const [email, setEmail] = useState("");
  const [loadingOtp, setLoadingOtp] = useState(false);
  // Field-level validation (rendered by each Input at 11/500 C.danger; the Input shakes on a new error) plus
  // per-field nonces so pressing Continue again with the same invalid value still shakes that field.
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneShake, setPhoneShake] = useState(0);
  const [emailShake, setEmailShake] = useState(0);
  // Send failure (offline / timeout / server / backend message) — one inline line above the CTA.
  const [requestError, setRequestError] = useState<string | null>(null);
  // Synchronous double-submit lock (state alone cannot stop a double tap — same as otp.tsx's verifyingRef).
  const sendingRef = useRef(false);

  const handlePhoneChange = (value: string) => {
    setPhone(onlyDigits(value).slice(0, PHONE_LENGTH));
    if (phoneError) setPhoneError(null);
    if (requestError) setRequestError(null);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (emailError) setEmailError(null);
    if (requestError) setRequestError(null);
  };

  // This screen serves both login and signup, and we don't know which one
  // this phone number is until after OTP verification — so email can't be
  // force-required here without also nagging returning users on every login.
  // The backend enforces email as mandatory for brand-new signups (see
  // auth.controller.ts); otp.tsx sends the user back here to fill it in if
  // that happens. No verification is required at this point — only capture.
  const validate = (): boolean => {
    const trimmedEmail = email.trim();
    const nextPhoneError = phone.length === PHONE_LENGTH ? null : "Enter your 10-digit mobile number";
    const nextEmailError =
      trimmedEmail.length === 0 || EMAIL_REGEX.test(trimmedEmail) ? null : "Enter a valid email address";
    setPhoneError(nextPhoneError);
    setEmailError(nextEmailError);
    if (nextPhoneError) setPhoneShake((n) => n + 1);
    if (nextEmailError) setEmailShake((n) => n + 1);
    return !nextPhoneError && !nextEmailError;
  };

  const handleContinue = async () => {
    if (sendingRef.current) return;
    if (!validate()) {
      // One `error` for the validation summary (CONTRACTS §8) — the offending Input shakes itself.
      feedback.error();
      return;
    }
    const fullPhone = `+91${phone}`;
    sendingRef.current = true;
    setLoadingOtp(true);
    setRequestError(null);
    try {
      await sendOTP(fullPhone);
      router.push({
        pathname: "/otp",
        params: { phone: fullPhone, email: email.trim() },
      });
    } catch (err) {
      // apiFetch's copy is already user-readable (offline / timeout / server) and the backend's own message
      // comes through for 4xx bodies — shown as-is, never re-mapped.
      setRequestError(err instanceof Error && err.message ? err.message : "Failed to send OTP. Try again.");
      feedback.error();
    } finally {
      sendingRef.current = false;
      setLoadingOtp(false);
    }
  };

  const openTerms = () => router.push("/settings/terms");

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
              source={require("../assets/near_now_image_640.png")}
              style={styles.logo}
              resizeMode="contain"
              accessible={false}
              accessibilityIgnoresInvertColors
            />
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Let&apos;s get you in
            </Text>
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
              Enter your phone number to continue
            </Text>

            <Input
              variant="underline"
              value={phone}
              onChangeText={handlePhoneChange}
              placeholder="10-digit mobile number"
              keyboardType="phone-pad"
              autoFocus
              maxLength={PHONE_LENGTH}
              left={
                <Text style={styles.prefix} maxFontSizeMultiplier={1.3}>
                  +91
                </Text>
              }
              helper="We'll send you a one-time code to verify your number."
              error={phoneError}
              shakeTrigger={phoneShake}
              textContentType="telephoneNumber"
              autoComplete="tel"
              accessibilityLabel="Phone number"
              containerStyle={styles.field}
            />

            <Input
              variant="underline"
              value={email}
              onChangeText={handleEmailChange}
              placeholder="Email address (optional)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void handleContinue()}
              helper="Used for order receipts. You can verify it after logging in."
              error={emailError}
              shakeTrigger={emailShake}
              textContentType="emailAddress"
              autoComplete="email"
              accessibilityLabel="Email address"
              containerStyle={styles.field}
            />
          </View>

          {/* Bottom */}
          <View style={styles.bottomSection}>
            {requestError ? (
              <Text
                style={styles.requestError}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
              >
                {requestError}
              </Text>
            ) : null}

            <PrimaryButton size="lg" label="Continue" onPress={() => void handleContinue()} loading={loadingOtp} />

            <Text style={styles.termsText} maxFontSizeMultiplier={1.3}>
              By continuing, you agree to our{" "}
              <Text style={styles.termsLink} accessibilityRole="link" onPress={openTerms}>
                Terms
              </Text>{" "}
              &amp;{" "}
              <Text style={styles.termsLink} accessibilityRole="link" onPress={openTerms}>
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
    paddingHorizontal: space[24],
    paddingTop: space[16],
    paddingBottom: space[32],
    justifyContent: "space-between",
  },
  logoSection: { alignItems: "center", paddingTop: space[4] },
  logo: { width: 160, height: 145 },
  form: { gap: space[4] },
  title: { ...text.h1 },
  subtitle: { ...text.bodySm, marginBottom: space[8] },
  field: { marginTop: space[12] },
  // "+91" prefix — 18/700 (design §3.21), sits in the Input's `left` slot.
  prefix: { fontFamily: fontFamily.bold, fontSize: 18, color: C.text, marginRight: space[8] },
  bottomSection: { gap: space[16] },
  requestError: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.danger, textAlign: "center" },
  termsText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    color: C.textSub,
    textAlign: "center",
    paddingVertical: space[4],
  },
  termsLink: { fontFamily: fontFamily.bold, color: C.link },
});
