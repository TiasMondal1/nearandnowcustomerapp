import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
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

/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1A1440";
const PRIMARY = "#765fba";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";
const GREEN = "#3CFF8F";

export default function ProfileScreen() {
  // 🔹 Replace later with real API data
  const original = {
    name: "Enigma",
    phone: "+91 9XXXX XXXXX",
    email: "user@email.com",
    avatar_url: null as string | null,
  };

  const [name, setName] = useState(original.name);
  const [email, setEmail] = useState(original.email);

  const hasChanges = useMemo(() => {
    return name !== original.name || email !== original.email;
  }, [name, email]);

  const handleSave = async () => {
    // 🔒 PLACEHOLDER FOR API
    // await updateProfile({ name, email });

    router.back();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* CONTENT */}
        <View style={{ paddingHorizontal: 16 }}>
          {/* AVATAR */}
          <View style={styles.avatarWrap}>
            {original.avatar_url ? (
              <Image
                source={{ uri: original.avatar_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{original.name.charAt(0)}</Text>
              </View>
            )}

            <Text style={styles.avatarHint}>Profile photo coming soon</Text>
          </View>

          {/* FORM */}
          <View style={styles.card}>
            <Field
              label="Full name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
            />

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              keyboardType="email-address"
            />

            <Field
              label="Phone"
              value={original.phone}
              editable={false}
              helper="Phone number cannot be changed"
            />
          </View>

          {/* SAVE */}
          <TouchableOpacity
            style={[styles.saveBtn, !hasChanges && { opacity: 0.5 }]}
            disabled={!hasChanges}
            onPress={handleSave}
          >
            <MaterialCommunityIcons
              name="content-save"
              size={18}
              color="#fff"
            />
            <Text style={styles.saveText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ───────── FIELD ───────── */

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  helper,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  helper?: string;
  keyboardType?: any;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6F68A8"
        editable={editable}
        keyboardType={keyboardType}
        style={[styles.input, !editable && styles.inputDisabled]}
      />
      {helper && <Text style={styles.helper}>{helper}</Text>}
    </View>
  );
}

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },

  avatarWrap: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 30,
  },

  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },

  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PRIMARY,
    justifyContent: "center",
    alignItems: "center",
  },

  avatarText: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
  },

  avatarHint: {
    color: MUTED,
    fontSize: 11,
    marginTop: 8,
  },

  card: {
    backgroundColor: CARD_SOFT,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  label: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },

  input: {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  inputDisabled: {
    opacity: 0.6,
  },

  helper: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },

  saveBtn: {
    marginTop: 30,
    backgroundColor: GREEN,
    paddingVertical: 14,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },

  saveText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 14,
  },
});
