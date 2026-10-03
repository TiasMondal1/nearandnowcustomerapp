// Edit address: ONE address (memory peek, then the cached list), the shared AddressForm prefilled — label,
// landmark, instructions, contact and the default toggle are finally editable (C18) — plus a small centre-pin
// map for re-pinning. Every network path has a `catch` (C16) and the active delivery location only changes
// when the edited address IS the active one (C17). (quartz, 2026-10-03)
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { PROVIDER_GOOGLE, type Region } from "react-native-maps";

import {
  AddressForm,
  EMPTY_ADDRESS_FORM,
  addressFormFromSaved,
  addressFormLabel,
  addressFormPhone,
  validateAddressForm,
  type AddressFormErrors,
  type AddressFormValue,
} from "../../components/location/AddressForm";
import { CentrePin } from "../../components/location/CentrePin";
import {
  BottomDock,
  EmptyState,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  notify,
  useDockHeight,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout, radius } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation, type ActiveLocation } from "../../context/LocationContext";
import {
  getUserAddresses,
  peekAddresses,
  setDefaultAddress,
  updateAddress,
  type SavedAddress,
  type UpdateAddressPayload,
} from "../../lib/addressService";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { feedback } from "../../lib/feedback";
import { logError } from "../../lib/logError";
import { reverseGeocode, type ReverseGeocodeResult } from "../../lib/placesService";

// ─── Constants / helpers ──────────────────────────────────────────────────────

type LatLng = { latitude: number; longitude: number };

const MAP_HEIGHT = 200;
const REGION_DELTA = 0.005;
/** Where the map opens for an address without coordinates (never persisted; the user pans to pin it). */
const DEFAULT_CENTRE: LatLng = { latitude: 22.5726, longitude: 88.3639 };
const SAME_PLACE_DEG = 1e-5;
const FORM_SKELETON_ROWS = [0, 1, 2, 3] as const;

function isValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function addressCoords(a: SavedAddress): LatLng | null {
  const lat = typeof a.latitude === "number" ? a.latitude : Number(a.latitude);
  const lng = typeof a.longitude === "number" ? a.longitude : Number(a.longitude);
  return isValidCoords(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

function regionFor(c: LatLng): Region {
  return { latitude: c.latitude, longitude: c.longitude, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA };
}

/** The edited row IS the active location: same spot or the same label + address line (C17). */
function isActiveAddress(active: ActiveLocation | null, a: SavedAddress): boolean {
  if (!active) return false;
  const coords = addressCoords(a);
  if (
    coords &&
    Math.abs(coords.latitude - active.latitude) < SAME_PLACE_DEG &&
    Math.abs(coords.longitude - active.longitude) < SAME_PLACE_DEG
  ) {
    return true;
  }
  return active.label === a.label && !!active.address && active.address === a.address;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditLocationScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const addressId = Array.isArray(id) ? id[0] : id;
  const { userId } = useAuth();
  const uid = userId ?? "";
  const { location: activeLocation, setLocation } = useLocation();
  const dockHeight = useDockHeight();

  // ── Load ONE address: memory first, else the cached list (never the whole book per keystroke) ──
  const [address, setAddress] = useState<SavedAddress | null>(() =>
    uid && addressId ? peekAddresses(uid)?.find((a) => a.id === addressId) ?? null : null,
  );
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const formTouchedRef = useRef(false);

  const [form, setForm] = useState<AddressFormValue>(() => (address ? addressFormFromSaved(address) : EMPTY_ADDRESS_FORM));
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [shake, setShake] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // ── Pin: coords + the formatted line they geocode to (null = unchanged from the saved row) ──
  const [coords, setCoords] = useState<LatLng | null>(() => (address ? addressCoords(address) : null));
  const [geo, setGeo] = useState<ReverseGeocodeResult | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const geoBusyRef = useRef(false);
  const geoPendingRef = useRef<LatLng | null>(null);
  const geoSeqRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyLoaded = useCallback((found: SavedAddress) => {
    setAddress(found);
    if (!formTouchedRef.current) setForm(addressFormFromSaved(found));
    setCoords((prev) => prev ?? addressCoords(found));
  }, []);

  const load = useCallback(async () => {
    if (!uid || !addressId) {
      setNotFound(true);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoadError(null);
    setNotFound(false);
    try {
      let found = peekAddresses(uid)?.find((a) => a.id === addressId);
      if (!found) found = (await getUserAddresses(uid)).find((a) => a.id === addressId);
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      if (!found) {
        setNotFound(true);
        return;
      }
      applyLoaded(found);
    } catch (err) {
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      logError("Load address", err);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the address");
    }
  }, [uid, addressId, applyLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFormChange = (next: AddressFormValue) => {
    formTouchedRef.current = true;
    setForm(next);
  };

  // ── Reverse geocode on settle: queue-latest, latest wins ──
  const runGeocode = useCallback(async (lat: number, lng: number): Promise<void> => {
    if (geoBusyRef.current) {
      geoPendingRef.current = { latitude: lat, longitude: lng };
      return;
    }
    geoBusyRef.current = true;
    const seq = ++geoSeqRef.current;
    setGeocoding(true);
    try {
      const result = await reverseGeocode(lat, lng); // null on failure / Dev_Quartz_inhibit_ReverseGeocode, never throws
      if (mountedRef.current && seq === geoSeqRef.current && !geoPendingRef.current) setGeo(result);
    } finally {
      geoBusyRef.current = false;
      const next = geoPendingRef.current;
      if (next) {
        geoPendingRef.current = null;
        void runGeocode(next.latitude, next.longitude);
      } else if (mountedRef.current) {
        setGeocoding(false);
      }
    }
  }, []);

  const handleRegionChange = () => {
    if (!draggingRef.current) {
      draggingRef.current = true;
      setDragging(true);
    }
  };

  const handleRegionChangeComplete = (region: Region) => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (!wasDragging) return; // the initial layout settle is not a move
    setDragging(false);
    if (!isValidCoords(region.latitude, region.longitude)) return;
    setCoords({ latitude: region.latitude, longitude: region.longitude });
    feedback.select();
    void runGeocode(region.latitude, region.longitude);
  };

  // ── Save ──
  const failInline = (message: string, nextErrors: AddressFormErrors = {}) => {
    setErrors(nextErrors);
    setSaveError(Object.keys(nextErrors).length ? null : message);
    setShake((n) => n + 1);
    feedback.error();
    notify({ id: "address-save", title: message, tone: "error" });
  };

  const goBackToList = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/location");
  };

  const handleSave = async () => {
    if (savingRef.current || !address) return;
    Keyboard.dismiss();

    const nextErrors = validateAddressForm(form);
    if (Object.keys(nextErrors).length > 0) {
      failInline("Check the highlighted fields", nextErrors);
      return;
    }
    if (!uid) {
      failInline("Please log in again to edit an address");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setErrors({});
    try {
      const houseLine = [form.houseNo.trim(), form.floor.trim()].filter(Boolean).join(", ");
      const formatted = (geo?.formatted_address ?? address.google_formatted_address ?? "").trim();
      const fullAddress = [houseLine, formatted].filter(Boolean).join(", ") || address.address;
      const wasActive = isActiveAddress(activeLocation, address);

      const payload: UpdateAddressPayload = {
        label: addressFormLabel(form),
        address: fullAddress,
        landmark: form.landmark.trim() || null,
        delivery_instructions: form.instructions.trim() || null,
        contact_name: form.receiverName.trim() || null,
        contact_phone: addressFormPhone(form) ?? null,
      };
      if (coords) {
        payload.latitude = coords.latitude;
        payload.longitude = coords.longitude;
      }
      if (geo) {
        payload.google_formatted_address = geo.formatted_address;
        payload.google_place_id = geo.place_id ?? null;
        payload.city = geo.components.city ?? null;
        payload.state = geo.components.state ?? null;
        payload.pincode = geo.components.pincode ?? null;
        payload.country = geo.components.country ?? null;
      }
      // Turning the default OFF travels with the patch; turning it ON goes through setDefaultAddress so the
      // other rows are cleared (locally and server-side).
      if (address.is_default && !form.isDefault) payload.is_default = false;

      const updated = await updateAddress(address.id, uid, payload);
      if (form.isDefault && !address.is_default) await setDefaultAddress(address.id, uid);

      // C17: never switch the active delivery location unless this address IS the active one.
      if (wasActive && coords) {
        setLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          label: updated.label || payload.label || address.label,
          address: updated.address || fullAddress,
          source: "saved",
        });
      }

      feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
      notify({ id: "address-saved", title: "Address updated", tone: "success" });
      goBackToList();
    } catch (err) {
      logError("Update address", err);
      failInline(err instanceof Error ? err.message : "Couldn't update the address");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  // ─── States ─────────────────────────────────────────────────────────────────

  // Dev_Onyx_inhibit_SkeletonExit forces the skeleton like every other screen (W3 R3-08). Hook before any return.
  const showSkeleton = useForceSkeleton(!address && !loadError && !notFound);

  if (notFound) {
    return (
      <Screen bg={C.card} edges={["top"]}>
        <ScreenHeader title="Edit address" backFallbackHref="/location" />
        <EmptyState
          fill
          iconWrap
          icon="map-marker-off-outline"
          title="Address not found"
          text="It may have been deleted on another device"
          action={{ label: "Back to addresses", onPress: goBackToList }}
        />
      </Screen>
    );
  }

  if (!address && loadError) {
    return (
      <Screen bg={C.card} edges={["top"]}>
        <ScreenHeader title="Edit address" backFallbackHref="/location" />
        <EmptyState
          fill
          icon="cloud-off-outline"
          title="Couldn't load the address"
          text={loadError}
          action={{ label: "Retry", onPress: () => void load() }}
        />
      </Screen>
    );
  }

  if (!address || showSkeleton) {
    return (
      <Screen bg={C.card} edges={["top"]}>
        <ScreenHeader title="Edit address" backFallbackHref="/location" />
        <SkeletonScreen label="Loading address…" style={styles.skeletonWrap}>
          <Skeleton height={MAP_HEIGHT} radius={radius.card} style={styles.skeletonMap} />
          {FORM_SKELETON_ROWS.map((i) => (
            <View key={i} style={styles.skeletonField}>
              <Skeleton width="30%" height={12} />
              <Skeleton height={16} width={i % 2 === 0 ? "85%" : "60%"} style={styles.skeletonLine} />
            </View>
          ))}
        </SkeletonScreen>
      </Screen>
    );
  }

  const mapCentre = coords ?? DEFAULT_CENTRE;
  const pinHint = coords ? "Move the map to adjust the pin" : "Move the map to pin this address";
  const geoLine = geo?.formatted_address ?? address.google_formatted_address ?? address.address;

  return (
    <Screen bg={C.card} edges={["top"]}>
      <ScreenHeader title="Edit address" backFallbackHref="/location" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: dockHeight + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The clip (r16) sits on an INNER view so the CentrePin's lift elevation survives on Android (MAP §7.4, W3 R3-16). */}
          <View style={styles.mapWrap}>
            <View style={styles.mapClip}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              initialRegion={regionFor(mapCentre)}
              onRegionChange={handleRegionChange}
              onRegionChangeComplete={handleRegionChangeComplete}
              pitchEnabled={false}
              rotateEnabled={false}
              toolbarEnabled={false}
              showsMyLocationButton={false}
              loadingEnabled
              loadingIndicatorColor={C.primary}
              loadingBackgroundColor={C.bgSoft}
              accessibilityLabel="Map, move to position the pin"
            />
            </View>
            <CentrePin lifted={dragging} />
          </View>
          <Text style={styles.mapHint} maxFontSizeMultiplier={1.3}>
            {pinHint}
          </Text>
          <Text style={styles.geoLine} numberOfLines={2} maxFontSizeMultiplier={1.3} accessibilityLiveRegion="polite">
            {geocoding ? "Finding address…" : geoLine}
          </Text>

          <AddressForm value={form} onChange={handleFormChange} errors={errors} shakeTrigger={shake} style={styles.form} testID="edit-address-form" />

          {saveError ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
              {saveError}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomDock>
        <PrimaryButton size="lg" label="Save changes" onPress={() => void handleSave()} loading={saving} disabled={geocoding} />
      </BottomDock>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: layout.scrollBottomTab },
  mapWrap: {
    height: MAP_HEIGHT,
    marginHorizontal: layout.gutter,
    marginTop: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgSoft,
  },
  mapClip: { ...StyleSheet.absoluteFillObject, borderRadius: radius.card - 1, overflow: "hidden" },
  mapHint: { fontFamily: fontFamily.medium, fontSize: 12, color: C.textSub, marginHorizontal: layout.gutter, marginTop: 10 },
  geoLine: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: C.text, marginHorizontal: layout.gutter, marginTop: 4 },
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
  skeletonWrap: { paddingHorizontal: layout.gutter, paddingTop: 12 },
  skeletonMap: { marginBottom: 20 },
  skeletonField: { marginBottom: 20 },
  skeletonLine: { marginTop: 10 },
});
