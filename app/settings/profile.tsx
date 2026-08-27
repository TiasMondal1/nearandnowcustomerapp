import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from "react-native";

import { Badge, Card, PrimaryButton, Screen, ScreenHeader } from "../../components/ui";
import { C } from "../../constants/colors";
import { border, layout, opacity, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ initial }: { initial: string }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1.06, duration: 1600, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.15, duration: 1600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.4, duration: 1600, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.avatarWrap}>
      <Animated.View
        style={[
          styles.avatarRing,
          { transform: [{ scale: pulse }], opacity: ringOpacity },
        ]}
      />
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
    </View>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────

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
  const borderAnim = useRef(new Animated.Value(0)).current;

  const handleFocus = useCallback(() => {
    setFocused(true);
    Animated.timing(borderAnim, { toValue: 1, duration: 180, useNativeDriver: false }).start();
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    Animated.timing(borderAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  }, []);

  const animatedBorderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [C.border, C.primary],
  });

  return (
    <View style={[styles.fieldWrap, !isLast && styles.fieldBorder]}>
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        style={[
          styles.inputWrapper,
          { borderColor: animatedBorderColor },
          !editable && styles.inputWrapperDisabled,
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.textLight}
          editable={editable}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={handleFocus}
          onBlur={handleBlur}
          maxLength={maxLength}
          style={styles.input}
        />
        {maxLength !== undefined && editable && (
          <Text style={[styles.charCount, focused && styles.charCountFocused]}>
            {value.length}/{maxLength}
          </Text>
        )}
      </Animated.View>
      {helper && (
        <View style={styles.helperRow}>
          <MaterialCommunityIcons name="information-outline" size={11} color={C.textLight} />
          <Text style={styles.helper}>{helper}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, updateUserProfile, changeEmail, verifyEmailCode, resendEmailCode } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Email is verified separately — changing it stages a code, it doesn't
  // take effect until confirmed.
  const [email, setEmail] = useState(user?.email ?? "");
  const [isEmailVerified, setIsEmailVerified] = useState(!!user?.email_verified_at);
  const [showEmailCodeStep, setShowEmailCodeStep] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(contentAnim, {
      toValue: 1,
      duration: 400,
      delay: 80,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setIsEmailVerified(!!user?.email_verified_at);
    setShowEmailCodeStep(false);
  }, [user?.id, user?.name, user?.email, user?.email_verified_at]);

  const hasChanges = useMemo(
    () => name.trim() !== (user?.name ?? ""),
    [name, user]
  );

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSave = useCallback(async () => {
    if (!user?.id || !hasChanges || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateUserProfile({ name: name.trim() || undefined });
      router.back();
    } catch {
      setSaving(false);
      setSaveError(true);
      triggerShake();
    }
  }, [user?.id, hasChanges, saving, name, updateUserProfile, triggerShake]);

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleSendEmailCode = useCallback(async () => {
    if (!EMAIL_REGEX.test(email.trim())) return;
    try {
      setIsEmailSubmitting(true);
      await changeEmail(email.trim());
      setShowEmailCodeStep(true);
    } catch {
      triggerShake();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [email, changeEmail, triggerShake]);

  const handleVerifyEmail = useCallback(async () => {
    if (emailCode.length !== 4) return;
    try {
      setIsEmailSubmitting(true);
      await verifyEmailCode(emailCode.trim());
      setIsEmailVerified(true);
      setShowEmailCodeStep(false);
      setEmailCode("");
    } catch {
      triggerShake();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [emailCode, verifyEmailCode, triggerShake]);

  const handleResendEmailCode = useCallback(async () => {
    try {
      setIsEmailSubmitting(true);
      await resendEmailCode();
    } catch {
      triggerShake();
    } finally {
      setIsEmailSubmitting(false);
    }
  }, [resendEmailCode, triggerShake]);

  const initial = (user?.name ?? "?").charAt(0).toUpperCase();

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <ScreenHeader title="Edit Profile" onBack={() => router.back()} />

        {/* Content */}
        <Animated.ScrollView
          style={{ opacity: contentAnim, transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Avatar initial={initial} />

          {/* Error Banner */}
          {saveError && (
            <View style={styles.errorBanner}>
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#c0392b" />
              <Text style={styles.errorText}>Could not save changes. Please try again.</Text>
            </View>
          )}

          {/* Card */}
          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
            <Card padded={false}>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSave}
                maxLength={60}
              />
              <Field
                label="Phone"
                value={user?.phone ?? ""}
                editable={false}
                helper="Phone number cannot be changed"
                isLast
              />
            </Card>
          </Animated.View>

          {/* Email — verified separately; changing it requires confirming a code */}
          <Card padded={false} style={styles.emailCard}>
            <View style={styles.emailLabelRow}>
              <Text style={styles.emailLabel}>Email</Text>
              {isEmailVerified && !showEmailCodeStep ? (
                <Badge size="sm" pill tone="primary" label="Verified" />
              ) : !showEmailCodeStep ? (
                <Badge size="sm" pill tone="warning" label="Unverified" />
              ) : null}
            </View>
            <View style={styles.inlineRow}>
              <TextInput
                ref={emailRef}
                style={[styles.input, styles.inlineInput]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@email.com"
                placeholderTextColor={C.textLight}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!showEmailCodeStep}
              />
              <PrimaryButton
                size="xs"
                shadow={false}
                label="Send Code"
                disabled={isEmailSubmitting || showEmailCodeStep || email.trim() === (user?.email ?? "")}
                onPress={handleSendEmailCode}
              />
            </View>

            {showEmailCodeStep && (
              <View style={[styles.inlineRow, styles.inlineRowSpaced]}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={emailCode}
                  onChangeText={(v) => setEmailCode(v.replace(/\D/g, ""))}
                  placeholder="4-digit code"
                  placeholderTextColor={C.textLight}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <PrimaryButton
                  size="xs"
                  shadow={false}
                  label="Verify"
                  disabled={isEmailSubmitting}
                  onPress={handleVerifyEmail}
                />
                <PrimaryButton
                  size="xs"
                  shadow={false}
                  variant="secondary"
                  label="Resend"
                  disabled={isEmailSubmitting}
                  onPress={handleResendEmailCode}
                />
              </View>
            )}
            {!isEmailVerified && !showEmailCodeStep && (
              <Text style={[styles.helper, styles.emailHelper]}>
                Verify your email before you can place an order.
              </Text>
            )}
          </Card>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
            disabled={!hasChanges || saving}
            onPress={handleSave}
            activeOpacity={opacity.pressCta}
            accessibilityRole="button"
            accessibilityState={{ disabled: !hasChanges || saving, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={C.card} />
            ) : (
              <MaterialCommunityIcons name="content-save-outline" size={18} color={C.card} />
            )}
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save Changes"}</Text>
          </TouchableOpacity>
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: layout.scrollBottom },

  // Avatar
  avatarWrap: { alignItems: "center", marginTop: 24, marginBottom: 28 },
  avatarRing: {
    position: "absolute",
    top: -8,
    width: 104,
    height: 104,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: C.primary,
  },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: C.card, fontSize: 34, fontFamily: "PlusJakartaSans_800ExtraBold" },
  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fdecea",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#f5c6c2",
  },
  errorText: { fontFamily: "PlusJakartaSans_600SemiBold", color: "#c0392b", fontSize: 13, flex: 1 },

  // Cards
  emailCard: { marginTop: 16, padding: layout.cardPaddingLg },
  fieldWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: C.border },

  label: { ...text.eyebrow, marginBottom: 8 },
  emailLabelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  emailLabel: { ...text.eyebrow },

  // Animated input wrapper
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bgSoft,
    borderRadius: radius.lg,
    borderWidth: border.input,
    overflow: "hidden",
  },
  inputWrapperDisabled: { opacity: 0.65 },
  input: { fontFamily: "PlusJakartaSans_500Medium",
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: C.text,
    fontSize: 15,
  },
  inlineInput: {
    backgroundColor: C.bgSoft,
    borderRadius: radius.lg,
    borderWidth: border.input,
    borderColor: C.border,
  },
  inlineRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  inlineRowSpaced: { marginTop: 12 },
  charCount: { fontFamily: "PlusJakartaSans_600SemiBold",
    paddingRight: 10,
    fontSize: 11,
    color: C.textLight,
    minWidth: 36,
    textAlign: "right",
  },
  charCountFocused: { color: C.primary },

  helperRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  helper: { ...text.caption },
  emailHelper: { marginTop: 8 },

  // Save button
  saveBtn: {
    marginTop: 24,
    backgroundColor: C.primary,
    paddingVertical: 15,
    borderRadius: radius.xxl,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: opacity.disabled },
  saveText: { ...text.button },
});
