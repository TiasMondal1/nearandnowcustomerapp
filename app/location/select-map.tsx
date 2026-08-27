import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    Keyboard,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonText,
} from "../../components/ui";
import {
  reverseGeocode as reverseGeocodeApi,
  autocomplete as autocompleteApi,
  placeDetails as placeDetailsApi,
} from "../../lib/placesService";
import { logError } from "../../lib/logError";
import { logSilentFailure } from "../../lib/logSilentFailure";

const T = {
  green: "#2D7A4F",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  white: "#FFFFFF",
  pink: "#E91E63",
  cardBorder: "rgba(60,47,30,0.08)",
};

// Single Places Autocomplete session token keeps pricing correct across
// predictions+details within one user search.
function newSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type Prediction = {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
};

type PlaceDetails = {
  place_id: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  name?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  raw: any;
};

function extractAddressParts(components: any[]): Pick<
  PlaceDetails,
  "city" | "state" | "pincode" | "country"
> {
  const find = (type: string) =>
    components?.find((c) => c?.types?.includes(type))?.long_name ?? undefined;
  return {
    city:
      find("locality") ||
      find("postal_town") ||
      find("administrative_area_level_2") ||
      find("sublocality_level_1") ||
      undefined,
    state: find("administrative_area_level_1"),
    pincode: find("postal_code"),
    country: find("country"),
  };
}

