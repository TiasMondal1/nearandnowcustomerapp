import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bg: "#F8F8F6",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  border: "#E5E7EB",
  borderFocus: "#2D7A4F",
  red: "#EF4444",
};

const LOCATION_LABELS = ["Home", "Work", "Other"] as const;
type LocationLabel = (typeof LOCATION_LABELS)[number];

type Step = "name" | "location";

export default function OnboardingScreen() {
  const { updateUserProfile } = useAuth();
  const { setLocation } = useLocation();

  const [step, setStep] = useState<Step>("name");

  // Name step
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Location step
  const [locationLabel, setLocationLabel] = useState<LocationLabel>("Home");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [saving, setSaving] = useState(false);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const nameValid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const locationValid = addressLine.trim().length > 0 && city.trim().length > 0;

  const handleDetectLocation = async () => {
    setGpsLoading(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Please allow location access or enter your address manually.");
        return;
      }
      const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      const [result] = await ExpoLocation.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (result) {
        if (result.street || result.name) setAddressLine([result.name, result.street].filter(Boolean).join(", "));
        if (result.city) setCity(result.city);
        if (result.postalCode) setPincode(result.postalCode);
      }
    } catch {
      Alert.alert("Error", "Could not detect location. Please enter manually.");
    } finally {
      setGpsLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!locationValid || saving) return;
    setSaving(true);
    try {
      const fullAddress = [addressLine.trim(), city.trim(), pincode.trim()].filter(Boolean).join(", ");
      await updateUserProfile({
        name: fullName || undefined,
        surname: lastName.trim() || undefined,
        address: addressLine.trim(),
        city: city.trim(),
        pincode: pincode.trim() || undefined,
      });
      setLocation({
        latitude: coords?.lat ?? 0,
        longitude: coords?.lng ?? 0,
        label: locationLabel,
        address: fullAddress,
        source: coords ? "manual" : "manual",
      });
      router.replace("/(tabs)/home");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoWrap}>
            <Image
              source={require("../assets/near_now_image.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Step indicator */}
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, step === "name" && styles.stepDotActive]} />
            <View style={styles.stepLine} />
            <View style={[styles.stepDot, step === "location" && styles.stepDotActive]} />
          </View>

          {step === "name" ? (
            <NameStep
              firstName={firstName}
              lastName={lastName}
              onFirstName={setFirstName}
              onLastName={setLastName}
              valid={nameValid}
              onNext={() => setStep("location")}
            />
          ) : (
            <LocationStep
              locationLabel={locationLabel}
              addressLine={addressLine}
              city={city}
              pincode={pincode}
              gpsLoading={gpsLoading}
              saving={saving}
              valid={locationValid}
              onLabel={setLocationLabel}
              onAddress={setAddressLine}
              onCity={setCity}
              onPincode={setPincode}
              onDetect={handleDetectLocation}
              onBack={() => setStep("name")}
              onFinish={handleFinish}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ── Name step ──────────────────────────────────────────────── */

function NameStep({
  firstName, lastName,
  onFirstName, onLastName,
  valid, onNext,
}: {
  firstName: string; lastName: string;
  onFirstName: (v: string) => void; onLastName: (v: string) => void;
  valid: boolean; onNext: () => void;
}) {
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Tell us about you</Text>
      <Text style={styles.stepSub}>We&apos;ll use this for your orders and receipts.</Text>

      <View style={styles.fieldGroup}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={onFirstName}
              placeholder="Riya"
              autoFocus
              autoCapitalize="words"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last name"
              value={lastName}
              onChangeText={onLastName}
              placeholder="Sharma"
              autoCapitalize="words"
            />
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, !valid && styles.primaryBtnDisabled]}
        onPress={onNext}
        activeOpacity={valid ? 0.85 : 1}
        disabled={!valid}
      >
        <Text style={styles.primaryBtnText}>Continue</Text>
        <MaterialCommunityIcons name="arrow-right" size={18} color={T.white} />
      </TouchableOpacity>
    </View>
  );
}

/* ── Location step ──────────────────────────────────────────── */

