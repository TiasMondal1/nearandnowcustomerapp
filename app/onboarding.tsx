import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { Divider, PrimaryButton, Screen } from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  bg: "#F8F8F6",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
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
    <Screen bg={C.card}>
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

          {/* Step indicator — first dot is current-or-completed, connector fills on advance */}
          <View style={styles.stepRow} accessibilityLabel={`Step ${step === "name" ? 1 : 2} of 2`}>
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={[styles.stepLine, step === "location" && styles.stepLineActive]} />
            <View style={[styles.stepDot, step === "location" && styles.stepDotActive]} />
          </View>

          {step === "name" ? (
            <NameStep
              firstName={firstName}
              lastName={lastName}
              onFirstName={setFirstName}
              onLastName={setLastName}
              valid={nameValid}
              onNext={() => { LayoutAnimation.easeInEaseOut(); setStep("location"); }}
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
              onBack={() => { LayoutAnimation.easeInEaseOut(); setStep("name"); }}
              onFinish={handleFinish}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
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
      <View style={styles.titleBlock}>
        <Text style={styles.stepTitle} accessibilityRole="header">Tell us about you</Text>
        <Text style={styles.stepSub}>We&apos;ll use this for your orders and receipts.</Text>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={onFirstName}
              placeholder="Riya"
              autoFocus
              autoCapitalize="words"
            />
          </View>
          <View style={styles.flex}>
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

      <PrimaryButton
        label="Continue"
        iconRight="arrow-right"
        iconSize={18}
        onPress={onNext}
        disabled={!valid}
        shadow
        style={[styles.primaryBtn, !valid && styles.primaryBtnDisabled]}
        textStyle={styles.primaryBtnText}
      />
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
      <View style={styles.titleBlock}>
        <Text style={styles.stepTitle} accessibilityRole="header">Your delivery address</Text>
        <Text style={styles.stepSub}>Where should we send your orders?</Text>
      </View>

      {/* GPS button */}
      <TouchableOpacity
        style={styles.gpsBtn}
        onPress={onDetect}
        activeOpacity={0.8}
        disabled={gpsLoading}
        accessibilityRole="button"
        accessibilityState={{ disabled: gpsLoading, busy: gpsLoading }}
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
        <Divider spacing={0} style={styles.flex} />
        <Text style={styles.dividerText}>or enter manually</Text>
        <Divider spacing={0} style={styles.flex} />
      </View>

      {/* Label selector */}
      <View style={styles.labelRow}>
        {(["Home", "Work", "Other"] as LocationLabel[]).map((lbl) => (
          <TouchableOpacity
            key={lbl}
            style={[styles.labelChip, locationLabel === lbl && styles.labelChipActive]}
            onPress={() => onLabel(lbl)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: locationLabel === lbl }}
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
          <View style={styles.flex}>
            <Field label="City" value={city} onChangeText={onCity} placeholder="Bengaluru" autoCapitalize="words" />
          </View>
          <View style={styles.pincodeCol}>
            <Field label="Pincode" value={pincode} onChangeText={onPincode} placeholder="560001" keyboardType="number-pad" maxLength={6} />
          </View>
        </View>
      </View>

      <PrimaryButton
        label="Start Shopping"
        iconRight="shopping-outline"
        iconSize={18}
        onPress={onFinish}
        disabled={!valid || saving}
        loading={saving}
        shadow
        style={[styles.primaryBtn, (!valid || saving) && styles.primaryBtnDisabled]}
        textStyle={styles.primaryBtnText}
      />

      <TouchableOpacity
        style={styles.backRow}
        onPress={onBack}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
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
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {!!error && <Text style={fieldStyles.errorText}>{error}</Text>}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: T.barkMid },
  input: { fontFamily: "PlusJakartaSans_500Medium",
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: T.bark,
  },
  inputFocused: { borderColor: T.green },
  inputError: { borderColor: C.danger },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  errorText: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, color: C.danger, marginTop: -2 },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },

  logoWrap: { alignItems: "center", paddingTop: 20 },
  logo: { width: 160, height: 145 },

  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.border,
  },
  stepDotActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.green },
  stepLine: { width: 40, height: 2, backgroundColor: C.border },
  stepLineActive: { backgroundColor: T.green },

  stepContent: { gap: 20 },
  titleBlock: { gap: 8 },
  stepTitle: { fontSize: 28, fontFamily: "PlusJakartaSans_800ExtraBold", color: T.bark, letterSpacing: -0.3 },
  stepSub: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 14, color: T.barkLight },

  fieldGroup: { gap: 16 },
  row: { flexDirection: "row", gap: 12 },
  pincodeCol: { width: 110 },

  gpsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: T.green,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    backgroundColor: T.greenXLight,
  },
  gpsBtnText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: T.green },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerText: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, color: T.barkLight },

  labelRow: { flexDirection: "row", gap: 12 },
  labelChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: T.bg,
  },
  labelChipActive: { borderColor: T.green, backgroundColor: T.greenXLight },
  labelChipText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, color: T.barkLight },
  labelChipTextActive: { color: T.green },

  // PrimaryButton overrides: this screen's T palette + shadow off while disabled.
  primaryBtn: { backgroundColor: T.green, shadowColor: T.green },
  primaryBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16 },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
    minHeight: 44,
  },
  backText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: T.barkLight },
});
