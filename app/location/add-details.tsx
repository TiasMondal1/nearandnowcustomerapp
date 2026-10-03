// Add address details: the shared AddressForm over the spot pinned on select-map. Save is optimistic
// (createAddress → setDefaultAddress when toggled → setLocation) and unwinds to `returnTo` (checkout / Home /
// the address book) or pops — never `replace("/(tabs)/home")` while a returnTo exists (U2; quartz, 2026-10-03).
// Validation and save failures stay inline (errors map + shake + one error haptic + toast), no Alert.
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  AddressForm,
  EMPTY_ADDRESS_FORM,
  addressFormLabel,
  addressFormPhone,
  validateAddressForm,
  type AddressFormErrors,
  type AddressFormValue,
} from "../../components/location/AddressForm";
import {
  BottomDock,
  EmptyState,
  IconWrap,
  PrimaryButton,
  Screen,
  ScreenHeader,
  notify,
  useDockHeight,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout, radius } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { createAddress, parseReturnTo, setDefaultAddress } from "../../lib/addressService";
import { feedback } from "../../lib/feedback";
import { logError } from "../../lib/logError";
import { logSilentFailure } from "../../lib/logSilentFailure";

// ─── Params / helpers ─────────────────────────────────────────────────────────

type AddDetailsParams = {
  latitude?: string;
  longitude?: string;
  address?: string;
  placeName?: string;
  google_place_id?: string;
  google_formatted_address?: string;
  google_place_data?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  returnTo?: string;
};

const PLACE_ICON = 44;
const PLACE_GLYPH = 22;

function isValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** The account phone as the 10 local digits the form shows ("+91 98765 43210" → "9876543210"). */
function localPhoneDigits(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function parsePlaceData(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AddAddressDetailsScreen(): React.JSX.Element {
  const params = useLocalSearchParams<AddDetailsParams>();
  const returnTo = parseReturnTo(params.returnTo);
  const lat = Number(params.latitude);
  const lng = Number(params.longitude);
  const coordsValid = isValidCoords(lat, lng);
  const formatted = (params.google_formatted_address || params.address || "").trim();
  const placeName = (params.placeName || "").trim();

  const { userId, user } = useAuth();
  const { setLocation } = useLocation();
  const dockHeight = useDockHeight();

  const [form, setForm] = useState<AddressFormValue>(() => ({
    ...EMPTY_ADDRESS_FORM,
    receiverName: user?.name ?? "",
    receiverPhone: localPhoneDigits(user?.phone),
  }));
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [shake, setShake] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const leave = () => {
    if (returnTo) router.dismissTo(returnTo);
    else if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  };

  const openMap = () => {
    if (router.canGoBack()) router.back();
    else router.replace(returnTo ? { pathname: "/location/select-map", params: { returnTo } } : "/location/select-map");
  };

  const failInline = (message: string, nextErrors: AddressFormErrors = {}) => {
    setErrors(nextErrors);
    setSaveError(Object.keys(nextErrors).length ? null : message);
    setShake((n) => n + 1);
    // One error haptic for the whole submit; the toast sees it in its 300 ms window and stays silent.
    feedback.error();
    notify({ id: "address-save", title: message, tone: "error" });
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    Keyboard.dismiss();

    const nextErrors = validateAddressForm(form);
    if (Object.keys(nextErrors).length > 0) {
      failInline("Check the highlighted fields", nextErrors);
      return;
    }
    if (!userId) {
      failInline("Please log in again to save an address");
      return;
    }
    if (!coordsValid) {
      failInline("Pick the spot on the map first");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setErrors({});
    try {
      // "<house line>, <formatted>" — addressFormFromSaved recovers the house line by stripping the formatted suffix.
      const houseLine = [form.houseNo.trim(), form.floor.trim()].filter(Boolean).join(", ");
      const fullAddress = [houseLine, formatted].filter(Boolean).join(", ");

      const saved = await createAddress(userId, {
        label: addressFormLabel(form),
        address: fullAddress,
        city: params.city?.trim() || undefined,
        state: params.state?.trim() || undefined,
        pincode: params.pincode?.trim() || undefined,
        country: params.country?.trim() || "India",
        latitude: lat,
        longitude: lng,
        google_place_id: params.google_place_id || undefined,
        google_formatted_address: formatted || undefined,
        google_place_data: parsePlaceData(params.google_place_data) ?? undefined,
        // Default contact on this saved address (editable per order at checkout).
        contact_name: form.receiverName.trim() || user?.name || undefined,
        contact_phone: addressFormPhone(form),
        landmark: form.landmark.trim() || undefined,
        delivery_instructions: form.instructions.trim() || undefined,
        // Receiver / delivery_for details are captured at checkout time, not on the address itself.
        delivery_for: "self",
        is_default: form.isDefault,
      });

      // The POST carries is_default; the explicit PATCH guarantees the other addresses are cleared server-side.
      if (form.isDefault && saved.id && !saved.id.startsWith("optimistic:")) {
        try {
          await setDefaultAddress(saved.id, userId);
        } catch (err) {
          logSilentFailure("Set default address", err);
          notify({ id: "address-default", title: "Saved, but couldn't set it as default", tone: "warning" });
        }
      }

      setLocation({ latitude: lat, longitude: lng, label: saved.label, address: saved.address, source: "saved" });
      feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
      notify({ id: "address-saved", title: "Address saved", tone: "success" });
      leave();
    } catch (err) {
      logError("Save address", err);
      failInline(err instanceof Error ? err.message : "Couldn't save the address");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!coordsValid) {
    return (
      <Screen bg={C.card} edges={["top"]}>
        <ScreenHeader title="Add address" backFallbackHref={returnTo ?? "/(tabs)/home"} />
        <EmptyState
          fill
          iconWrap
          icon="map-marker-off-outline"
          title="Pick a location first"
          text="Choose the delivery spot on the map before adding the details"
          action={{ label: "Open map", onPress: openMap }}
        />
      </Screen>
    );
  }

  return (
    <Screen bg={C.card} edges={["top"]}>
      <ScreenHeader title="Add address" backFallbackHref={returnTo ?? "/(tabs)/home"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: dockHeight + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.placeRow} accessible accessibilityLabel={`Delivering to ${placeName ? `${placeName}, ` : ""}${formatted || "pinned location"}`}>
            <IconWrap size={PLACE_ICON} bg="transparent" icon="map-marker" iconSize={PLACE_GLYPH} iconColor={C.primary} />
            <View style={styles.placeCol}>
              <Text style={styles.placeName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {placeName || "Pinned location"}
              </Text>
              {formatted ? (
                <Text style={styles.placeAddress} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                  {formatted}
                </Text>
              ) : null}
            </View>
            <PrimaryButton size="xs" variant="ghost" label="Change" onPress={openMap} accessibilityLabel="Change location on the map" />
          </View>

          <AddressForm value={form} onChange={setForm} errors={errors} shakeTrigger={shake} style={styles.form} testID="add-address-form" />

          {saveError ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
              {saveError}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomDock>
        <PrimaryButton size="lg" label="Save address" onPress={() => void handleSave()} loading={saving} />
      </BottomDock>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: layout.scrollBottomTab },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: layout.gutter,
    paddingRight: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  placeCol: { flex: 1 },
  placeName: { fontFamily: fontFamily.bold, fontSize: 15, color: C.text },
  placeAddress: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: C.textSub, marginTop: 2 },
  form: { paddingHorizontal: layout.gutter, paddingTop: 16 },
  saveError: {
    marginHorizontal: layout.gutter,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: C.dangerLight,
    color: C.danger,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
  },
});
