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
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
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
          style={[styles.input, !editable && styles.inputDisabled]}
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
          <Text style={styles.helper}> {helper}</Text>
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
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* Content */}
        <Animated.ScrollView
          style={{ opacity: contentAnim, transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
          <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
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
          </Animated.View>

          {/* Email — verified separately; changing it requires confirming a code */}
          <View style={[styles.card, { marginTop: 16, padding: 16 }]}>
            <Text style={styles.label}>
              Email {isEmailVerified && !showEmailCodeStep ? "· Verified" : !showEmailCodeStep ? "· Unverified" : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <TextInput
                ref={emailRef}
                style={[styles.input, { backgroundColor: C.bgSoft, borderRadius: 10, flex: 1 }]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!showEmailCodeStep}
              />
              <TouchableOpacity
                style={[styles.saveBtn, { marginTop: 0, paddingHorizontal: 16 }, (isEmailSubmitting || showEmailCodeStep) && styles.saveBtnDisabled]}
                disabled={isEmailSubmitting || showEmailCodeStep || email.trim() === (user?.email ?? "")}
                onPress={handleSendEmailCode}
              >
                <Text style={styles.saveText}>Send Code</Text>
              </TouchableOpacity>
            </View>

            {showEmailCodeStep && (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TextInput
                  style={[styles.input, { backgroundColor: C.bgSoft, borderRadius: 10, flex: 1 }]}
                  value={emailCode}
                  onChangeText={(v) => setEmailCode(v.replace(/\D/g, ""))}
                  placeholder="4-digit code"
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <TouchableOpacity
                  style={[styles.saveBtn, { marginTop: 0, paddingHorizontal: 16 }, isEmailSubmitting && styles.saveBtnDisabled]}
                  disabled={isEmailSubmitting}
                  onPress={handleVerifyEmail}
                >
                  <Text style={styles.saveText}>Verify</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { marginTop: 0, paddingHorizontal: 16, backgroundColor: C.bgSoft }, isEmailSubmitting && styles.saveBtnDisabled]}
                  disabled={isEmailSubmitting}
                  onPress={handleResendEmailCode}
                >
                  <Text style={[styles.saveText, { color: C.text }]}>Resend</Text>
                </TouchableOpacity>
              </View>
            )}
            {!isEmailVerified && !showEmailCodeStep && (
              <Text style={[styles.helper, { marginTop: 6 }]}>
                Verify your email before you can place an order.
              </Text>
            )}
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
            disabled={!hasChanges || saving}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="content-save-outline" size={18} color="#fff" />
            )}
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save Changes"}</Text>
          </TouchableOpacity>
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: C.text,
    fontSize: 18,
    fontWeight: "800",
  },

  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

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
  avatarText: { color: "#fff", fontSize: 34, fontWeight: "900" },
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
  errorText: { color: "#c0392b", fontSize: 13, fontWeight: "600", flex: 1 },

  // Card
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  fieldWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: C.border },

  label: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 7,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // Animated input wrapper
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bgSoft,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  inputWrapperDisabled: { opacity: 0.65 },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: C.text,
    fontSize: 15,
  },
  inputDisabled: {},
  charCount: {
    paddingRight: 10,
    fontSize: 11,
    color: C.textLight,
    fontWeight: "600",
    minWidth: 36,
    textAlign: "right",
  },
  charCountFocused: { color: C.primary },

  helperRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  helper: { color: C.textLight, fontSize: 11 },

  // Save button
  saveBtn: {
    marginTop: 24,
    backgroundColor: C.primary,
    paddingVertical: 15,
    borderRadius: 14,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});