import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import {
    getUserAddresses,
    readAddressesCache,
    type SavedAddress,
} from "../lib/addressService";

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
  red: "#D94F3D",
  cardBorder: "rgba(60,47,30,0.08)",
  shadow: "rgba(45,122,79,0.12)",
};

type AddressWithDistance = SavedAddress & {
  distance?: number;
};

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const getAddressIcon = (
  label: string,
): keyof typeof MaterialCommunityIcons.glyphMap => {
  const lower = label.toLowerCase();
  if (lower.includes("home")) return "home";
  if (lower.includes("work") || lower.includes("office")) return "office-building";
  if (lower.includes("hotel")) return "bed";
  if (lower.includes("other")) return "map-marker";
  return "map-marker";
};

export default function SelectLocationScreen() {
  const { userId } = useAuth();
  const { location: activeLocation, setLocation } = useLocation();

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  // `loading` means "we haven't rendered anything yet" — once the cache paints
  // we flip this off immediately so the UI is never blank.
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [fetchingCurrentLocation, setFetchingCurrentLocation] = useState(false);

  // Used to avoid setState after unmount when the background fetch resolves
  // after the user has navigated away.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ─── SWR: paint from cache → revalidate in background ─────────────────────
  const revalidate = useCallback(async () => {
    if (!userId) return;
    try {
      const fresh = await getUserAddresses(userId);
      if (mountedRef.current) setAddresses(fresh);
    } catch (error) {
      // Only surface a toast if the user has no cached list to fall back to;
      // otherwise we silently retry on the next focus.
      console.error("Failed to revalidate addresses:", error);
      if (mountedRef.current && addresses.length === 0) {
        Alert.alert("Error", "Failed to load saved addresses");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, addresses.length]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      const cached = await readAddressesCache(userId);
      if (cancelled) return;
      if (cached && cached.length > 0) {
        setAddresses(cached);
        setLoading(false);
      }
      revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, revalidate]);

  // Re-sync whenever the user navigates back to this screen (e.g. after adding
  // a new address). The cache is invalidated on every mutation, so this pulls
  // the latest list without showing a spinner.
  useFocusEffect(
    useCallback(() => {
      if (userId) revalidate();
    }, [userId, revalidate]),
  );

  // Attach distance info lazily (only when the user has granted GPS access).
  const addressesWithDistance = useMemo<AddressWithDistance[]>(() => {
    if (!currentLocation) return addresses;
    return addresses.map((addr) => {
      if (addr.latitude == null || addr.longitude == null) return addr;
      return {
        ...addr,
        distance: calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          addr.latitude,
          addr.longitude,
        ),
      };
    });
  }, [addresses, currentLocation]);

  const handleUseCurrentLocation = async () => {
    // Use-current-location now shares the same map-confirm + search flow as
    // "Add new address": we just ensure permission is granted, then hand off
    // to the map screen which auto-centers on the user's GPS fix on mount.
    try {
      setFetchingCurrentLocation(true);
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Please enable location permissions to use this feature",
        );
        return;
      }

      router.push("/location/select-map");
    } catch (error) {
      console.error("Failed to get current location:", error);
      Alert.alert("Error", "Failed to get your current location");
    } finally {
      setFetchingCurrentLocation(false);
    }
  };

  const handleSelectAddress = (address: SavedAddress) => {
    if (address.latitude != null && address.longitude != null) {
      setLocation({
        latitude: address.latitude,
        longitude: address.longitude,
        label: address.label,
        address: address.address,
        source: "saved",
      });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/home");
      }
    } else {
      Alert.alert("Error", "This address doesn't have location coordinates");
    }
  };

  const handleAddNewAddress = () => {
    router.push("/location/select-map");
  };

  const handleRequestFromFriend = () => {
    Alert.alert(
      "Request Address",
      "This feature allows you to request location from a friend via WhatsApp",
      [{ text: "OK" }],
    );
  };

  const filteredAddresses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return addressesWithDistance;
    return addressesWithDistance.filter((addr) => {
      return (
        addr.label.toLowerCase().includes(q) ||
        addr.address.toLowerCase().includes(q) ||
        addr.city?.toLowerCase().includes(q) ||
        addr.landmark?.toLowerCase().includes(q)
      );
    });
  }, [addressesWithDistance, searchQuery]);

  const activeLabel = activeLocation?.label;
  const activeAddress = activeLocation?.address;

  const renderAddressItem = useCallback(({
    item,
  }: {
    item: AddressWithDistance;
  }) => {
    const isSelected =
      activeLabel === item.label && activeAddress === item.address;

    return (
      <TouchableOpacity
        style={[styles.addressCard, isSelected && styles.addressCardSelected]}
        onPress={() => handleSelectAddress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.addressIconWrap}>
          <MaterialCommunityIcons
            name={getAddressIcon(item.label)}
            size={24}
            color={isSelected ? T.green : T.barkMid}
          />
        </View>

        <View style={styles.addressContent}>
          <View style={styles.addressHeader}>
            <Text style={styles.addressLabel}>{item.label}</Text>
            {item.distance != null && (
              <Text style={styles.distanceText}>
                • {item.distance < 1
                  ? `${Math.round(item.distance * 1000)} m`
                  : `${item.distance.toFixed(1)} km`}
              </Text>
            )}
            {item.is_default && (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>Selected</Text>
              </View>
            )}
          </View>

          <Text style={styles.addressText} numberOfLines={2}>
            {item.address}
          </Text>

          {item.landmark && (
            <Text style={styles.landmarkText} numberOfLines={1}>
              <MaterialCommunityIcons name="map-marker-outline" size={12} color={T.barkLight} />
              {" "}{item.landmark}
            </Text>
          )}
        </View>

        <View style={styles.addressActions}>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => {}}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="share-variant" size={18} color={T.barkLight} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={() => router.push(`/location/edit?id=${item.id}`)}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="dots-vertical" size={18} color={T.barkLight} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [activeLabel, activeAddress]);

  // `extraData` tells FlatList to re-render rows when the selection changes
  // even though the underlying `data` array reference stays the same.
  const listExtraData = useMemo(
    () => ({ activeLabel, activeAddress }),
    [activeLabel, activeAddress],
  );

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
        <Text style={styles.headerTitle}>Select Location</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={20} color={T.barkLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Address"
            placeholderTextColor={T.barkLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <MaterialCommunityIcons name="close-circle" size={18} color={T.barkLight} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleUseCurrentLocation}
          activeOpacity={0.8}
          disabled={fetchingCurrentLocation}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color="#E91E63" />
          <Text style={[styles.quickActionText, { color: "#E91E63" }]}>
            Use my Current Location
          </Text>
          {fetchingCurrentLocation && (
            <ActivityIndicator size="small" color="#E91E63" style={{ marginLeft: 8 }} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleAddNewAddress}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="plus" size={20} color="#E91E63" />
          <Text style={[styles.quickActionText, { color: "#E91E63" }]}>
            Add New Address
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={T.barkLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleRequestFromFriend}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="whatsapp" size={20} color="#25D366" />
          <Text style={[styles.quickActionText, { color: T.bark }]}>
            Request address from friend
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={T.barkLight} />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Saved Addresses</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={T.green} />
          <Text style={styles.loadingText}>Loading addresses...</Text>
        </View>
      ) : filteredAddresses.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="map-marker-off" size={48} color={T.barkLight} />
          <Text style={styles.emptyTitle}>
            {searchQuery ? "No addresses found" : "No saved addresses"}
          </Text>
          <Text style={styles.emptyText}>
            {searchQuery
              ? "Try a different search term"
              : "Add your first address to get started"}
          </Text>
          {!searchQuery && (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={handleAddNewAddress}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="plus" size={18} color={T.white} />
              <Text style={styles.emptyBtnText}>Add Address</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredAddresses}
          renderItem={renderAddressItem}
          keyExtractor={(item) => item.id}
          extraData={listExtraData}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: T.cream,
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
  quickActions: {
    backgroundColor: T.white,
    paddingVertical: 8,
    marginBottom: 8,
  },
  quickActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  quickActionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: T.bark,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: T.cream,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: T.bark,
    letterSpacing: -0.2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  addressCard: {
    flexDirection: "row",
    backgroundColor: T.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: T.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  addressCardSelected: {
    borderColor: T.green,
    backgroundColor: T.greenXLight,
  },
  addressIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.sand,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  addressContent: {
    flex: 1,
  },
  addressHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    gap: 6,
  },
  addressLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: T.bark,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: "600",
    color: T.barkLight,
  },
  defaultBadge: {
    backgroundColor: T.green,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: T.white,
    textTransform: "uppercase",
  },
  addressText: {
    fontSize: 14,
    color: T.barkMid,
    lineHeight: 20,
    marginBottom: 4,
  },
  landmarkText: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "500",
  },
  addressActions: {
    flexDirection: "column",
    gap: 8,
    marginLeft: 8,
  },
  shareBtn: {
    padding: 4,
  },
  moreBtn: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: T.barkLight,
    fontWeight: "500",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: T.bark,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: T.barkLight,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.green,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
    gap: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: T.white,
  },
});
