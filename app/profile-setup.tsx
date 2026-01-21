import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
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
import { saveSession } from "../session";

///// api contexts fixed with gtp 5 < recheck later || 5+ redundant info >

const PRIMARY = "#765fba";
const API_BASE = "http://192.168.1.117:3001";
const GOOGLE_MAPS_API_KEY = "AIzaSyAaEh8Qu-k6nT5BphpHcOUBOZ5RJ7F2QTQ";

export default function ProfileSetupScreen() {
  const params = useLocalSearchParams();
  const phone = typeof params.phone === "string" ? params.phone : "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const isGeocodingRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [house, setHouse] = useState("");
  const [street, setStreet] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [formattedAddress, setFormattedAddress] = useState("");

  const [region, setRegion] = useState<Region>({
    latitude: 22.5726,
    longitude: 88.3639,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }>(
    {
      latitude: 22.5726,
      longitude: 88.3639,
    },
  );

  const [loading, setLoading] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);

  const hasAddressFields =
    house.trim().length > 0 ||
    street.trim().length > 0 ||
    area.trim().length > 0 ||
    city.trim().length > 0 ||
    stateName.trim().length > 0 ||
    postalCode.trim().length > 0;

  const emailTrimmed = email.trim().toLowerCase();
  const emailValid = /\S+@\S+\.\S+/.test(emailTrimmed);
  const passwordValid = password.trim().length >= 6;

  const isValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    emailValid &&
    passwordValid &&
    hasAddressFields &&
    coords.latitude != null &&
    coords.longitude != null;

  const goToCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location access is required.");
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
      Alert.alert("Error", "Could not fetch location.");
    }
  };

  const buildAddressString = () => {
    const parts = [
      house.trim(),
      street.trim(),
      area.trim(),
      city.trim(),
      stateName.trim(),
      postalCode.trim(),
    ].filter(Boolean);
    return parts.join(", ");
  };

  const reverseGeocode = useCallback(
    async (latitude: number, longitude: number) => {
      console.log("RG called with:", latitude, longitude);

      if (!GOOGLE_MAPS_API_KEY) {
        console.log("❌ No Google Maps API key");
        return;
      }

      if (isGeocodingRef.current) {
        console.log("⏳ Geocode locked");
        return;
      }

      isGeocodingRef.current = true;
      setReverseLoading(true);

      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
        console.log("Fetching:", url);

        const res = await fetch(url);
        const json = await res.json();

        console.log("Geocode response:", json);

        if (json.status !== "OK" || !json.results?.[0]) {
          console.log("❌ No valid geocode result");
          return;
        }

        const result = json.results[0];
        setFormattedAddress(result.formatted_address || "");
        console.log("✅ Address:", result.formatted_address);
      } catch (e) {
        console.log("❌ Geocode error:", e);
      } finally {
        setReverseLoading(false);
        isGeocodingRef.current = false;
      }
    },
    [],
  );

  const handleRegionChangeComplete = (r: Region) => {
    setRegion(r);

    const { latitude, longitude } = r;

    setCoords({ latitude, longitude });

    setTimeout(() => {
      reverseGeocode(latitude, longitude);
    }, 400);
  };

  const handleMarkerDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setCoords({ latitude, longitude });
    setRegion((prev) => ({
      ...prev,
      latitude,
      longitude,
    }));
    reverseGeocode(latitude, longitude);
  };

  const handleNext = async () => {
    if (!isValid || loading) return;
    if (!phone) {
      Alert.alert("Error", "Missing phone.");
      return;
    }
    try {
      setLoading(true);
      const addressString = buildAddressString() || formattedAddress;
      const res = await fetch(`${API_BASE}/auth/signup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name: `${firstName.trim()} ${lastName.trim()}`,
          address: addressString,
          latitude: coords.latitude,
          longitude: coords.longitude,
          email: emailTrimmed,
          password: password.trim(),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        Alert.alert("Error", json.error || "Could not complete signup");
        return;
      }

      if (json.token && json.user) {
        await saveSession({
          token: json.token,
          user: {
            id: json.user.id,
            name: json.user.name,
            role: json.user.role,
            isActivated:
              json.user.isActivated ?? json.user.is_activated ?? false,
            phone: json.user.phone ?? phone,
          },
        });
      }

      router.replace("/home");
    } catch {
      Alert.alert("Error", "Network error, please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.container}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <Text style={styles.pageName}>Profile setup</Text>
              <Text style={styles.title}>Tell us about you</Text>
              <Text style={styles.subtitle}>
                We’ll use this to make deliveries smoother and more accurate.
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.row}>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>First name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="John"
                    placeholderTextColor="#8278A6"
                  />
                </View>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>Last name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Doe"
                    placeholderTextColor="#8278A6"
                  />
                </View>
              </View>

              <View style={styles.inputBlock}>
                <Text style={styles.label}>Phone</Text>
                <View style={styles.phoneRow}>
                  <Text style={styles.phoneText}>
                    {phone || "+91 ••••••••••"}
                  </Text>
                </View>
              </View>

              <View style={styles.inputBlock}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#8278A6"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {!emailValid && emailTrimmed.length > 0 && (
                  <Text style={styles.errorText}>
                    Please enter a valid email address.
                  </Text>
                )}
              </View>

              <View style={styles.inputBlock}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a password"
                  placeholderTextColor="#8278A6"
                  secureTextEntry
                />
                {!passwordValid && password.length > 0 && (
                  <Text style={styles.errorText}>
                    Password must be at least 6 characters.
                  </Text>
                )}
              </View>

              <View style={styles.inputBlock}>
                <Text style={styles.label}>Map location</Text>
                {formattedAddress ? (
                  <Text style={styles.addressPreview}>
                    {formattedAddress}
                    {reverseLoading ? " • updating..." : ""}
                  </Text>
                ) : (
                  <Text style={styles.addressPreviewMuted}>
                    Move the pin to your exact location
                    {reverseLoading ? " • updating..." : ""}
                  </Text>
                )}

                <View style={styles.mapContainer}>
                  <MapView
                    style={styles.map}
                    provider={PROVIDER_GOOGLE}
                    region={region}
                  >
                    <Marker
                      coordinate={{
                        latitude: region.latitude,
                        longitude: region.longitude,
                      }}
                      draggable
                      onDragEnd={handleMarkerDragEnd}
                      anchor={{ x: 0.5, y: 1 }}
                    >
                      <MaterialCommunityIcons
                        name="map-marker"
                        size={29}
                        color={PRIMARY}
                      />
                    </Marker>
                  </MapView>

                  <TouchableOpacity
                    style={styles.locationBtn}
                    onPress={goToCurrentLocation}
                  >
                    <Text style={styles.locationBtnText}>◎</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.twoColumnRow}>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>House / Flat</Text>
                  <TextInput
                    style={styles.textInput}
                    value={house}
                    onChangeText={setHouse}
                    placeholder="House no., flat"
                    placeholderTextColor="#8278A6"
                  />
                </View>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>Street</Text>
                  <TextInput
                    style={styles.textInput}
                    value={street}
                    onChangeText={setStreet}
                    placeholder="Street / road"
                    placeholderTextColor="#8278A6"
                  />
                </View>
              </View>

              <View style={styles.twoColumnRow}>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>Area / Locality</Text>
                  <TextInput
                    style={styles.textInput}
                    value={area}
                    onChangeText={setArea}
                    placeholder="Area / locality"
                    placeholderTextColor="#8278A6"
                  />
                </View>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>City</Text>
                  <TextInput
                    style={styles.textInput}
                    value={city}
                    onChangeText={setCity}
                    placeholder="City"
                    placeholderTextColor="#8278A6"
                  />
                </View>
              </View>

              <View style={styles.twoColumnRow}>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>State</Text>
                  <TextInput
                    style={styles.textInput}
                    value={stateName}
                    onChangeText={setStateName}
                    placeholder="State"
                    placeholderTextColor="#8278A6"
                  />
                </View>
                <View style={styles.halfInputBlock}>
                  <Text style={styles.label}>PIN code</Text>
                  <TextInput
                    style={styles.textInput}
                    value={postalCode}
                    onChangeText={setPostalCode}
                    placeholder="PIN code"
                    placeholderTextColor="#8278A6"
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>
          </ScrollView>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              activeOpacity={isValid && !loading ? 0.85 : 1}
              onPress={handleNext}
              disabled={!isValid || loading}
              style={[
                styles.button,
                (!isValid || loading) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {loading ? "Saving..." : "Next"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backRow}
              onPress={() => router.back()}
            >
              <Text style={styles.backText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const BG = "#05030A";

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    paddingTop: 24,
    gap: 6,
    marginBottom: 16,
  },
  pageName: {
    fontSize: 11,
    color: "#9C94D7",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: "#C4BDEA",
  },
  form: {
    gap: 18,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  twoColumnRow: {
    flexDirection: "row",
    gap: 12,
  },
  halfInputBlock: {
    flex: 1,
  },
  inputBlock: {
    width: "100%",
  },
  label: {
    fontSize: 13,
    color: "#B3A9E6",
    marginBottom: 6,
  },
  textInput: {
    borderRadius: 14,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#FFFFFF",
    fontSize: 15,
  },
  phoneRow: {
    borderRadius: 14,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  phoneText: {
    color: "#FFFFFF",
    fontSize: 15,
  },
  mapContainer: {
    marginTop: 8,
    borderRadius: 18,
    overflow: "hidden",
    height: 180,
    borderWidth: 1,
    borderColor: "#3A2D68",
  },
  map: {
    flex: 1,
  },
  addressPreview: {
    fontSize: 12,
    color: "#C4BDEA",
  },
  addressPreviewMuted: {
    fontSize: 12,
    color: "#7A6FB3",
  },
  errorText: {
    marginTop: 4,
    fontSize: 11,
    color: "#FF7A7A",
  },
  bottomSection: {
    marginTop: 12,
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
  },
  buttonDisabled: {
    backgroundColor: "rgba(118, 95, 186, 0.45)",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  backRow: {
    alignItems: "center",
  },
  backText: {
    fontSize: 12,
    color: "#C4BDEA",
  },

  locationBtn: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#120D24",
    borderWidth: 1,
    borderColor: "#392B6A",
    alignItems: "center",
    justifyContent: "center",
  },
  locationBtnText: {
    color: "#FFFFFF",
    fontSize: 20,
  },

  iconPin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
});