export default function SelectMapLocationScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [predictionsOpen, setPredictionsOpen] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const sessionTokenRef = useRef<string>(newSessionToken());

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
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [reverseLoading, setReverseLoading] = useState(false);

  const insets = useSafeAreaInsets();

  // Presentational only: fade the predictions dropdown in when it opens.
  // (LayoutAnimation is avoided here — it flickers over MapView on Android.)
  const panelFade = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!predictionsOpen) {
      panelFade.setValue(0);
      return;
    }
    const anim = Animated.timing(panelFade, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [predictionsOpen, panelFade]);

  // Android's react-native-maps rasterises the custom marker view once and
  // caches that snapshot. If the icon font hasn't finished loading at that
  // moment, the marker ends up "half drawn". We flip `tracksViewChanges` on
  // for a short window whenever the pin moves, so the snapshot is retaken
  // after the glyph is definitely painted.
  const [tracksChanges, setTracksChanges] = useState(true);
  useEffect(() => {
    setTracksChanges(true);
    const t = setTimeout(() => setTracksChanges(false), 700);
    return () => clearTimeout(t);
  }, [coords.latitude, coords.longitude]);

  // Richer place data we carry forward to the add-details screen so the form
  // can prefill city / state / pincode, and so the insert into
  // customer_saved_addresses has google_place_id + google_formatted_address.
  const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null);

  const isGeocodingRef = useRef(false);
  const pendingReverseGeocodeRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    // Queue-latest-while-busy: a second drag arriving before the first
    // call's response lands used to be silently dropped, leaving the
    // displayed address stale relative to the pin's actual position.
    if (isGeocodingRef.current) {
      pendingReverseGeocodeRef.current = { lat, lng };
      return;
    }

    isGeocodingRef.current = true;
    setReverseLoading(true);

    try {
      const json = await reverseGeocodeApi(lat, lng);

      if (json.status === "OK" && json.results?.[0]) {
        const result = json.results[0];
        const addressComponents = result.address_components || [];

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

        const parts = extractAddressParts(addressComponents);

        setLocationName(neighborhood || sublocality || "Selected Location");
        setLocationAddress(result.formatted_address);
        setPlaceDetails({
          place_id: result.place_id,
          formatted_address: result.formatted_address,
          latitude: lat,
          longitude: lng,
          name: neighborhood || sublocality || undefined,
          ...parts,
          raw: result,
        });
      }
    } catch (error) {
      logSilentFailure("Reverse geocoding", error);
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
      logSilentFailure("Get current location", error);
    }
  }, [reverseGeocode]);

  useEffect(() => {
    void getCurrentLocation();
  }, [getCurrentLocation]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input.trim()) {
      setPredictions([]);
      setPredictionsOpen(false);
      return;
    }

    setPredicting(true);
    try {
      const json = await autocompleteApi(input, sessionTokenRef.current);

      if (json.status === "OK" && Array.isArray(json.predictions)) {
        const mapped: Prediction[] = json.predictions.map((p: any) => ({
          place_id: p.place_id,
          description: p.description,
          main_text: p.structured_formatting?.main_text || p.description,
          secondary_text: p.structured_formatting?.secondary_text || "",
        }));
        setPredictions(mapped);
        setPredictionsOpen(mapped.length > 0);
      } else if (json.status === "ZERO_RESULTS") {
        setPredictions([]);
        setPredictionsOpen(true);
      } else {
        if (json.error_message) {
          logSilentFailure(`Places Autocomplete (${json.status})`, json.error_message);
        }
        setPredictions([]);
        setPredictionsOpen(false);
      }
    } catch (err) {
      logSilentFailure("Places Autocomplete", err);
      setPredictions([]);
      setPredictionsOpen(false);
    } finally {
      setPredicting(false);
    }
  }, []);

  const handleSearch = (text: string) => {
    setSearchQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!text.trim()) {
      setPredictions([]);
      setPredictionsOpen(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      void fetchPredictions(text);
    }, 300);
  };

  const handleSelectPrediction = async (pred: Prediction) => {
    Keyboard.dismiss();
    setPredictionsOpen(false);
    setSearchQuery(pred.main_text);
    setReverseLoading(true);

    try {
      const json = await placeDetailsApi(pred.place_id, sessionTokenRef.current);

      // Per Google's guidance, rotate the session token after Details is used.
      sessionTokenRef.current = newSessionToken();

      if (json.status !== "OK" || !json.result) {
        Alert.alert("Sorry", "Couldn't load that place. Please pick another.");
        return;
      }

      const r = json.result;
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") {
        Alert.alert("Sorry", "This place has no coordinates.");
        return;
      }

      const parts = extractAddressParts(r.address_components || []);

      setCoords({ latitude: lat, longitude: lng });
      setRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setLocationName(pred.main_text);
      setLocationAddress(r.formatted_address || pred.description);
      setPlaceDetails({
        place_id: r.place_id,
        formatted_address: r.formatted_address || pred.description,
        latitude: lat,
        longitude: lng,
        name: pred.main_text,
        ...parts,
        raw: r,
      });
    } catch (err) {
      logError("Place details", err);
      Alert.alert("Error", "Could not load that place.");
    } finally {
      setReverseLoading(false);
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

  const handleConfirmLocation = () => {
    router.push({
      pathname: "/location/add-details",
      params: {
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        address: locationAddress,
        placeName: locationName,
        google_place_id: placeDetails?.place_id ?? "",
        google_formatted_address: placeDetails?.formatted_address ?? "",
        google_place_data: placeDetails?.raw
          ? JSON.stringify(placeDetails.raw)
          : "",
        city: placeDetails?.city ?? "",
        state: placeDetails?.state ?? "",
        pincode: placeDetails?.pincode ?? "",
        country: placeDetails?.country ?? "India",
      },
    });
  };

  const myLocationInFlightRef = useRef(false);

  const handleMyLocation = async () => {
    // Recenter button had no guard at all against a fast double-tap firing
    // two overlapping requestForegroundPermissionsAsync()/getCurrentPositionAsync()
    // calls — already try/catch'd so not a crash risk, just a wasted duplicate
    // native-module call.
    if (myLocationInFlightRef.current) return;
    myLocationInFlightRef.current = true;
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
    } finally {
      myLocationInFlightRef.current = false;
    }
  };

  return (
    <Screen bg={T.white} edges={["top"]}>
      <ScreenHeader
        title="Select Your Location"
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(tabs)/home");
          }
        }}
        backProps={{ bg: T.sand, color: T.bark }}
        titleStyle={styles.headerTitle}
        style={styles.header}
      />

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={T.barkLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for apartment, street name…"
            placeholderTextColor={T.barkLight}
            value={searchQuery}
            onChangeText={handleSearch}
            onFocus={() => {
              if (predictions.length > 0) setPredictionsOpen(true);
            }}
            returnKeyType="search"
          />
          {predicting && <ActivityIndicator size="small" color={T.green} />}
          {!predicting && searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery("");
                setPredictions([]);
                setPredictionsOpen(false);
              }}
              hitSlop={12}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={T.barkLight}
              />
            </TouchableOpacity>
          )}
        </View>

        {predictionsOpen && (
          <Animated.View
            style={[styles.predictionsPanel, { opacity: panelFade }]}
          >
            {predictions.length === 0 ? (
              <View style={styles.predictionEmpty}>
                <MaterialCommunityIcons
                  name="map-search-outline"
                  size={18}
                  color={T.barkLight}
                />
                <Text style={styles.predictionEmptyText}>
                  No matching places. Try another search.
                </Text>
              </View>
            ) : (
              <FlatList
                data={predictions}
                keyExtractor={(it) => it.place_id}
                keyboardShouldPersistTaps="handled"
                ItemSeparatorComponent={() => (
                  <View style={styles.predictionDivider} />
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.predictionRow}
                    onPress={() => handleSelectPrediction(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name="map-marker-outline"
                      size={20}
                      color={T.barkMid}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.predictionMain} numberOfLines={1}>
                        {item.main_text}
                      </Text>
                      {!!item.secondary_text && (
                        <Text
                          style={styles.predictionSecondary}
                          numberOfLines={1}
                        >
                          {item.secondary_text}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </Animated.View>
        )}
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
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracksChanges}
          >
            {/*
              Pin is composed of three solid Views (head, inner dot, tail
              triangle) instead of a font icon. Font icons race against the
              native marker snapshot on Android and routinely render
              half-drawn; plain Views always rasterise correctly because
              they don't depend on a font file being loaded.
            */}
            <View style={styles.pinWrap}>
              <View style={styles.pinHead}>
                <View style={styles.pinDot} />
              </View>
              <View style={styles.pinTail} />
            </View>
          </Marker>
        </MapView>

        <View style={styles.tooltipContainer} pointerEvents="none">
          <View style={styles.tooltip}>
            <Text style={styles.tooltipTitle}>Order will be delivered here</Text>
            <Text style={styles.tooltipSubtitle}>
              Move the map or drag the pin to fine-tune
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.myLocationBtn}
          onPress={handleMyLocation}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={24}
            color={T.white}
          />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.bottomSheet,
          { paddingBottom: Math.max(insets.bottom, 16) + 8 },
        ]}
      >
        <View style={styles.locationInfo}>
          <MaterialCommunityIcons
            name="map-marker"
            size={24}
            color={T.green}
          />
          <View style={styles.locationTextContainer}>
            {reverseLoading ? (
              <View accessible accessibilityLabel="Fetching address…">
                <Skeleton
                  width="55%"
                  height={18}
                  color={T.sand}
                  style={styles.skeletonName}
                />
                <SkeletonText
                  lines={2}
                  lineHeight={12}
                  gap={8}
                  width="92%"
                  lastLineWidth="70%"
                  color={T.sand}
                />
              </View>
            ) : (
              <>
                <Text style={styles.locationName} numberOfLines={1}>
                  {locationName || "Selected Location"}
                </Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {locationAddress || "Pick a place from search or tap on the map"}
                </Text>
              </>
            )}
          </View>
        </View>

        <PrimaryButton
          size="lg"
          shadow
          label="Confirm Location"
          onPress={handleConfirmLocation}
          disabled={!locationAddress || reverseLoading}
          style={styles.confirmBtn}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomColor: T.cardBorder,
  },
  headerTitle: {
    color: T.bark,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
    // Stack the predictions panel above the map
    zIndex: 10,
    elevation: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    // Fixed height keeps the bar identical on iOS/Android so the absolutely
    // positioned predictions panel (top: 62 = 12 + 44 + 6) always lines up.
    height: 44,
    backgroundColor: T.sand,
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    paddingVertical: 0,
    fontSize: 15,
    color: T.bark,
    fontFamily: "PlusJakartaSans_500Medium",
  },
  predictionsPanel: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 62,
    maxHeight: 280,
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 12,
    overflow: "hidden",
  },
  predictionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  predictionMain: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 14,
    color: T.bark,
  },
  predictionSecondary: { fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 12,
    color: T.barkMid,
    marginTop: 2,
  },
  predictionDivider: {
    height: 1,
    backgroundColor: T.cardBorder,
    // = predictionRow paddingHorizontal 16 + icon 20 + gap 12
    marginLeft: 48,
  },
  predictionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  predictionEmptyText: { fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 13,
    color: T.barkMid,
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  pinWrap: {
    width: 36,
    height: 48,
    alignItems: "center",
    justifyContent: "flex-start",
    backgroundColor: "transparent",
  },
  pinHead: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.white,
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: T.pink,
    marginTop: -2,
  },
  tooltipContainer: {
    position: "absolute",
    top: 20,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  tooltip: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    maxWidth: "90%",
  },
  tooltipTitle: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
    color: T.white,
    textAlign: "center",
    marginBottom: 2,
  },
  tooltipSubtitle: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.8)",
    textAlign: "center",
  },
  myLocationBtn: {
    position: "absolute",
    // Sit just above the bottom sheet, bottom-right.
    bottom: 16,
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.pink,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 8,
  },
  bottomSheet: {
    backgroundColor: T.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    // Fallback; the inline style adds the bottom safe-area inset on top.
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
  locationName: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 18,
    color: T.bark,
    marginBottom: 4,
  },
  locationAddress: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 14,
    color: T.barkMid,
    lineHeight: 20,
  },
  skeletonName: {
    marginBottom: 8,
  },
  confirmBtn: {
    // Screen accent stays pink; the primitive supplies geometry/type/shadow.
    backgroundColor: T.pink,
    borderRadius: 14,
    shadowColor: T.pink,
    shadowOpacity: 0.18,
  },
});
