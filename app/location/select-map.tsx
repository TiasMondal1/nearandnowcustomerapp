import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

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

const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  "AIzaSyAaEh8Qu-k6nT5BphpHcOUBOZ5RJ7F2QTQ";

export default function SelectMapLocationScreen() {
  const [searchQuery, setSearchQuery] = useState("");
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
  const [locationName, setLocationName] = useState("Baghajatin Place");
  const [locationAddress, setLocationAddress] = useState(
    "Baghajatin Colony, Tal Pukar, Kolkata",
  );
  const [loading, setLoading] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);

  const isGeocodingRef = useRef(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
        const result = json.results[0];
        const addressComponents = result.address_components;

        const neighborhood =
          addressComponents.find((c: any) =>
            c.types.includes("neighborhood"),
          )?.long_name ||
          addressComponents.find((c: any) =>
            c.types.includes("sublocality_level_2"),
          )?.long_name ||
          "";

        const sublocality =
          addressComponents.find((c: any) =>
            c.types.includes("sublocality_level_1"),
          )?.long_name || "";

        const city =
          addressComponents.find((c: any) => c.types.includes("locality"))
            ?.long_name || "";

        setLocationName(neighborhood || sublocality || "Selected Location");
        setLocationAddress(result.formatted_address);
      }
    } catch (error) {
      console.error("Reverse geocoding failed:", error);
    } finally {
      setReverseLoading(false);
      isGeocodingRef.current = false;
    }
  }, []);

  const getCurrentLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;
      setCoords({ latitude, longitude });
      setRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });

      reverseGeocode(latitude, longitude);
    } catch (error) {
      console.error("Failed to get current location:", error);
    }
  }, [reverseGeocode]);

  useEffect(() => {
    void getCurrentLocation();
  }, [getCurrentLocation]);

  const handleSearch = (text: string) => {
    setSearchQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!text.trim()) return;

    searchTimeoutRef.current = setTimeout(() => {
      forwardGeocode(text);
    }, 1000);
  };

  const forwardGeocode = async (address: string) => {
    if (!address.trim()) return;

    setLoading(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        address,
      )}&key=${GOOGLE_MAPS_API_KEY}`;

      const res = await fetch(url);
      const json = await res.json();

      if (json.status === "OK" && json.results?.[0]) {
        const location = json.results[0].geometry.location;
        const latitude = location.lat;
        const longitude = location.lng;

        setCoords({ latitude, longitude });
        setRegion({
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });

        reverseGeocode(latitude, longitude);
      }
    } catch (error) {
      console.error("Forward geocoding failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkerDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setCoords({ latitude, longitude });
    reverseGeocode(latitude, longitude);
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
  };

  const handleCenterMap = () => {
    setCoords({ latitude: region.latitude, longitude: region.longitude });
    reverseGeocode(region.latitude, region.longitude);
  };

  const handleConfirmLocation = () => {
    router.push({
      pathname: "/location/add-details",
      params: {
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        address: locationAddress,
        placeName: locationName,
      },
    });
  };

  const handleMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Please enable location permissions",
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;
      setCoords({ latitude, longitude });
      setRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });

      reverseGeocode(latitude, longitude);
    } catch (error) {
      Alert.alert("Error", "Failed to get your current location");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
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
        <Text style={styles.headerTitle}>Select Your Location</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={T.barkLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for apartment, street name..."
            placeholderTextColor={T.barkLight}
            value={searchQuery}
            onChangeText={handleSearch}
          />
          {loading && <ActivityIndicator size="small" color={T.green} />}
        </View>
      </View>

      <View style={styles.mapContainer}>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          region={region}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
        >
          <Marker
            coordinate={coords}
            draggable
            onDragEnd={handleMarkerDragEnd}
          >
            <View style={styles.markerContainer}>
              <MaterialCommunityIcons
                name="map-marker"
                size={48}
                color={T.pink}
              />
            </View>
          </Marker>
        </MapView>

        <View style={styles.tooltipContainer}>
          <View style={styles.tooltip}>
            <Text style={styles.tooltipTitle}>Order will be delivered here</Text>
            <Text style={styles.tooltipSubtitle}>
              Place the pin to your exact location
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.myLocationBtn}
          onPress={handleMyLocation}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={24}
            color={T.white}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.centerBtn}
          onPress={handleCenterMap}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="target" size={20} color={T.green} />
        </TouchableOpacity>
      </View>

      <View style={styles.bottomSheet}>
        <View style={styles.locationInfo}>
          <MaterialCommunityIcons
            name="map-marker"
            size={24}
            color={T.green}
          />
          <View style={styles.locationTextContainer}>
            <Text style={styles.locationName}>
              {reverseLoading ? "Loading..." : locationName}
            </Text>
            <Text style={styles.locationAddress} numberOfLines={2}>
              {reverseLoading ? "Fetching address..." : locationAddress}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={handleConfirmLocation}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmBtnText}>Confirm Location</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: T.white,
  },
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
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.sand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: T.bark,
    fontWeight: "500",
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipContainer: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    alignItems: "center",
  },
  tooltip: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    maxWidth: "90%",
  },
  tooltipTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: T.white,
    textAlign: "center",
    marginBottom: 2,
  },
  tooltipSubtitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.8)",
    textAlign: "center",
  },
  myLocationBtn: {
    position: "absolute",
    bottom: 180,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.pink,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  centerBtn: {
    position: "absolute",
    bottom: 250,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: T.green,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  bottomSheet: {
    backgroundColor: T.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 12,
  },
  locationInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
    gap: 12,
  },
  locationTextContainer: {
    flex: 1,
  },
  locationName: {
    fontSize: 18,
    fontWeight: "700",
    color: T.bark,
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: 14,
    color: T.barkMid,
    lineHeight: 20,
  },
  confirmBtn: {
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
  confirmBtnText: {
    fontSize: 17,
    fontWeight: "800",
    color: T.white,
    letterSpacing: 0.3,
  },
});
