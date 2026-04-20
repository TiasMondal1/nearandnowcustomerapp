import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
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

export default function AddAddressDetailsScreen() {
  const params = useLocalSearchParams<{
    latitude?: string;
    longitude?: string;
    address?: string;
    placeName?: string;
  }>();

  const { userId, user } = useAuth();
  const { setLocation } = useLocation();

  const [label, setLabel] = useState<(typeof LABELS)[number]>("Home");
  const [houseNo, setHouseNo] = useState("");
  const [building, setBuilding] = useState("");
  const [landmark, setLandmark] = useState("");

  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");

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

  useEffect(() => {
    if (params.latitude && params.longitude) {
      const lat = parseFloat(params.latitude);
      const lng = parseFloat(params.longitude);
      setCoords({ latitude: lat, longitude: lng });
      setRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    }
    if (params.address) {
      setFormattedAddress(params.address);
    }
    if (params.placeName) {
      setPlaceName(params.placeName);
    }
  }, [params]);

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

  const handleChangeLocation = () => {
    router.back();
  };

  const handleSave = async () => {
    if (!formattedAddress || saving) return;

    if (!userId) {
      Alert.alert("Error", "Session expired. Please login again.");
      return;
    }

    try {
      setSaving(true);

      const fullAddress = [houseNo, building, formattedAddress]
        .filter(Boolean)
        .join(", ");

      const contactName = receiverName.trim() || user?.name || "";

      await createAddress(userId, {
        label: label,
        address: fullAddress,
        latitude: coords.latitude,
        longitude: coords.longitude,
        contact_name: contactName || undefined,
        contact_phone: receiverPhone.trim()
          ? normalizeIndianPhone(receiverPhone) ?? undefined
          : undefined,
        landmark: landmark.trim() || undefined,
        delivery_for: receiverName.trim() ? "others" : "self",
        receiver_name: receiverName.trim() || undefined,
        receiver_phone: receiverPhone.trim()
          ? normalizeIndianPhone(receiverPhone) ?? undefined
          : undefined,
        is_default: false,
      });

      setLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        label: label,
        address: fullAddress,
        source: "saved",
      });

      if (router.canGoBack()) {
        router.back();
        router.back();
      } else {
        router.replace("/(tabs)/home");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save address";
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
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(tabs)/home");
                }
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="chevron-left" size={28} color={T.bark} />
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
              <Marker coordinate={coords}>
                <MaterialCommunityIcons
                  name="map-marker"
                  size={40}
                  color={T.pink}
                />
              </Marker>
            </MapView>
          </View>

          <View style={styles.locationCard}>
            <View style={styles.locationHeader}>
              <View style={styles.locationTextContainer}>
                <Text style={styles.locationName}>{placeName || "Selected Location"}</Text>
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
            <Text style={styles.sectionTitle}>Add Address</Text>

            <TextInput
              style={styles.input}
              placeholder="House No. & Floor *"
              placeholderTextColor={T.barkLight}
              value={houseNo}
              onChangeText={setHouseNo}
            />

            <TextInput
              style={styles.input}
              placeholder="Building & Block No. (Optional)"
              placeholderTextColor={T.barkLight}
              value={building}
              onChangeText={setBuilding}
            />

            <TextInput
              style={styles.input}
              placeholder="Landmark & Area Name (Optional)"
              placeholderTextColor={T.barkLight}
              value={landmark}
              onChangeText={setLandmark}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add Address Label</Text>
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
            <Text style={styles.sectionTitle}>Receiver Details</Text>

            <View style={styles.receiverInputContainer}>
              <TextInput
                style={styles.receiverInput}
                placeholder="Receiver's Name"
                placeholderTextColor={T.barkLight}
                value={receiverName}
                onChangeText={setReceiverName}
              />
              <TouchableOpacity
                style={styles.contactIconBtn}
                onPress={pickFromContacts}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="account-box"
                  size={24}
                  color={T.bark}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.phoneInputContainer}>
              <Text style={styles.phonePrefix}>+91</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Receiver's Phone Number"
                placeholderTextColor={T.barkLight}
                keyboardType="number-pad"
                maxLength={10}
                value={receiverPhone}
                onChangeText={(text) => {
                  const digitsOnly = text.replace(/\D/g, "");
                  setReceiverPhone(digitsOnly);
                }}
              />
            </View>
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

  receiverInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.sand,
    borderRadius: 12,
    paddingRight: 12,
    marginBottom: 12,
  },
  receiverInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: T.bark,
    fontWeight: "500",
  },
  contactIconBtn: {
    padding: 4,
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

  saveBtn: {
    marginHorizontal: 20,
    marginTop: 32,
    backgroundColor: T.sand,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveText: {
    color: T.bark,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
