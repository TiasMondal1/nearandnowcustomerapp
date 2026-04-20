import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { createAddress } from "../../lib/addressService";

const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  cream: "#FAFAF7",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  white: "#FFFFFF",
  pink: "#E91E63",
  cardBorder: "rgba(60,47,30,0.08)",
  shadow: "rgba(45,122,79,0.12)",
};

const LABELS = ["Home", "Work", "Other"] as const;

function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return null;
}

export default function AddAddressDetailsScreen() {
  const params = useLocalSearchParams<{
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
  }>();

  const { userId, user } = useAuth();
  const { setLocation } = useLocation();

  // Address label — maps to customer_saved_addresses.label (Home/Work/Other).
  const [label, setLabel] = useState<(typeof LABELS)[number]>("Home");

  // One consolidated address line replaces the old "House No." + "Building"
  // split. Whatever the user types here is concatenated with the formatted
  // address from Google for the final `address` column value.
  const [addressLine, setAddressLine] = useState("");
  const [landmark, setLandmark] = useState("");

  // Administrative fields — prefilled from Google place details when available.
  const [city, setCity] = useState(params.city || "");
  const [stateRegion, setStateRegion] = useState(params.state || "");
  const [pincode, setPincode] = useState(params.pincode || "");

  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  // Default contact on this saved address (can be edited per-order at checkout).
  const [contactName, setContactName] = useState(user?.name || "");
  const [contactPhone, setContactPhone] = useState(
    (user?.phone || "").replace("+91", ""),
  );

  const [isDefault, setIsDefault] = useState(false);

  const [placeName, setPlaceName] = useState(params.placeName || "");
  const [formattedAddress, setFormattedAddress] = useState(params.address || "");
  const [coords, setCoords] = useState({
    latitude: params.latitude ? parseFloat(params.latitude) : 22.5726,
    longitude: params.longitude ? parseFloat(params.longitude) : 88.3639,
  });

  const [region, setRegion] = useState<Region>({
    latitude: params.latitude ? parseFloat(params.latitude) : 22.5726,
    longitude: params.longitude ? parseFloat(params.longitude) : 88.3639,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  });

  const [saving, setSaving] = useState(false);

  // Briefly keep the pin "live" so Android re-snapshots it after the view has
  // fully painted. Using plain Views for the pin makes this mostly a belt-
  // and-braces for edge cases where the preview map finishes loading late.
  const [tracksChanges, setTracksChanges] = useState(true);
  useEffect(() => {
    setTracksChanges(true);
    const t = setTimeout(() => setTracksChanges(false), 700);
    return () => clearTimeout(t);
  }, [coords.latitude, coords.longitude]);

  const googlePlaceData = useMemo(() => {
    if (!params.google_place_data) return null;
    try {
      return JSON.parse(params.google_place_data);
    } catch {
      return null;
    }
  }, [params.google_place_data]);

  // `useLocalSearchParams()` returns a brand-new object every render, so we
  // deliberately depend on individual primitive fields to avoid an infinite
  // setState loop.
  const pLat = params.latitude;
  const pLng = params.longitude;
  const pAddress = params.address;
  const pPlaceName = params.placeName;
  const pCity = params.city;
  const pState = params.state;
  const pPincode = params.pincode;

  useEffect(() => {
    if (pLat && pLng) {
      const lat = parseFloat(pLat);
      const lng = parseFloat(pLng);
      setCoords({ latitude: lat, longitude: lng });
      setRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    }
  }, [pLat, pLng]);

  useEffect(() => {
    if (pAddress) setFormattedAddress(pAddress);
  }, [pAddress]);

  useEffect(() => {
    if (pPlaceName) setPlaceName(pPlaceName);
  }, [pPlaceName]);

  useEffect(() => {
    if (pCity) setCity(pCity);
  }, [pCity]);

  useEffect(() => {
    if (pState) setStateRegion(pState);
  }, [pState]);

  useEffect(() => {
    if (pPincode) setPincode(pPincode);
  }, [pPincode]);

  const handleChangeLocation = () => {
    router.back();
  };

  const handleSave = async () => {
    if (!formattedAddress || saving) return;

    if (!userId) {
      Alert.alert("Error", "Session expired. Please login again.");
      return;
    }

    if (!addressLine.trim()) {
      Alert.alert(
        "Missing details",
        "Please enter your house/flat and building details.",
      );
      return;
    }

    try {
      setSaving(true);

      const fullAddress = [addressLine.trim(), formattedAddress]
        .filter(Boolean)
        .join(", ");

      const normalizedContactPhone = contactPhone.trim()
        ? normalizeIndianPhone(contactPhone) ?? undefined
        : undefined;

      await createAddress(userId, {
        label,
        address: fullAddress,
        city: city.trim() || undefined,
        state: stateRegion.trim() || undefined,
        pincode: pincode.trim() || undefined,
        country: params.country || "India",
        latitude: coords.latitude,
        longitude: coords.longitude,
        google_place_id: params.google_place_id || undefined,
        google_formatted_address:
          params.google_formatted_address || formattedAddress || undefined,
        google_place_data: googlePlaceData ?? undefined,
        contact_name: contactName.trim() || user?.name || undefined,
        contact_phone: normalizedContactPhone,
        landmark: landmark.trim() || undefined,
        delivery_instructions: deliveryInstructions.trim() || undefined,
        // Receiver/delivery_for details are captured at checkout time now,
        // not on the address itself. Every saved address defaults to "self".
        delivery_for: "self",
        is_default: isDefault,
      });

      setLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        label,
        address: fullAddress,
        source: "saved",
      });

      // A single `replace` avoids the "GO_BACK not handled" crash that we saw
      // when popping the stack twice on a shallow navigator.
      router.replace("/(tabs)/home");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save address";
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)/home");
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={28}
                color={T.bark}
              />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Add Address Details</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.mapPreview}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              region={region}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Marker
                coordinate={coords}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={tracksChanges}
              >
                <View style={styles.pinWrap}>
                  <View style={styles.pinHead}>
                    <View style={styles.pinDot} />
                  </View>
                  <View style={styles.pinTail} />
                </View>
              </Marker>
            </MapView>
          </View>

          <View style={styles.locationCard}>
            <View style={styles.locationHeader}>
              <View style={styles.locationTextContainer}>
                <Text style={styles.locationName}>
                  {placeName || "Selected Location"}
                </Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {formattedAddress}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={handleChangeLocation}
                activeOpacity={0.8}
              >
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Address</Text>

            <TextInput
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
              placeholder="House / flat no., building name, floor…"
              placeholderTextColor={T.barkLight}
              value={addressLine}
              onChangeText={setAddressLine}
              multiline
            />

            <TextInput
              style={styles.input}
              placeholder="Landmark (Optional)"
              placeholderTextColor={T.barkLight}
              value={landmark}
              onChangeText={setLandmark}
            />

            <View style={styles.row2}>
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="City"
                placeholderTextColor={T.barkLight}
                value={city}
                onChangeText={setCity}
              />
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="State"
                placeholderTextColor={T.barkLight}
                value={stateRegion}
                onChangeText={setStateRegion}
              />
            </View>

            <TextInput
              style={styles.input}
              placeholder="Pincode"
              placeholderTextColor={T.barkLight}
              keyboardType="number-pad"
              maxLength={6}
              value={pincode}
              onChangeText={(t) => setPincode(t.replace(/\D/g, ""))}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Save as</Text>
            <View style={styles.labelRow}>
              {LABELS.map((l) => (
                <TouchableOpacity
                  key={l}
                  onPress={() => setLabel(l)}
                  style={[styles.labelChip, label === l && styles.labelActive]}
                >
                  <Text
                    style={[
                      styles.labelText,
                      label === l && styles.labelTextActive,
                    ]}
                  >
                    {l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Instructions</Text>
            <TextInput
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
              placeholder="e.g. Don't ring bell, call on arrival, gate code…"
              placeholderTextColor={T.barkLight}
              value={deliveryInstructions}
              onChangeText={setDeliveryInstructions}
              multiline
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Contact</Text>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={T.barkLight}
              value={contactName}
              onChangeText={setContactName}
            />
            <View style={styles.phoneInputContainer}>
              <Text style={styles.phonePrefix}>+91</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Your phone number"
                placeholderTextColor={T.barkLight}
                keyboardType="number-pad"
                maxLength={10}
                value={contactPhone}
                onChangeText={(t) => setContactPhone(t.replace(/\D/g, ""))}
              />
            </View>
          </View>

          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => setIsDefault((v) => !v)}
              style={styles.defaultRow}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={isDefault ? "checkbox-marked" : "checkbox-blank-outline"}
                size={22}
                color={isDefault ? T.green : T.barkMid}
              />
              <Text style={styles.defaultText}>Set as default address</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveText}>
              {saving ? "Saving..." : "SAVE ADDRESS"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.white },
  container: { paddingBottom: 40 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: T.bark,
  },

  mapPreview: {
    height: 200,
    backgroundColor: T.sand,
  },
  map: {
    flex: 1,
  },

  pinWrap: {
    width: 32,
    height: 42,
    alignItems: "center",
    justifyContent: "flex-start",
    backgroundColor: "transparent",
  },
  pinHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: T.pink,
    borderWidth: 3,
    borderColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  pinDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: T.white,
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: T.pink,
    marginTop: -2,
  },

  locationCard: {
    backgroundColor: T.white,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  locationTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  locationName: {
    fontSize: 16,
    fontWeight: "700",
    color: T.bark,
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: 13,
    color: T.barkMid,
    lineHeight: 18,
  },
  changeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.green,
  },
  changeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: T.green,
  },

  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: T.bark,
    marginBottom: 12,
  },

  input: {
    backgroundColor: T.sand,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: T.bark,
    marginBottom: 12,
    fontWeight: "500",
  },
  row2: {
    flexDirection: "row",
    gap: 10,
  },
  flex1: { flex: 1 },

  labelRow: {
    flexDirection: "row",
    gap: 12,
  },
  labelChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.sand,
    borderWidth: 2,
    borderColor: T.sand,
    alignItems: "center",
  },
  labelActive: {
    backgroundColor: T.white,
    borderColor: T.bark,
  },
  labelText: {
    fontSize: 14,
    color: T.barkMid,
    fontWeight: "600",
  },
  labelTextActive: {
    color: T.bark,
    fontWeight: "700",
  },

  phoneInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.sand,
    borderRadius: 12,
    paddingLeft: 16,
    marginBottom: 12,
  },
  phonePrefix: {
    fontSize: 15,
    fontWeight: "600",
    color: T.bark,
    marginRight: 8,
  },
  phoneInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: T.bark,
    fontWeight: "500",
  },

  defaultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  defaultText: {
    fontSize: 14,
    fontWeight: "600",
    color: T.bark,
  },

  saveBtn: {
    marginHorizontal: 20,
    marginTop: 32,
    backgroundColor: T.pink,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: T.pink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveText: {
    color: T.white,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
