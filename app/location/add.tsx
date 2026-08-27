import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
    ActivityIndicator,
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

import {
  Card,
  IconButton,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SectionLabel,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { createAddress } from "../../lib/addressService";
import { reverseGeocode as reverseGeocodeApi, geocodeAddress } from "../../lib/placesService";

const LABELS = ["Home", "Work", "Other"] as const;

export default function AddLocationScreen() {
  const { userId, user } = useAuth();
  const { setLocation } = useLocation();
  const isGeocodingRef = useRef(false);
  const pendingReverseGeocodeRef = useRef<{ lat: number; lng: number } | null>(null);

  const [label, setLabel] = useState<(typeof LABELS)[number]>("Home");
  const [customLabel, setCustomLabel] = useState("");

  const [deliveryFor, setDeliveryFor] = useState<"me" | "other">("me");

  const [receiverName, setReceiverName] = useState("");
  const [receiverNickname, setReceiverNickname] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");

  const [formattedAddress, setFormattedAddress] = useState("");
  const [coords, setCoords] = useState({
    latitude: 22.5726,
    longitude: 88.3639,
  });

  const [region, setRegion] = useState<Region>({
    latitude: 22.5726,
    longitude: 88.3639,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const [saving, setSaving] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const isForwardGeocodingRef = useRef(false);
  const pendingForwardGeocodeRef = useRef<string | null>(null);

  function normalizeIndianPhone(input: string): string | null {
    const digits = input.replace(/\D/g, "");

    if (digits.length === 12 && digits.startsWith("91")) {
      return `+${digits}`;
    }

    if (digits.length === 10) {
      return `+91${digits}`;
    }

    return null;
  }

  const pickFromContacts = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission required",
          "Allow contacts access to pick a phone number",
        );
        return;
      }

      const contact = await Contacts.presentContactPickerAsync();

      if (!contact) return;

      const name =
        contact.name ||
        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();

      const phone = contact.phoneNumbers?.[0]?.number ?? "";

      const normalized = normalizeIndianPhone(phone);

      if (!normalized) {
        Alert.alert(
          "Invalid number",
          "Selected contact does not have a valid Indian mobile number",
        );
        return;
      }

      setReceiverName(name);
      setReceiverPhone(normalized.replace("+91", ""));
    } catch (e) {
      Alert.alert("Error", "Could not open contacts");
    }
  };

  const goToCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please allow location access.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = loc.coords;

      setCoords({ latitude, longitude });
      setRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });

      reverseGeocode(latitude, longitude);
    } catch {
      Alert.alert("Error", "Unable to fetch location.");
    }
  };

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    // Previously a plain in-flight guard: a second drag arriving before the
    // first call's network response landed was silently dropped (no queue,
    // no re-run), leaving formattedAddress showing the *previous* pin's
    // address while the marker itself sat at the new position. Now the
    // latest coordinates while busy are remembered and re-run once the
    // in-flight call finishes, so the displayed address always converges on
    // wherever the pin actually ended up.
    if (isGeocodingRef.current) {
      pendingReverseGeocodeRef.current = { lat, lng };
      return;
    }

    isGeocodingRef.current = true;
    setReverseLoading(true);

    try {
      const json = await reverseGeocodeApi(lat, lng);

      if (json.status === "OK" && json.results?.[0]) {
        setFormattedAddress(json.results[0].formatted_address);
      }
    } finally {
      setReverseLoading(false);
      isGeocodingRef.current = false;
      const pending = pendingReverseGeocodeRef.current;
      if (pending) {
        pendingReverseGeocodeRef.current = null;
        reverseGeocode(pending.lat, pending.lng);
      }
    }
  }, []);

  const forwardGeocode = useCallback(async (address: string) => {
    if (!address) return;
    // Same queue-latest-while-busy treatment as reverseGeocode above.
    if (isForwardGeocodingRef.current) {
      pendingForwardGeocodeRef.current = address;
      return;
    }

    isForwardGeocodingRef.current = true;

    try {
      const json = await geocodeAddress(address);

      if (json.status !== "OK" || !json.results?.[0]) return;

      const { location } = json.results[0].geometry;

      const latitude = location.lat;
      const longitude = location.lng;

      setCoords({ latitude, longitude });
      setRegion((r) => ({
        ...r,
        latitude,
        longitude,
      }));
    } finally {
      isForwardGeocodingRef.current = false;
      const pending = pendingForwardGeocodeRef.current;
      if (pending) {
        pendingForwardGeocodeRef.current = null;
        forwardGeocode(pending);
      }
    }
  }, []);

  const handleMarkerDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setCoords({ latitude, longitude });
    setRegion((r) => ({ ...r, latitude, longitude }));
    reverseGeocode(latitude, longitude);
  };

  const handleSave = async () => {
    if (!formattedAddress || saving) return;

    if (deliveryFor === "other" && !receiverName.trim()) {
      Alert.alert("Missing info", "Please enter receiver name.");
      return;
    }

    if (!userId) {
      Alert.alert("Error", "Session expired. Please login again.");
      return;
    }

    try {
      setSaving(true);

      const finalLabel = label === "Other" ? customLabel.trim() : label;
      const contactName =
        deliveryFor === "me"
          ? (user?.name ?? "")
          : receiverNickname.trim()
            ? `${receiverName.trim()} (${receiverNickname.trim()})`
            : receiverName.trim();

      await createAddress(userId, {
        label: finalLabel || "Saved location",
        address: formattedAddress,
        latitude: coords.latitude,
        longitude: coords.longitude,
        contact_name: contactName || undefined,
        contact_phone:
          deliveryFor === "other" && receiverPhone.trim()
            ? normalizeIndianPhone(receiverPhone) ?? undefined
            : undefined,
        delivery_for: deliveryFor === "other" ? "others" : "self",
        receiver_name: deliveryFor === "other" ? receiverName.trim() : undefined,
        receiver_phone:
          deliveryFor === "other" && receiverPhone.trim()
            ? normalizeIndianPhone(receiverPhone) ?? undefined
            : undefined,
        is_default: false,
      });

      setLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        label: finalLabel || "Saved location",
        address: formattedAddress,
        source: "saved",
      });

      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save address";
      Alert.alert("Saved addresses", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Add new address" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.subtitle}>
            Move the pin to your exact delivery location
          </Text>

          {/* Map */}
          <View style={styles.mapWrap}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              region={region}
              loadingEnabled
              loadingIndicatorColor={C.primary}
              loadingBackgroundColor={C.bgSoft}
            >
              <Marker
                coordinate={coords}
                draggable
                onDragEnd={handleMarkerDragEnd}
                anchor={{ x: 0.5, y: 1 }}
              >
                <MaterialCommunityIcons
                  name="map-marker"
                  size={32}
                  color={C.primary}
                />
              </Marker>
            </MapView>

            <IconButton
              icon="crosshairs-gps"
              iconSize={20}
              size={44}
              bg={C.primary}
              color={C.card}
              shadow="primarySm"
              accessibilityLabel="Use my current location"
              onPress={goToCurrentLocation}
              style={styles.locateBtn}
            />
          </View>

          <Card style={styles.addressBox}>
            <TextInput
              style={styles.addressInput}
              placeholder="Enter or edit address"
              placeholderTextColor={C.textLight}
              value={formattedAddress}
              scrollEnabled
              multiline
              textAlignVertical="top"
              onChangeText={setFormattedAddress}
              onBlur={() => {
                forwardGeocode(formattedAddress);
              }}
            />

            <View style={styles.updatingRow}>
              {reverseLoading && (
                <>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={styles.updatingText}>Updating location…</Text>
                </>
              )}
            </View>
          </Card>

          <View style={styles.labelRow}>
            {LABELS.map((l) => (
              <TouchableOpacity
                key={l}
                onPress={() => setLabel(l)}
                style={[styles.chip, label === l && styles.chipActive]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: label === l }}
              >
                <Text
                  style={[
                    styles.chipText,
                    label === l && styles.chipTextActive,
                  ]}
                >
                  {l}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {label === "Other" && (
            <TextInput
              style={[styles.input, styles.customLabelInput]}
              placeholder="Custom label (e.g. Mom's house)"
              placeholderTextColor={C.textLight}
              value={customLabel}
              onChangeText={setCustomLabel}
            />
          )}

          <View style={styles.section}>
            <SectionLabel>Delivering for</SectionLabel>

            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  deliveryFor === "me" && styles.chipActive,
                ]}
                onPress={() => setDeliveryFor("me")}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: deliveryFor === "me" }}
              >
                <Text
                  style={[
                    styles.chipText,
                    deliveryFor === "me" && styles.chipTextActive,
                  ]}
                >
                  Me
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.chip,
                  deliveryFor === "other" && styles.chipActive,
                ]}
                onPress={() => setDeliveryFor("other")}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: deliveryFor === "other" }}
              >
                <Text
                  style={[
                    styles.chipText,
                    deliveryFor === "other" && styles.chipTextActive,
                  ]}
                >
                  Someone else
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {deliveryFor === "other" && (
            <View style={styles.receiverBox}>
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={pickFromContacts}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <MaterialCommunityIcons
                  name="account-box"
                  size={18}
                  color={C.primary}
                />
                <Text style={styles.contactBtnText}>Pick from contacts</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder="Receiver name"
                placeholderTextColor={C.textLight}
                value={receiverName}
                onChangeText={setReceiverName}
              />

              <TextInput
                style={styles.input}
                placeholder="Nickname (optional)"
                placeholderTextColor={C.textLight}
                value={receiverNickname}
                onChangeText={setReceiverNickname}
              />

              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor={C.textLight}
                keyboardType="number-pad"
                maxLength={10}
                value={receiverPhone}
                onChangeText={(text) => {
                  const digitsOnly = text.replace(/\D/g, "");
                  setReceiverPhone(digitsOnly);
                }}
              />
            </View>
          )}

          {/* Save */}
          <PrimaryButton
            size="lg"
            shadow
            label={saving ? "Saving…" : "Save address"}
            onPress={handleSave}
            disabled={saving}
            style={styles.saveBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },

  subtitle: { ...text.body, marginBottom: 16 },

  mapWrap: {
    height: 240,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  locateBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
  },

  addressBox: { marginTop: 16 },

  labelRow: { flexDirection: "row", gap: 12, marginTop: 20 },
  customLabelInput: { marginTop: 12 },

  chip: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: { fontSize: 14, color: C.textSub, fontFamily: "PlusJakartaSans_600SemiBold" },
  chipTextActive: { color: C.card },

  section: { marginTop: 24 },
  toggleRow: { flexDirection: "row", gap: 12 },

  receiverBox: { marginTop: 16, gap: 12 },

  input: { fontFamily: "PlusJakartaSans_500Medium",
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.text,
    fontSize: 15,
  },

  saveBtn: { marginTop: 32 },

  contactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: C.primaryXLight,
  },
  contactBtnText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: C.primary },

  addressInput: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
    minHeight: 50,
    maxHeight: 80,
  },

  updatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 20,
    marginTop: 8,
  },
  updatingText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: C.primary },
});
