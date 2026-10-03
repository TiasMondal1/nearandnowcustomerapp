// OTP entry (BP-37 / M20). Six 48×56 boxes on C.bgSoft that auto-submit on the sixth digit (typed, pasted or
// SMS-autofilled), `Shake` + C.danger borders + `feedback.error()` on a wrong code, `feedback.tap()` (quiet confirm, W3 F7) on
// verify, then /onboarding (new user) or /welcome — `Dev_Zephyr_inhibit_WelcomeInterstitial` goes straight to
// Home. Continue / back / resend presses are silent; the result plays.
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
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

import { dur, notify, PressableScale, PrimaryButton, Screen, Shake } from "../components/ui";
import { C } from "../constants/colors";
import { border, fontFamily, motion, radius, space, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { sendOTP } from "../lib/authService";
import { getDevFlag } from "../lib/devFlags";
import { feedback } from "../lib/feedback";

const CODE_LENGTH = 6;
/** Seconds before "Resend code" becomes available (first send and every resend). */
const RESEND_SECONDS = 60;
/** How long the boxes stay C.danger after a wrong code (ms; × the dev speed factor). */
const ERROR_FLASH_MS = 600;

// Text-link hit areas. Top slop is kept smaller than the gap to the element
// above so the extended target never sits over the OTP boxes / Verify button
// (a later sibling's hitSlop wins over an earlier sibling's frame).
const LINK_HIT_SLOP = { top: 8, bottom: 12, left: 16, right: 16 };

const emptyCode = (): string[] => Array.from({ length: CODE_LENGTH }, () => "");

const formatTimer = (s: number) => {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
};

export default function OtpScreen() {
  const params = useLocalSearchParams();
  const phone = typeof params.phone === "string" ? params.phone : "";
  const email = typeof params.email === "string" ? params.email : "";

  const { verifyOTPCode } = useAuth();

  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Wrong-code state: `errorNonce` drives the Shake (one increment = one shake) and restarts the border flash;
  // `errorFlash` paints the boxes C.danger for ERROR_FLASH_MS; `errorMessage` is the inline line under the
  // boxes, cleared by the next keystroke.
  const [errorNonce, setErrorNonce] = useState(0);
  const [errorFlash, setErrorFlash] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputsRef = useRef<(TextInput | null)[]>([]);
  // Synchronous double-submit lock — `loading` is React state, so a fast
  // double-tap (or a tap racing the auto-submit below) could invoke
  // verifyOTPCode twice concurrently before a re-render ever disabled the
  // button. Mirrors app/support/checkout.tsx's identical `placingRef` fix
  // for the same race.
  const verifyingRef = useRef(false);

  // Resend countdown. Ticks only while there is something to count down, so no idle interval sits around
  // once it reaches zero (the W3 setInterval audit: a visible countdown, not an animation loop).
  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  // Border flash: every new wrong code restarts the ERROR_FLASH_MS timer; unmount clears it.
  useEffect(() => {
    if (errorNonce === 0) return;
    const id = setTimeout(() => setErrorFlash(false), dur(ERROR_FLASH_MS));
    return () => clearTimeout(id);
  }, [errorNonce]);

  const resetCode = () => {
    setDigits(emptyCode());
    inputsRef.current[0]?.focus();
  };

  const showWrongCode = (message: string) => {
    setErrorMessage(message);
    setErrorFlash(true);
    setErrorNonce((n) => n + 1);
    // iOS has no live regions; announce explicitly so VoiceOver users hear why the boxes just emptied.
    AccessibilityInfo.announceForAccessibility(message);
  };

  const handleVerify = async (code: string) => {
    if (code.length !== CODE_LENGTH || verifyingRef.current) return;
    if (!phone) {
      showWrongCode("Missing phone number. Go back and enter it again.");
      return;
    }
    verifyingRef.current = true;
    setLoading(true);
    try {
      const { isNewUser } = await verifyOTPCode(phone, code, "Customer", email || undefined);
      // Email verification step disabled for now — email is captured (mandatory) during
      // signup but not verified. Re-enable by routing new users to "/verify-email" instead.
      // if (isNewUser) {
      //   router.replace({ pathname: "/verify-email", params: { email } });
      // } else {
      //   router.replace("/welcome");
      // }
      feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
      // /phone is the stack root under this screen; replace swaps only the top, so unwind first or Home keeps
      // /phone (and a second /phone after logout) underneath it (W3 R6-05).
      if (router.canDismiss()) router.dismissAll();
      if (isNewUser) {
        router.replace("/onboarding");
      } else if (getDevFlag("Dev_Zephyr_inhibit_WelcomeInterstitial")) {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/welcome");
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Verification failed";
      feedback.error();
      resetCode();
      if (message.toLowerCase().includes("email")) {
        // Backend rejects brand-new signups without an email (auth.controller.ts). Send the user straight back to
        // add one, with a toast instead of the old "OK to continue" Alert (W3 R2-F6): the toast lives in the root
        // ToastHost so it survives the navigation, and its haptic is already covered by the feedback.error() above.
        // dismissTo pops back to the live /phone (the typed number is still there) instead of stacking a second
        // /phone under this one (W3 R6-05); from a cold start on /otp it replaces instead.
        notify({
          id: "email-required",
          tone: "error",
          title: "Email required",
          message: "Add your email to finish creating your account.",
        });
        router.dismissTo({ pathname: "/phone", params: { phone: phone.replace("+91", "") } });
      } else {
        showWrongCode(message);
      }
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  };

  // Every digit change funnels through here, and the auto-submit happens HERE rather than in an effect on
  // `digits` (C44): the handler already holds the next code, so there is no stale closure to disable lint for.
  const applyDigits = (next: string[], focusIndex: number | null) => {
    setDigits(next);
    if (errorMessage) setErrorMessage(null);
    if (focusIndex !== null) inputsRef.current[focusIndex]?.focus();
    const code = next.join("");
    if (code.length === CODE_LENGTH) void handleVerify(code);
  };

  const handleChangeDigit = (value: string, index: number) => {
    const clean = value.replace(/[^0-9]/g, "");
    if (!clean) {
      const updated = [...digits];
      updated[index] = "";
      applyDigits(updated, null);
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
      for (let i = 0; i < clean.length && index + i < CODE_LENGTH; i++) {
        updated[index + i] = clean[i];
      }
      applyDigits(updated, Math.min(index + clean.length, CODE_LENGTH - 1));
      return;
    }
    const updated = [...digits];
    updated[index] = clean;
    applyDigits(updated, index < CODE_LENGTH - 1 ? index + 1 : null);
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === "Backspace" && digits[index] === "" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || resending || !phone) return;
    setResending(true);
    try {
      await sendOTP(phone);
      feedback.select();
      notify({ id: "otp-resent", tone: "success", title: "Code sent", message: `A new code is on its way to ${phone}` });
      setErrorMessage(null);
      resetCode();
      setSecondsLeft(RESEND_SECONDS);
    } catch (err) {
      notify({
        id: "otp-resend-error",
        tone: "error",
        title: "Couldn't resend the code",
        message: err instanceof Error && err.message ? err.message : "Please try again",
      });
    } finally {
      setResending(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/phone");
  };

  const code = digits.join("");

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
              accessible={false}
              accessibilityIgnoresInvertColors
            />
          </View>

          <View style={styles.header}>
            <Text style={styles.pageName} maxFontSizeMultiplier={1.3}>
              OTP verification
            </Text>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Enter the code
            </Text>
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
              We sent a 6-digit code to {phone || "your number"}.
            </Text>
          </View>

          <View style={styles.otpSection}>
            <Shake trigger={errorNonce} style={styles.shakeWrap}>
              <View style={styles.otpRow} accessibilityLiveRegion={errorFlash ? "polite" : "none"}>
                {digits.map((d, idx) => {
                  const isFocused = !errorFlash && code.length === idx;
                  return (
                    <TextInput
                      key={idx}
                      ref={(el) => {
                        inputsRef.current[idx] = el;
                      }}
                      style={[styles.otpBox, isFocused && styles.otpBoxFocused, errorFlash && styles.otpBoxError]}
                      value={d}
                      onChangeText={(val) => handleChangeDigit(val, idx)}
                      onKeyPress={(e) => handleKeyPress(e, idx)}
                      keyboardType="number-pad"
                      returnKeyType="next"
                      autoFocus={idx === 0}
                      textContentType="oneTimeCode"
                      autoComplete={idx === 0 ? "sms-otp" : "off"}
                      importantForAutofill={idx === 0 ? "yes" : "no"}
                      maxFontSizeMultiplier={1.3}
                      accessibilityLabel={`Digit ${idx + 1} of 6`}
                    />
                  );
                })}
              </View>
            </Shake>

            <View style={styles.infoRow}>
              {errorMessage ? (
                <Text
                  style={styles.errorText}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={1.3}
                >
                  {errorMessage}
                </Text>
              ) : null}
              {secondsLeft > 0 ? (
                <Text style={styles.timerText} maxFontSizeMultiplier={1.3}>
                  Didn&apos;t receive it? Resend in {formatTimer(secondsLeft)}
                </Text>
              ) : (
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
              )}
            </View>
          </View>

          <View style={styles.bottomSection}>
            <PrimaryButton
              size="lg"
              label="Verify"
              onPress={() => void handleVerify(code)}
              disabled={code.length !== CODE_LENGTH}
              loading={loading}
            />

            <PressableScale
              scale={motion.scale.row}
              onPress={handleBack}
              hitSlop={LINK_HIT_SLOP}
              style={styles.backWrap}
              innerStyle={styles.backRow}
              accessibilityLabel="Use a different number"
            >
              {({ pressed }) => (
                <Text style={[styles.backText, pressed && styles.linkPressed]} maxFontSizeMultiplier={1.3}>
                  Use a different number
                </Text>
              )}
            </PressableScale>
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
  shakeWrap: { alignSelf: "stretch" },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space[8],
    marginTop: space[32],
    marginBottom: space[16],
  },
  // 48×56 r12 on C.bgSoft; the 1.5 px border is the focus / error signal (idle it matches the fill).
  // `flex: 1, maxWidth: 48` lets the six boxes shrink a little on 360 pt screens instead of overflowing.
  otpBox: {
    flex: 1,
    maxWidth: 48,
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
  otpBoxError: { borderColor: C.danger },
  infoRow: { marginTop: space[8], minHeight: 24, alignItems: "center", justifyContent: "center", gap: space[6] },
  errorText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.danger, textAlign: "center" },
  timerText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  linkBtn: { paddingVertical: space[4] },
  resendText: { ...text.link },
  linkPressed: { color: C.primary },
  bottomSection: { gap: space[12] },
  backWrap: { alignSelf: "center" },
  backRow: { alignItems: "center", marginTop: space[4], paddingVertical: space[8] },
  backText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
});