function LocationStep({
  locationLabel, addressLine, city, pincode,
  gpsLoading, saving, valid,
  onLabel, onAddress, onCity, onPincode,
  onDetect, onBack, onFinish,
}: {
  locationLabel: LocationLabel; addressLine: string; city: string; pincode: string;
  gpsLoading: boolean; saving: boolean; valid: boolean;
  onLabel: (l: LocationLabel) => void;
  onAddress: (v: string) => void; onCity: (v: string) => void; onPincode: (v: string) => void;
  onDetect: () => void; onBack: () => void; onFinish: () => void;
}) {
  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Your delivery address</Text>
      <Text style={styles.stepSub}>Where should we send your orders?</Text>

      {/* GPS button */}
      <TouchableOpacity
        style={styles.gpsBtn}
        onPress={onDetect}
        activeOpacity={0.8}
        disabled={gpsLoading}
      >
        {gpsLoading ? (
          <ActivityIndicator size="small" color={T.green} />
        ) : (
          <MaterialCommunityIcons name="crosshairs-gps" size={18} color={T.green} />
        )}
        <Text style={styles.gpsBtnText}>
          {gpsLoading ? "Detecting…" : "Use my current location"}
        </Text>
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or enter manually</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Label selector */}
      <View style={styles.labelRow}>
        {(["Home", "Work", "Other"] as LocationLabel[]).map((lbl) => (
          <TouchableOpacity
            key={lbl}
            style={[styles.labelChip, locationLabel === lbl && styles.labelChipActive]}
            onPress={() => onLabel(lbl)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={lbl === "Home" ? "home-outline" : lbl === "Work" ? "office-building-outline" : "map-marker-outline"}
              size={14}
              color={locationLabel === lbl ? T.green : T.barkLight}
            />
            <Text style={[styles.labelChipText, locationLabel === lbl && styles.labelChipTextActive]}>
              {lbl}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.fieldGroup}>
        <Field
          label="Address line"
          value={addressLine}
          onChangeText={onAddress}
          placeholder="Flat 4B, Rose Apartments, MG Road"
          autoCapitalize="words"
          multiline
        />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="City" value={city} onChangeText={onCity} placeholder="Bengaluru" autoCapitalize="words" />
          </View>
          <View style={{ width: 110 }}>
            <Field label="Pincode" value={pincode} onChangeText={onPincode} placeholder="560001" keyboardType="number-pad" maxLength={6} />
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, (!valid || saving) && styles.primaryBtnDisabled]}
        onPress={onFinish}
        activeOpacity={valid && !saving ? 0.85 : 1}
        disabled={!valid || saving}
      >
        {saving ? (
          <ActivityIndicator color={T.white} size="small" />
        ) : (
          <>
            <Text style={styles.primaryBtnText}>Start Shopping</Text>
            <MaterialCommunityIcons name="shopping-outline" size={18} color={T.white} />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.backRow} onPress={onBack} activeOpacity={0.7}>
        <MaterialCommunityIcons name="chevron-left" size={16} color={T.barkLight} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ── Reusable field ─────────────────────────────────────────── */

function Field({
  label, value, onChangeText, placeholder, autoFocus, autoCapitalize,
  keyboardType, maxLength, multiline, error,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; autoFocus?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "number-pad" | "email-address";
  maxLength?: number; multiline?: boolean; error?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        style={[
          fieldStyles.input,
          focused && fieldStyles.inputFocused,
          multiline && fieldStyles.multiline,
          !!error && fieldStyles.inputError,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={T.barkLight}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        maxLength={maxLength}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {!!error && <Text style={fieldStyles.errorText}>{error}</Text>}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: T.barkMid },
  input: {
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: T.bark,
    fontWeight: "500",
  },
  inputFocused: { borderColor: T.borderFocus },
  inputError: { borderColor: T.red },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  errorText: { fontSize: 12, color: T.red, fontWeight: "500", marginTop: -2 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.white },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },

  logoWrap: { alignItems: "center", paddingTop: 16 },
  logo: { width: 180, height: 160 },

  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginBottom: 28,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: T.border,
  },
  stepDotActive: { backgroundColor: T.green, transform: [{ scale: 1.3 }] },
  stepLine: { width: 40, height: 2, backgroundColor: T.border },

  stepContent: { gap: 20 },
  stepTitle: { fontSize: 24, fontWeight: "800", color: T.bark, letterSpacing: -0.3 },
  stepSub: { fontSize: 14, color: T.barkLight, fontWeight: "500", marginTop: -12 },

  fieldGroup: { gap: 14 },
  row: { flexDirection: "row", gap: 12 },

  gpsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: T.green,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: T.greenXLight,
  },
  gpsBtnText: { fontSize: 14, fontWeight: "700", color: T.green },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: T.border },
  dividerText: { fontSize: 12, color: T.barkLight, fontWeight: "500" },

  labelRow: { flexDirection: "row", gap: 10 },
  labelChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: T.border,
    backgroundColor: T.bg,
  },
  labelChipActive: { borderColor: T.green, backgroundColor: T.greenXLight },
  labelChipText: { fontSize: 13, fontWeight: "700", color: T.barkLight },
  labelChipTextActive: { color: T.green },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: T.green,
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryBtnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { fontSize: 16, fontWeight: "800", color: T.white },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
  },
  backText: { fontSize: 13, color: T.barkLight, fontWeight: "600" },
});
