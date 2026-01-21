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

import { getSession } from "../../session";
import { useLocation } from "./locationContent";

const API_BASE = "http://192.168.1.117:3001";

const PRIMARY = "#765fba";
const BG = "#05030A";
const GOOGLE_MAPS_API_KEY = "AIzaSyAaEh8Qu-k6nT5BphpHcOUBOZ5RJ7F2QTQ";

const LABELS = ["Home", "Work", "Other"] as const;

export default function AddLocationScreen() {
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

    try {
      setSaving(true);
      const session = await getSession();
      if (!session?.token) return;

      const finalLabel = label === "Other" ? customLabel.trim() : label;

      const contactName =
        deliveryFor === "me"
          ? (session.user?.name ?? null)
          : receiverNickname.trim()
            ? `${receiverName.trim()} (${receiverNickname.trim()})`
            : receiverName.trim();

      const res = await fetch(`${API_BASE}/customer/locations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: finalLabel || "Saved location",
          address: formattedAddress,
          latitude: coords.latitude,
          longitude: coords.longitude,
          contact_name: deliveryFor === "other" ? contactName : null,
          contact_phone:
            deliveryFor === "other" && receiverPhone.trim()
              ? normalizeIndianPhone(receiverPhone)
              : null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        Alert.alert("Error", "Could not save address.");
        return;
      }

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
                  color={PRIMARY}
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
              placeholderTextColor="#7A6FB3"
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
              placeholder="Custom label (e.g. Mom’s house)"
              placeholderTextColor="#7A6FB3"
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
                  color={PRIMARY}
                />
                <Text style={styles.contactBtnText}>Pick from contacts</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder="Receiver name"
                placeholderTextColor="#7A6FB3"
                value={receiverName}
                onChangeText={setReceiverName}
              />

              <TextInput
                style={styles.input}
                placeholder="Nickname (optional)"
                placeholderTextColor="#7A6FB3"
                value={receiverNickname}
                onChangeText={setReceiverNickname}
              />

              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor="#7A6FB3"
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
  safe: { flex: 1, backgroundColor: BG },
  container: { padding: 20, paddingBottom: 32 },

  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 13, color: "#C4BDEA", marginTop: 4, marginBottom: 14 },

  mapWrap: {
    height: 220,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#3A2D68",
  },
  locateBtn: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },

  addressBox: {
    marginTop: 14,
    padding: 14,
    backgroundColor: "#120D24",
    borderRadius: 14,
  },
  addressText: { fontSize: 13, color: "#EAE6FF" },

  labelRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  labelChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
  },
  labelActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  labelText: { fontSize: 13, color: "#C4BDEA" },
  labelTextActive: { color: "#fff", fontWeight: "600" },

  section: { marginTop: 22 },
  sectionTitle: { fontSize: 13, color: "#B3A9E6", marginBottom: 8 },

  toggleRow: { flexDirection: "row", gap: 10 },
  toggleChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    alignItems: "center",
  },
  toggleActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  toggleText: { color: "#C4BDEA", fontSize: 13 },
  toggleTextActive: { color: "#fff", fontWeight: "600" },

  receiverBox: { marginTop: 14, gap: 10 },

  input: {
    borderRadius: 14,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#fff",
  },

  saveBtn: {
    marginTop: 26,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "600" },

  contactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    alignSelf: "flex-start",
  },

  contactBtnText: {
    fontSize: 13,
    color: PRIMARY,
    fontWeight: "500",
  },

  addressInput: {
    fontSize: 13,
    color: "#EAE6FF",
    lineHeight: 25,
    minHeight: 44,
    maxHeight: 75,
  },

  updatingText: {
    marginTop: 6,
    fontSize: 11,
    color: "#9C94D7",
  },
});
