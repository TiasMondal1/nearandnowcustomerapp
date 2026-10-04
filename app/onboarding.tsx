// Onboarding (new users after OTP): name step (first name required, surname OPTIONAL — U8) and a location
// step with "Use current location" (permission-primed copy, useDeviceAddress), "Pick on map" (→ select-map
// with returnTo Home) or a typed address that is geocoded first — the active location is NEVER written
// without real coordinates (C1); without them Home's "Set your location" empty state takes over.
// Step transitions use Collapsible instead of the old global layout-animation calls. (2026-10-03)
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { Chip, Collapsible, Divider, Input, PrimaryButton, Screen, notify } from "../components/ui";
import { C } from "../constants/colors";
import { fontFamily, layout, radius } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useDeviceAddress } from "../hooks/useDeviceAddress";
import { feedback } from "../lib/feedback";
import { logError } from "../lib/logError";
import { logSilentFailure } from "../lib/logSilentFailure";
import { geocodeAddress } from "../lib/placesService";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_LABELS = ["Home", "Work", "Other"] as const;
type LocationLabel = (typeof LOCATION_LABELS)[number];
const LABEL_ICONS = { Home: "home-outline", Work: "office-building-outline", Other: "map-marker-outline" } as const;

type Step = "name" | "location";

const LOGO_WIDTH = 160;
const LOGO_HEIGHT = 145;
const STEP_DOT = 10;
const STEP_DOT_ACTIVE = 12;
const PINCODE_WIDTH = 110;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OnboardingScreen(): React.JSX.Element {
  const { updateUserProfile } = useAuth();
  const { setLocation } = useLocation();
  const { request: requestDeviceAddress, busy: gpsBusy, denied: gpsDenied } = useDeviceAddress();

  const [step, setStep] = useState<Step>("name");

  // Name step
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstNameError, setFirstNameError] = useState<string | null>(null);

  // Location step
  const [locationLabel, setLocationLabel] = useState<LocationLabel>("Home");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const surname = lastName.trim() || undefined;

  // ── Name step ──
  const handleContinue = () => {
    Keyboard.dismiss();
    if (!firstName.trim()) {
      setFirstNameError("Enter your first name");
      setShake((n) => n + 1);
      feedback.error();
      return;
    }
    setFirstNameError(null);
    setStep("location");
  };

  // ── Shared: profile save with inline failure (one error haptic + toast, no Alert) ──
  const saveProfile = async (extra: { address?: string; city?: string; pincode?: string } = {}): Promise<boolean> => {
    try {
      await updateUserProfile({ name: fullName || undefined, surname, ...extra });
      return true;
    } catch (err) {
      logError("Onboarding profile", err);
      feedback.error();
      notify({
        id: "onboarding-save",
        title: "Couldn't save your details",
        message: err instanceof Error ? err.message : "Please try again",
        tone: "error",
      });
      return false;
    }
  };

  // ── GPS (the OS prompt lives in useDeviceAddress; nothing navigates until it has settled) ──
  const [gpsAttempt, setGpsAttempt] = useState(0);
  const gpsHandledRef = useRef(0);

  const handleUseCurrentLocation = async () => {
    if (savingRef.current || gpsBusy) return;
    Keyboard.dismiss();
    const result = await requestDeviceAddress();
    if (!mountedRef.current) return;
    if (!result) {
      setGpsAttempt((n) => n + 1);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const ok = await saveProfile({ address: result.address });
    if (!mountedRef.current) return;
    if (!ok) {
      savingRef.current = false;
      setSaving(false);
      return;
    }
    setLocation({ latitude: result.lat, longitude: result.lng, label: locationLabel, address: result.address, source: "manual" });
    router.replace("/(tabs)/home");
  };

  // Denied → inline state (no toast); any other null fix → one error + toast. `denied` lands in the same commit.
  useEffect(() => {
    if (gpsAttempt === 0 || gpsHandledRef.current === gpsAttempt) return;
    gpsHandledRef.current = gpsAttempt;
    if (gpsDenied) return;
    feedback.error();
    notify({ id: "gps-error", title: "Couldn't get your location", message: "Pick it on the map or type your address", tone: "error" });
  }, [gpsAttempt, gpsDenied]);

  const openSettings = () => {
    Linking.openSettings().catch((err) => logSilentFailure("Open settings", err));
  };

  // ── Map path: Home first, then the picker, so the save unwinds onto Home with dismissTo (replace-then-push). ──
  const handlePickOnMap = async () => {
    if (savingRef.current) return;
    Keyboard.dismiss();
    savingRef.current = true;
    setSaving(true);
    const ok = await saveProfile();
    if (!mountedRef.current) return;
    savingRef.current = false;
    setSaving(false);
    if (!ok) return;
    router.replace("/(tabs)/home");
    router.push({ pathname: "/location/select-map", params: { returnTo: "/(tabs)/home" } });
  };

  // ── Manual path: geocode first; no coordinates → no setLocation (C1), Home's empty state takes over. ──
  const handleFinish = async () => {
    if (savingRef.current) return;
    Keyboard.dismiss();
    const nextAddressError = addressLine.trim() ? null : "Enter your address";
    const nextCityError = city.trim() ? null : "Enter your city";
    setAddressError(nextAddressError);
    setCityError(nextCityError);
    if (nextAddressError || nextCityError) {
      setShake((n) => n + 1);
      feedback.error();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const typed = [addressLine.trim(), city.trim(), pincode.trim()].filter(Boolean).join(", ");
      const geo = await geocodeAddress(typed); // null when nothing resolves (never throws)
      if (!mountedRef.current) return;
      const ok = await saveProfile({ address: addressLine.trim(), city: city.trim(), pincode: pincode.trim() || undefined });
      if (!mountedRef.current) return;
      if (!ok) return;
      if (geo) {
        setLocation({ latitude: geo.lat, longitude: geo.lng, label: locationLabel, address: geo.formatted_address || typed, source: "manual" });
      } else {
        notify({
          id: "onboarding-geocode",
          title: "Couldn't place that address on the map",
          message: "Set your location from Home to see stores near you",
          tone: "warning",
        });
      }
      router.replace("/(tabs)/home");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    setStep("name");
  };

  const stepIndex = step === "name" ? 1 : 2;

  return (
    <Screen bg={C.card}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.logoWrap}>
            <Image source={require("../assets/near_now_image_640.png")} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
          </View>

          <View style={styles.stepRow} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${stepIndex} of 2`}>
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={[styles.stepLine, step === "location" && styles.stepLineActive]} />
            <View style={[styles.stepDot, step === "location" && styles.stepDotActive]} />
          </View>

          <Collapsible open={step === "name"}>
            <View style={styles.stepContent}>
              <View style={styles.titleBlock}>
                <Text style={styles.stepTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                  Tell us about you
                </Text>
                <Text style={styles.stepSub} maxFontSizeMultiplier={1.3}>
                  We&apos;ll use this for your orders and receipts.
                </Text>
              </View>

              <View style={styles.row}>
                <View style={styles.flex}>
                  <Input
                    variant="underline"
                    label="First name"
                    placeholder="Riya"
                    value={firstName}
                    onChangeText={(t) => {
                      setFirstName(t);
                      if (firstNameError) setFirstNameError(null);
                    }}
                    error={firstNameError}
                    shakeTrigger={firstNameError ? shake : undefined}
                    autoFocus
                    autoCapitalize="words"
                    autoComplete="given-name"
                    textContentType="givenName"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.flex}>
                  <Input
                    variant="underline"
                    label="Last name (optional)"
                    placeholder="Sharma"
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                    autoComplete="family-name"
                    textContentType="familyName"
                    returnKeyType="done"
                    onSubmitEditing={handleContinue}
                  />
                </View>
              </View>

              <PrimaryButton size="lg" label="Continue" iconRight="arrow-right" iconSize={18} onPress={handleContinue} />
            </View>
          </Collapsible>

          <Collapsible open={step === "location"}>
            <View style={styles.stepContent}>
              <View style={styles.titleBlock}>
                <Text style={styles.stepTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                  Your delivery address
                </Text>
                <Text style={styles.stepSub} maxFontSizeMultiplier={1.3}>
                  Where should we send your orders?
                </Text>
              </View>

              {/* Permission priming: the value is on screen before the OS dialog ever appears (U8). */}
              <View style={styles.gpsBlock}>
                <Text style={styles.primeText} maxFontSizeMultiplier={1.3}>
                  We&apos;ll ask for location access so we can show stores and delivery times near you.
                </Text>
                <PrimaryButton
                  size="lg"
                  icon="crosshairs-gps"
                  label="Use current location"
                  onPress={() => void handleUseCurrentLocation()}
                  loading={gpsBusy || saving}
                  disabled={saving}
                />
                <Collapsible open={gpsDenied}>
                  <View style={styles.deniedRow} accessibilityLiveRegion="polite">
                    <Text style={styles.deniedText} maxFontSizeMultiplier={1.3}>
                      Location permission needed. Allow it in Settings, or pick your address below.
                    </Text>
                    <PrimaryButton size="xs" variant="ghost" label="Open settings" onPress={openSettings} />
                  </View>
                </Collapsible>
                <PrimaryButton
                  size="lg"
                  variant="outline"
                  icon="map-outline"
                  label="Pick on map"
                  onPress={() => void handlePickOnMap()}
                  disabled={saving || gpsBusy}
                />
              </View>

              <View style={styles.dividerRow}>
                <Divider spacing={0} style={styles.flex} />
                <Text style={styles.dividerText} maxFontSizeMultiplier={1.3}>
                  or type it in
                </Text>
                <Divider spacing={0} style={styles.flex} />
              </View>

              <View style={styles.chips} accessibilityRole="radiogroup">
                {LOCATION_LABELS.map((label) => {
                  const selected = locationLabel === label;
                  return (
                    <Chip
                      key={label}
                      label={label}
                      icon={LABEL_ICONS[label]}
                      selected={selected}
                      // `select` only when the press changes the selection; re-pressing the active chip is silent.
                      haptic={selected ? false : "select"}
                      accessibilityRole="radio"
                      onPress={() => setLocationLabel(label)}
                      accessibilityLabel={`Save as ${label}`}
                    />
                  );
                })}
              </View>

              <Input
                variant="underline"
                label="Address line"
                placeholder="Flat 4B, Rose Apartments, MG Road"
                value={addressLine}
                onChangeText={(t) => {
                  setAddressLine(t);
                  if (addressError) setAddressError(null);
                }}
                error={addressError}
                shakeTrigger={addressError ? shake : undefined}
                autoCapitalize="words"
                autoComplete="street-address"
                textContentType="fullStreetAddress"
                multiline
                returnKeyType="next"
              />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Input
                    variant="underline"
                    label="City"
                    placeholder="Bengaluru"
                    value={city}
                    onChangeText={(t) => {
                      setCity(t);
                      if (cityError) setCityError(null);
                    }}
                    error={cityError}
                    shakeTrigger={!addressError && cityError ? shake : undefined}
                    autoCapitalize="words"
                    textContentType="addressCity"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.pincodeCol}>
                  <Input
                    variant="underline"
                    label="Pincode"
                    placeholder="560001"
                    value={pincode}
                    onChangeText={(t) => setPincode(t.replace(/\D/g, ""))}
                    keyboardType="number-pad"
                    textContentType="postalCode"
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={() => void handleFinish()}
                  />
                </View>
              </View>

              <PrimaryButton
                size="lg"
                label="Start shopping"
                iconRight="shopping-outline"
                iconSize={18}
                onPress={() => void handleFinish()}
                loading={saving && !gpsBusy}
                disabled={gpsBusy}
              />

              <PrimaryButton size="sm" variant="ghost" icon="chevron-left" label="Back" onPress={handleBack} fullWidth={false} style={styles.backBtn} />
            </View>
          </Collapsible>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },

  logoWrap: { alignItems: "center", paddingTop: 20 },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT },

  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 28 },
  stepDot: { width: STEP_DOT, height: STEP_DOT, borderRadius: STEP_DOT / 2, backgroundColor: C.border },
  stepDotActive: { width: STEP_DOT_ACTIVE, height: STEP_DOT_ACTIVE, borderRadius: STEP_DOT_ACTIVE / 2, backgroundColor: C.primary },
  stepLine: { width: 40, height: 2, backgroundColor: C.border },
  stepLineActive: { backgroundColor: C.primary },

  stepContent: { gap: 20 },
  titleBlock: { gap: 8 },
  stepTitle: { fontFamily: fontFamily.extrabold, fontSize: 28, lineHeight: 34, color: C.text, letterSpacing: -0.3 },
  stepSub: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20, color: C.textSub },

  row: { flexDirection: "row", gap: layout.gutter },
  pincodeCol: { width: PINCODE_WIDTH },

  gpsBlock: { gap: 12 },
  primeText: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.textSub },
  deniedRow: {
    gap: 6,
    padding: 12,
    borderRadius: radius.xl,
    backgroundColor: C.warningLight,
    borderWidth: 1,
    borderColor: C.warningBorder,
  },
  deniedText: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.warningText },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerText: { fontFamily: fontFamily.medium, fontSize: 12, color: C.textSub },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backBtn: { alignSelf: "center" },
});
