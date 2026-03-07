import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
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

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { createAddress } from "../../lib/addressService";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "AIzaSyAaEh8Qu-k6nT5BphpHcOUBOZ5RJ7F2QTQ";

const LABELS = ["Home", "Work", "Other"] as const;

export default function AddLocationScreen() {
  const { userId, user } = useAuth();
  const { setLocation } = useLocation();
  const isGeocodingRef = useRef(false);

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
    if (isGeocodingRef.current) return;

    isGeocodingRef.current = true;
    setReverseLoading(true);

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const json = await res.json();

      if (json.status === "OK" && json.results?.[0]) {
        setFormattedAddress(json.results[0].formatted_address);
      }
    } finally {
      setReverseLoading(false);
      isGeocodingRef.current = false;
    }
  }, []);

  const forwardGeocode = useCallback(async (address: string) => {
    if (!address || isForwardGeocodingRef.current) return;

    isForwardGeocodingRef.current = true;

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        address,
      )}&key=${GOOGLE_MAPS_API_KEY}`;

      const res = await fetch(url);
      const json = await res.json();

      if (json.status !== "OK" || !json.results?.[0]) return;

      const location = json.results[0].geometry.location;

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
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Add new address</Text>
          <Text style={styles.subtitle}>
            Move the pin to your exact delivery location
          </Text>

          {/* Map */}
          <View style={styles.mapWrap}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              region={region}
            >
              <Marker
                coordinate={coords}
                draggable
                onDragEnd={handleMarkerDragEnd}
              >
                <MaterialCommunityIcons
                  name="map-marker"
                  size={32}
                  color={C.primary}
                />
              </Marker>
            </MapView>

            <TouchableOpacity
              style={styles.locateBtn}
              onPress={goToCurrentLocation}
            >
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.addressBox}>
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

            {reverseLoading && (
              <Text style={styles.updatingText}>Updating location…</Text>
            )}
          </View>

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

          {label === "Other" && (
            <TextInput
              style={styles.input}
              placeholder="Custom label (e.g. Mom's house)"
              placeholderTextColor={C.textLight}
              value={customLabel}
              onChangeText={setCustomLabel}
            />
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivering for</Text>

            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.toggleChip,
                  deliveryFor === "me" && styles.toggleActive,
                ]}
                onPress={() => setDeliveryFor("me")}
              >
                <Text
                  style={[
                    styles.toggleText,
                    deliveryFor === "me" && styles.toggleTextActive,
                  ]}
                >
                  Me
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.toggleChip,
                  deliveryFor === "other" && styles.toggleActive,
                ]}
                onPress={() => setDeliveryFor("other")}
              >
                <Text
                  style={[
                    styles.toggleText,
                    deliveryFor === "other" && styles.toggleTextActive,
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
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveText}>
              {saving ? "Saving…" : "Save address"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { padding: 20, paddingBottom: 40 },

  title: { fontSize: 24, fontWeight: "900", color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: C.textSub, marginTop: 6, marginBottom: 18, lineHeight: 20 },

  mapWrap: {
    height: 240,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  locateBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },

  addressBox: {
    marginTop: 18,
    padding: 16,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },

  labelRow: { flexDirection: "row", gap: 12, marginTop: 20 },
  labelChip: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  labelActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  labelText: { fontSize: 14, color: C.textSub, fontWeight: "600" },
  labelTextActive: { color: "#fff", fontWeight: "800" },

  section: { marginTop: 24 },
  sectionTitle: { fontSize: 14, color: C.text, fontWeight: "800", marginBottom: 10, letterSpacing: 0.3 },

  toggleRow: { flexDirection: "row", gap: 12 },
  toggleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
  },
  toggleActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleText: { color: C.textSub, fontSize: 14, fontWeight: "600" },
  toggleTextActive: { color: "#fff", fontWeight: "800" },

  receiverBox: { marginTop: 16, gap: 12 },

  input: {
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.text,
    fontSize: 15,
    fontWeight: "500",
  },

  saveBtn: {
    marginTop: 32,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  saveText: { color: "#fff", fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },

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
  contactBtnText: { fontSize: 14, color: C.primary, fontWeight: "700" },

  addressInput: {
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
    minHeight: 50,
    maxHeight: 80,
    fontWeight: "500",
  },

  updatingText: { marginTop: 8, fontSize: 12, color: C.primary, fontWeight: "600" },
});
