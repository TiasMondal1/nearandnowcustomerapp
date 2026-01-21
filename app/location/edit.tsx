import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
const GOOGLE_MAPS_API_KEY = "AIzaSyAaEh8Qu-k6nT5BphpHcOUBOZ5RJ7F2QTQ";

const PRIMARY = "#765fba";
const BG = "#05030A";
const LABELS = ["Home", "Work", "Other"] as const;

export default function EditLocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setLocation } = useLocation();

  const isReverseRef = useRef(false);
  const isForwardRef = useRef(false);

  /* ------------------ State ------------------ */

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [label, setLabel] =
    useState<(typeof LABELS)[number]>("Home");
  const [customLabel, setCustomLabel] = useState("");

  const [deliveryFor, setDeliveryFor] =
    useState<"me" | "other">("me");

  const [receiverName, setReceiverName] = useState("");
  const [receiverNickname, setReceiverNickname] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");

  const [formattedAddress, setFormattedAddress] = useState("");
  const [coords, setCoords] = useState({ latitude: 0, longitude: 0 });

  const [region, setRegion] = useState<Region>({
    latitude: 0,
    longitude: 0,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  /* ------------------ Helpers ------------------ */

  const normalizeIndianPhone = (input: string) => {
    const digits = input.replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith("91"))
      return `+${digits}`;
    return null;
  };

  /* ------------------ Load existing ------------------ */

  useEffect(() => {
    if (!id) return;

    (async () => {
      try {
        const session = await getSession();
        if (!session?.token) return;

        const res = await fetch(`${API_BASE}/customer/locations`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });

        const json = await res.json();
        const loc = json.locations?.find((l: any) => l.id === id);

        if (!loc) {
          Alert.alert("Error", "Address not found");
          router.back();
          return;
        }

        setLabel(
          LABELS.includes(loc.label)
            ? loc.label
            : "Other"
        );
        setCustomLabel(
          LABELS.includes(loc.label) ? "" : loc.label
        );

        setFormattedAddress(loc.address);
        setCoords({
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
        setRegion({
          latitude: loc.latitude,
          longitude: loc.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });

        if (loc.contact_name) {
          setDeliveryFor("other");
          setReceiverName(loc.contact_name);
          setReceiverPhone(
            loc.contact_phone?.replace("+91", "") ?? ""
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* ------------------ Geocoding ------------------ */

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    if (isReverseRef.current) return;
    isReverseRef.current = true;

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const json = await res.json();
      if (json.status === "OK") {
        setFormattedAddress(json.results[0].formatted_address);
      }
    } finally {
      isReverseRef.current = false;
    }
  }, []);

  const forwardGeocode = useCallback(async (address: string) => {
    if (!address || isForwardRef.current) return;
    isForwardRef.current = true;

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address
        )}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const json = await res.json();
      if (json.status === "OK") {
        const { lat, lng } = json.results[0].geometry.location;
        setCoords({ latitude: lat, longitude: lng });
        setRegion((r) => ({ ...r, latitude: lat, longitude: lng }));
      }
    } finally {
      isForwardRef.current = false;
    }
  }, []);

  /* ------------------ Save ------------------ */

  const handleSave = async () => {
    if (!formattedAddress || saving) return;

    try {
      setSaving(true);
      const session = await getSession();
      if (!session?.token) return;

      const finalLabel =
        label === "Other" ? customLabel.trim() : label;

      const contactName =
        deliveryFor === "other"
          ? receiverNickname.trim()
            ? `${receiverName} (${receiverNickname})`
            : receiverName
          : null;

      const res = await fetch(
        `${API_BASE}/customer/locations/${id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: finalLabel || "Saved",
            address: formattedAddress,
            latitude: coords.latitude,
            longitude: coords.longitude,
            contact_name: contactName,
            contact_phone:
              deliveryFor === "other" && receiverPhone
                ? normalizeIndianPhone(receiverPhone)
                : null,
          }),
        }
      );

      const json = await res.json();
      if (!json.success) {
        Alert.alert("Error", "Could not update address");
        return;
      }

      setLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        label: finalLabel,
        address: formattedAddress,
        source: "saved",
      });

      router.back();
    } finally {
      setSaving(false);
    }
  };

  /* ------------------ UI ------------------ */

  if (loading) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Edit address</Text>

          {/* MAP */}
          <View style={styles.mapWrap}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              region={region}
            >
              <Marker
                coordinate={coords}
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } =
                    e.nativeEvent.coordinate;
                  setCoords({ latitude, longitude });
                  setRegion((r) => ({ ...r, latitude, longitude }));
                  reverseGeocode(latitude, longitude);
                }}
              >
                <MaterialCommunityIcons
                  name="map-marker"
                  size={32}
                  color={PRIMARY}
                />
              </Marker>
            </MapView>
          </View>

          {/* ADDRESS */}
          <View style={styles.addressBox}>
            <TextInput
              style={styles.addressInput}
              value={formattedAddress}
              multiline
              onChangeText={setFormattedAddress}
              onBlur={() => forwardGeocode(formattedAddress)}
              placeholder="Address"
              placeholderTextColor="#7A6FB3"
            />
          </View>

          {/* SAVE */}
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
          >
            <Text style={styles.saveText}>
              {saving ? "Saving…" : "Update address"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------ Styles ------------------ */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },

  mapWrap: {
    height: 220,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#3A2D68",
    marginTop: 16,
  },

  addressBox: {
    marginTop: 14,
    padding: 14,
    backgroundColor: "#120D24",
    borderRadius: 14,
  },

  addressInput: {
    fontSize: 13,
    color: "#EAE6FF",
    minHeight: 44,
    maxHeight: 96,
  },

  saveBtn: {
    marginTop: 26,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },

  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
