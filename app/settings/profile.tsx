import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import Animated from "react-native-reanimated";

import {
  Badge,
  enter,
  exit,
  Input,
  notify,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Shake,
  useMotionReduced,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, opacity, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { logError } from "../../lib/logError";

// Edit profile — the owner's flat redesign (72 px avatar + live name, underline fields, hairline email block,
// Badges, xs button trio, block Save) migrated forward with an identical look: the underline `Field` is now
// rendered by the shared `Input` (same 1.5 underline, 16 px Medium, ph2, UI-thread focus colour), the Save
// press is `PressableScale` (0.97 + C.primaryDark face), and `Shake` replaces the RN Animated shake.
// Behaviour fixes only: C19 (empty name disables Save and is never sent), C20 (a saved-but-unverified email
// can be verified), success toast + `success` feedback, inline errors + `error` feedback — no Alerts.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Avatar ──────────────────────────────────────────────────────────────────
// Static — no looping pulse. The identity block reads like a document header,
// not an animation showcase. The initial follows the typed name and crossfades
// when its first letter changes (M30).

function Avatar({ initial, name, reduced }: { initial: string; name: string; reduced: boolean }) {
  return (
    <View style={styles.avatarWrap}>
      <View style={styles.avatarFallback} accessible accessibilityLabel={`Avatar, ${initial}`}>
        <Animated.Text
          key={initial}
          style={styles.avatarText}
          entering={reduced ? undefined : enter.fade()}
          exiting={reduced ? undefined : exit.fade()}
        >
          {initial}
        </Animated.Text>
      </View>
      <Text style={styles.avatarName} numberOfLines={1}>{name}</Text>
    </View>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────
// Thin wrapper that keeps the owner's eyebrow label, counter and helper row around the shared `Input`
// (the primitive's own label preset is 12/600 — not the eyebrow — so the label stays here for parity).

interface FieldProps {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  helper?: string;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
  maxLength?: number;
  isLast?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  helper,
  keyboardType,
  autoCapitalize = "none",
  returnKeyType,
  onSubmitEditing,
  inputRef,
  maxLength,
  isLast,
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <View style={[styles.fieldWrap, !isLast && styles.fieldBorder]}>
      <Text style={styles.label}>{label}</Text>
      <Input
        inputRef={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={editable}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={handleFocus}
        onBlur={handleBlur}
        maxLength={maxLength}
        accessibilityLabel={label}
        right={
          maxLength !== undefined && editable ? (
            <Text style={[styles.charCount, focused && styles.charCountFocused]} maxFontSizeMultiplier={1.3}>
              {value.length}/{maxLength}
            </Text>
          ) : undefined
        }
      />
      {helper && (
        <View style={styles.helperRow}>
          <MaterialCommunityIcons name="information-outline" size={11} color={C.textSub} />
          <Text style={styles.helper}>{helper}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, updateUserProfile, changeEmail, verifyEmailCode, resendEmailCode } = useAuth();
  const hideEmailVerify = useDevFlag("Dev_Auth_inhibit_EmailVerify");
  const reduced = useMotionReduced();

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Email is verified separately — changing it stages a code, it doesn't
  // take effect until confirmed.
  const [email, setEmail] = useState(user?.email ?? "");
  const [isEmailVerified, setIsEmailVerified] = useState(!!user?.email_verified_at);
  const [showEmailCodeStep, setShowEmailCodeStep] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [shakeCount, setShakeCount] = useState(0);

  const emailRef = useRef<TextInput>(null);

  useEffect(() => {
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setIsEmailVerified(!!user?.email_verified_at);
    setShowEmailCodeStep(false);
  }, [user?.id, user?.name, user?.email, user?.email_verified_at]);

  const trimmedName = name.trim();
  const nameEmpty = trimmedName === "";
  const hasChanges = useMemo(() => trimmedName !== (user?.name ?? ""), [trimmedName, user]);
  // C19: an empty name never counts as a saveable change.
  const canSave = hasChanges && !nameEmpty && !saving;

  // One shake + one `error` per failed action (the fields block shakes, as the owner's version did).
  const fail = useCallback(() => {
    setShakeCount((c) => c + 1);
    feedback.error();
  }, []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const handleSave = useCallback(async () => {
    // C19: never send `{ name: undefined }` — an empty name is refused here, not stringified away.
    if (!user?.id || !hasChanges || saving || !trimmedName) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateUserProfile({ name: trimmedName });
      feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
      notify({ title: "Profile updated", tone: "success" });
      goBack();
    } catch (err) {
      logError("Save profile", err);
      setSaving(false);
      setSaveError(err instanceof Error && err.message ? err.message : "Could not save changes. Please try again.");
      fail();
    }
  }, [user?.id, hasChanges, saving, trimmedName, updateUserProfile, goBack, fail]);

  const savedEmail = user?.email ?? "";
  const trimmedEmail = email.trim();
  const emailDirty = trimmedEmail !== savedEmail;
  const emailValid = EMAIL_REGEX.test(trimmedEmail);
  // C20: a saved-but-unverified email gets "Verify now" — the code step is reachable even when the input
  // equals user.email (the old "Send Code" was disabled exactly then, so the address could never be verified).
  const needsVerifyNow = !emailDirty && !isEmailVerified && trimmedEmail !== "";
  const sendDisabled = isEmailSubmitting || showEmailCodeStep || !emailValid || (!emailDirty && isEmailVerified);
  const sendLabel = needsVerifyNow ? "Verify now" : "Send code";

  const handleSendEmailCode = useCallback(async () => {
    if (!emailValid) return;
    setEmailError(null);
    try {
      setIsEmailSubmitting(true);
      if (needsVerifyNow) {
        // The address is already staged as unverified on the backend: resend its code; if nothing is pending
        // any more (expired), stage it again through the change endpoint.
        try {
          await resendEmailCode();
        } catch {
          await changeEmail(trimmedEmail);
        }
      } else {
        await changeEmail(trimmedEmail);
      }
      setShowEmailCodeStep(true);
      notify({ title: `Code sent to ${trimmedEmail}` });
    } catch (err) {
      logError("Send email code", err);
      setEmailError(err instanceof Error && err.message ? err.message : "Couldn't send the code. Please try again.");
      fail();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [emailValid, needsVerifyNow, trimmedEmail, changeEmail, resendEmailCode, fail]);

  const handleVerifyEmail = useCallback(async () => {
    if (emailCode.length !== 4) return;
    setEmailError(null);
    try {
      setIsEmailSubmitting(true);
      await verifyEmailCode(emailCode.trim());
      setIsEmailVerified(true);
      setShowEmailCodeStep(false);
      setEmailCode("");
      feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
      notify({ title: "Email verified", tone: "success" });
    } catch (err) {
      logError("Verify email code", err);
      setEmailError(err instanceof Error && err.message ? err.message : "That code didn't work. Please try again.");
      fail();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [emailCode, verifyEmailCode, fail]);

  const handleResendEmailCode = useCallback(async () => {
    setEmailError(null);
    try {
      setIsEmailSubmitting(true);
      await resendEmailCode();
      notify({ title: "Code sent again" });
    } catch (err) {
      logError("Resend email code", err);
      setEmailError(err instanceof Error && err.message ? err.message : "Couldn't resend the code. Please try again.");
      fail();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [resendEmailCode, fail]);

  const liveName = trimmedName || user?.name || "";
  const initial = (liveName || "?").charAt(0).toUpperCase();

  return (
    <Screen bg={C.card}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {/* Header — no onBack: BackButton's deep-link-safe fallback applies (MAP U27). */}
        <ScreenHeader title="Edit Profile" backFallbackHref="/(tabs)/home" />

        {/* Content */}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={reduced ? undefined : enter.rise()}>
            <Avatar initial={initial} name={trimmedName || "Your name"} reduced={reduced} />

            {/* Error line — inline, never an Alert */}
            {saveError && (
              <View style={styles.errorBanner} accessibilityLiveRegion="polite">
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color={C.danger} />
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            {/* Fields — flat stack, no card chrome */}
            <Shake trigger={shakeCount}>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSave}
                maxLength={60}
                helper={nameEmpty ? "Enter your name" : undefined}
              />
              <Field
                label="Phone"
                value={user?.phone ?? ""}
                editable={false}
                helper="Phone number cannot be changed"
                isLast
              />
            </Shake>

            {/* Email — verified separately; changing it requires confirming a code */}
            {!hideEmailVerify && (
              <View style={styles.emailCard}>
                <View style={styles.emailLabelRow}>
                  <Text style={styles.emailLabel}>Email</Text>
                  {isEmailVerified && !showEmailCodeStep ? (
                    <Badge size="sm" pill tone="primary" label="Verified" />
                  ) : !showEmailCodeStep ? (
                    <Badge size="sm" pill tone="warning" label="Unverified" />
                  ) : null}
                </View>
                <View style={styles.inlineRow}>
                  <Input
                    inputRef={emailRef}
                    containerStyle={styles.flex}
                    value={email}
                    onChangeText={(v) => {
                      setEmail(v);
                      setEmailError(null);
                    }}
                    placeholder="you@email.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!showEmailCodeStep}
                    accessibilityLabel="Email"
                  />
                  <PrimaryButton
                    size="xs"
                    label={sendLabel}
                    disabled={sendDisabled}
                    loading={isEmailSubmitting && !showEmailCodeStep}
                    onPress={() => void handleSendEmailCode()}
                  />
                </View>

                {showEmailCodeStep && (
                  <View style={[styles.inlineRow, styles.inlineRowSpaced]}>
                    <Input
                      containerStyle={styles.flex}
                      value={emailCode}
                      onChangeText={(v) => {
                        setEmailCode(v.replace(/\D/g, ""));
                        setEmailError(null);
                      }}
                      placeholder="4-digit code"
                      keyboardType="number-pad"
                      maxLength={4}
                      accessibilityLabel="Verification code"
                    />
                    <PrimaryButton
                      size="xs"
                      label="Verify"
                      disabled={isEmailSubmitting || emailCode.length !== 4}
                      onPress={() => void handleVerifyEmail()}
                    />
                    <PrimaryButton
                      size="xs"
                      variant="secondary"
                      label="Resend"
                      disabled={isEmailSubmitting}
                      onPress={() => void handleResendEmailCode()}
                    />
                  </View>
                )}
                {emailError ? (
                  <Text style={styles.emailError} accessibilityLiveRegion="polite">{emailError}</Text>
                ) : !isEmailVerified && !showEmailCodeStep ? (
                  <Text style={[styles.helper, styles.emailHelper]}>
                    Verify your email before you can place an order.
                  </Text>
                ) : null}
              </View>
            )}

            {/* Save Button — presses down like a physical key (silent; the result plays success/error) */}
            <PressableScale
              scale={motion.scale.cta}
              pressedStyle={styles.saveBtnPressed}
              style={styles.saveWrap}
              innerStyle={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              disabled={!canSave}
              onPress={() => void handleSave()}
              accessibilityRole="button"
              accessibilityLabel="Save"
              accessibilityState={{ disabled: !canSave, busy: saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={C.onPrimary} />
              ) : null}
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
            </PressableScale>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: layout.scrollBottom },

  // Avatar
  avatarWrap: { alignItems: "center", marginTop: 20, marginBottom: 24, gap: 10 },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: C.onPrimary, fontSize: 28, fontFamily: fontFamily.extrabold },
  avatarName: { color: C.text, fontSize: 20, fontFamily: fontFamily.extrabold, letterSpacing: -0.3, maxWidth: "80%" },
  // Error line
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.dangerLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.dangerBorder,
  },
  errorText: { fontFamily: fontFamily.semibold, color: C.danger, fontSize: 13, flex: 1 },

  // Sections — flat field stacks separated by a hairline, no card chrome
  emailCard: { marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border },
  fieldWrap: { paddingVertical: 10 },
  fieldBorder: { marginBottom: 4 },

  label: { ...text.eyebrow, marginBottom: 4 },
  emailLabelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  emailLabel: { ...text.eyebrow },

  inlineRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  inlineRowSpaced: { marginTop: 12 },
  charCount: {
    fontFamily: fontFamily.semibold,
    paddingRight: 10,
    fontSize: 11,
    color: C.textSub,
    minWidth: 36,
    textAlign: "right",
  },
  charCountFocused: { color: C.primary },

  helperRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  helper: { ...text.caption },
  emailHelper: { marginTop: 8 },
  emailError: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.danger, marginTop: 8 },

  // Save button — squared-off, Uber-style block
  saveWrap: { marginTop: 28 },
  saveBtn: {
    backgroundColor: C.primary,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnPressed: { backgroundColor: C.primaryDark },
  saveBtnDisabled: { opacity: opacity.disabled },
  saveText: { ...text.button },
});
