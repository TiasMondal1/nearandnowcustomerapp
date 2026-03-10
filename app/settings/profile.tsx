import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState, useEffect } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";

export default function ProfileScreen() {
  const { user, updateUserProfile } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
  }, [user?.id, user?.name, user?.email]);

  const hasChanges = useMemo(() => {
    return name !== (user?.name ?? "") || email !== (user?.email ?? "");
  }, [name, email, user]);

  const handleSave = async () => {
    if (!user?.id || !hasChanges || saving) return;
    setSaving(true);
    try {
      await updateUserProfile({ name: name.trim() || undefined, email: email.trim() || undefined });
      router.back();
    } catch {
      setSaving(false);
    }
  };

  const initial = (user?.name ?? "?").charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.content}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.avatarHint}>Profile photo coming soon</Text>
          </View>

          <View style={styles.card}>
            <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email-address" />
            <Field label="Phone" value={user?.phone ?? ""} editable={false} helper="Phone number cannot be changed" isLast />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, !hasChanges && styles.saveBtnDisabled]}
            disabled={!hasChanges}
            onPress={handleSave}
          >
            <MaterialCommunityIcons name="content-save-outline" size={18} color="#fff" />
            <Text style={styles.saveText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  helper,
  keyboardType,
  isLast,
}: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  helper?: string;
  keyboardType?: any;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.fieldWrap, !isLast && styles.fieldBorder]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.textLight}
        editable={editable}
        keyboardType={keyboardType}
        style={[styles.input, !editable && styles.inputDisabled]}
      />
      {helper && <Text style={styles.helper}>{helper}</Text>}
    </View>
  );
}

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
  headerTitle: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "800" },

  content: { paddingHorizontal: 16, paddingTop: 8 },

  avatarWrap: { alignItems: "center", marginTop: 24, marginBottom: 28 },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#fff", fontSize: 34, fontWeight: "900" },
  avatarHint: { color: C.textLight, fontSize: 12, marginTop: 10 },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  fieldWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: C.border },

  label: { color: C.textSub, fontSize: 11, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: C.bgSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: C.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputDisabled: { opacity: 0.65 },
  helper: { color: C.textLight, fontSize: 11, marginTop: 5 },

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
