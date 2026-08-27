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
    View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";

import {
  Card,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonText,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { getUserAddresses, updateAddress } from "../../lib/addressService";
import { reverseGeocode as reverseGeocodeApi, geocodeAddress } from "../../lib/placesService";

const LABELS = ["Home", "Work", "Other"] as const;

export default function EditLocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { setLocation } = useLocation();

  const isReverseRef = useRef(false);
  const isForwardRef = useRef(false);
  const pendingReverseRef = useRef<{ lat: number; lng: number } | null>(null);
  const pendingForwardRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState<(typeof LABELS)[number]>("Home");
  const [customLabel, setCustomLabel] = useState("");

  const [deliveryFor, setDeliveryFor] = useState<"me" | "other">("me");

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
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    return null;
  };

  useEffect(() => {
    if (!id || !userId) return;

    (async () => {
      try {
        const locations = await getUserAddresses(userId);
        const loc = locations.find((l) => l.id === id);

        if (!loc) {
          Alert.alert("Error", "Address not found");
          router.back();
          return;
        }

        const resolvedLabel = LABELS.includes(loc.label as (typeof LABELS)[number])
          ? (loc.label as (typeof LABELS)[number])
          : "Other";
        setLabel(resolvedLabel);
        setCustomLabel(resolvedLabel === "Other" ? loc.label : "");

        setFormattedAddress(loc.address);
        setCoords({
          latitude: loc.latitude ?? 0,
          longitude: loc.longitude ?? 0,
        });
        setRegion({
          latitude: loc.latitude ?? 0,
          longitude: loc.longitude ?? 0,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });

        setDeliveryFor(loc.delivery_for === "others" ? "other" : "me");
        setReceiverName(loc.receiver_name || "");
        setReceiverNickname("");
        setReceiverPhone(loc.receiver_phone?.replace("+91", "") ?? "");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, userId]);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    // Queue-latest-while-busy: a call arriving while one's already in
    // flight used to be silently dropped instead of re-run, leaving
    // formattedAddress stale relative to wherever the pin ended up.
    if (isReverseRef.current) {
      pendingReverseRef.current = { lat, lng };
      return;
    }
    isReverseRef.current = true;

    try {
      const json = await reverseGeocodeApi(lat, lng);
      if (json.status === "OK" && json.results?.[0]) {
        setFormattedAddress(json.results[0].formatted_address);
      }
    } finally {
      isReverseRef.current = false;
      const pending = pendingReverseRef.current;
      if (pending) {
        pendingReverseRef.current = null;
        reverseGeocode(pending.lat, pending.lng);
      }
    }
  }, []);

  const forwardGeocode = useCallback(async (address: string) => {
    if (!address) return;
    if (isForwardRef.current) {
      pendingForwardRef.current = address;
      return;
    }
    isForwardRef.current = true;

    try {
      const json = await geocodeAddress(address);
      if (json.status === "OK" && json.results?.[0]) {
        const { lat, lng } = json.results[0].geometry.location;
        setCoords({ latitude: lat, longitude: lng });
        setRegion((r) => ({ ...r, latitude: lat, longitude: lng }));
      }
    } finally {
      isForwardRef.current = false;
      const pending = pendingForwardRef.current;
      if (pending) {
        pendingForwardRef.current = null;
        forwardGeocode(pending);
      }
    }
  }, []);

  const handleSave = async () => {
    if (!formattedAddress || saving || !id || !userId) return;

    try {
      setSaving(true);

      const finalLabel = label === "Other" ? customLabel.trim() : label;
      const normalizedReceiverPhone =
        deliveryFor === "other" && receiverPhone.trim()
          ? normalizeIndianPhone(receiverPhone)
          : null;

      await updateAddress(String(id), userId, {
        label: finalLabel || "Saved",
        address: formattedAddress,
        latitude: coords.latitude,
        longitude: coords.longitude,
        delivery_for: deliveryFor === "other" ? "others" : "self",
        receiver_name: deliveryFor === "other" ? receiverName.trim() : null,
        receiver_phone: deliveryFor === "other" ? normalizedReceiverPhone : null,
      });

      setLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        label: finalLabel,
        address: formattedAddress,
        source: "saved",
      });

      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update address";
      Alert.alert("Saved addresses", message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // Same chrome as the loaded screen, but never mount MapView/Marker here:
    // region is still (0,0) until the address fetch completes.
    return (
      <Screen>
        <ScreenHeader title="Edit address" />
        <View style={styles.container}>
          <Text style={styles.subtitle}>
            Move the pin to your exact delivery location
          </Text>
          <Skeleton height={240} radius={16} style={styles.skeletonMap} />
          <Card style={styles.addressBox}>
            <SkeletonText lines={2} lineHeight={11} lastLineWidth="70%" />
          </Card>
          <Skeleton height={52} radius={16} style={styles.saveBtn} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Edit address" />
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
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  setCoords({ latitude, longitude });
                  setRegion((r) => ({ ...r, latitude, longitude }));
                  reverseGeocode(latitude, longitude);
                }}
                anchor={{ x: 0.5, y: 1 }}
              >
                <MaterialCommunityIcons
                  name="map-marker"
                  size={32}
                  color={C.primary}
                />
              </Marker>
            </MapView>
          </View>

          <Card style={styles.addressBox}>
            <TextInput
              style={styles.addressInput}
              value={formattedAddress}
              multiline
              onChangeText={setFormattedAddress}
              onBlur={() => forwardGeocode(formattedAddress)}
              placeholder="Address"
              placeholderTextColor={C.textLight}
            />
          </Card>

          <PrimaryButton
            size="lg"
            shadow
            label={saving ? "Saving…" : "Update address"}
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
  skeletonMap: { borderWidth: 1, borderColor: C.border },

  addressBox: { marginTop: 16 },

  addressInput: {
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
    minHeight: 50,
    maxHeight: 80,
    fontFamily: "PlusJakartaSans_500Medium",
  },

  saveBtn: { marginTop: 24 },
});
