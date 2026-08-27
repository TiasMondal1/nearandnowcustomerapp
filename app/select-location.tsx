import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ExpoLocation from "expo-location";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Badge,
  EmptyState,
  IconWrap,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonText,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import {
    getUserAddresses,
    readAddressesCache,
    type SavedAddress,
} from "../lib/addressService";
import { logError } from "../lib/logError";

const T = {
  green: "#2D7A4F",
  greenXLight: "#EAF6EE",
  cream: "#FAFAF7",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  white: "#FFFFFF",
  pink: "#E91E63",
  cardBorder: "rgba(60,47,30,0.08)",
};

// WhatsApp brand green — only for the WhatsApp glyph on the request row.
const WHATSAPP_GREEN = "#25D366";

// Placeholder cards shown while the first address list loads.
const SKELETON_ROWS = [0, 1, 2];

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
  const insets = useSafeAreaInsets();

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
      logError("Revalidate addresses", error);
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

  const requestingLocationRef = useRef(false);

  const handleUseCurrentLocation = async () => {
    // Use-current-location now shares the same map-confirm + search flow as
    // "Add new address": we just ensure permission is granted, then hand off
    // to the map screen which auto-centers on the user's GPS fix on mount.
    // The `disabled={fetchingCurrentLocation}` guard on the button below is
    // state-based (not synchronous), so a fast double-tap before the first
    // render commits could still fire this twice concurrently — this ref
    // closes that narrow window. Already try/catch'd, so this was never a
    // crash risk, just a wasted duplicate permission request.
    if (requestingLocationRef.current) return;
    requestingLocationRef.current = true;
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
      logError("Get current location", error);
      Alert.alert("Error", "Failed to get your current location");
    } finally {
      setFetchingCurrentLocation(false);
      requestingLocationRef.current = false;
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

  const handleShareAddress = (address: SavedAddress) => {
    const lines = [address.label, address.address, address.landmark]
      .filter(Boolean)
      .join("\n");
    Share.share({ message: lines }).catch(() => {});
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
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
      >
        <IconWrap size={40} bg={T.sand} style={styles.addressIconWrap}>
          <MaterialCommunityIcons
            name={getAddressIcon(item.label)}
            size={20}
            color={isSelected ? T.green : T.barkMid}
          />
        </IconWrap>

        <View style={styles.addressContent}>
          <View style={styles.addressHeader}>
            <Text style={styles.addressLabel} numberOfLines={1}>
              {item.label}
            </Text>
            {item.distance != null && (
              <Text style={styles.distanceText}>
                • {item.distance < 1
                  ? `${Math.round(item.distance * 1000)} m`
                  : `${item.distance.toFixed(1)} km`}
              </Text>
            )}
            {item.is_default && (
              <Badge
                size="sm"
                pill
                bg={T.green}
                color={T.white}
                label="Selected"
                style={styles.defaultBadge}
                textStyle={styles.defaultBadgeText}
              />
            )}
          </View>

          <Text style={styles.addressText} numberOfLines={2}>
            {item.address}
          </Text>

          {item.landmark && (
            <View style={styles.landmarkRow}>
              <MaterialCommunityIcons name="map-marker-outline" size={12} color={T.barkLight} />
              <Text style={styles.landmarkText} numberOfLines={1}>
                {item.landmark}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.addressActions}>
          <TouchableOpacity
            style={styles.cardActionBtn}
            onPress={() => handleShareAddress(item)}
            hitSlop={6}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Share address"
          >
            <MaterialCommunityIcons name="share-variant" size={18} color={T.barkLight} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cardActionBtn}
            onPress={() => router.push(`/location/edit?id=${item.id}`)}
            hitSlop={6}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit address"
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
    <Screen bg={T.cream} edges={["top"]}>
      <ScreenHeader
        title="Select Location"
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
            placeholder="Search Address"
            placeholderTextColor={T.barkLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              hitSlop={12}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={T.barkLight} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleUseCurrentLocation}
          activeOpacity={0.7}
          disabled={fetchingCurrentLocation}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={T.pink} />
          <Text style={[styles.quickActionText, styles.quickActionTextAccent]}>
            Use my Current Location
          </Text>
          <View style={styles.quickActionTrailing}>
            {fetchingCurrentLocation && (
              <ActivityIndicator size="small" color={T.pink} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleAddNewAddress}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="plus" size={20} color={T.pink} />
          <Text style={[styles.quickActionText, styles.quickActionTextAccent]}>
            Add New Address
          </Text>
          <View style={styles.quickActionTrailing}>
            <MaterialCommunityIcons name="chevron-right" size={20} color={T.barkLight} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickActionBtn, styles.quickActionBtnLast]}
          onPress={handleRequestFromFriend}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="whatsapp" size={20} color={WHATSAPP_GREEN} />
          <Text style={styles.quickActionText}>
            Request address from friend
          </Text>
          <View style={styles.quickActionTrailing}>
            <MaterialCommunityIcons name="chevron-right" size={20} color={T.barkLight} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <SectionLabel style={styles.sectionTitle}>Saved Addresses</SectionLabel>
      </View>

      {loading ? (
        <View
          style={styles.skeletonList}
          accessible
          accessibilityLabel="Loading addresses..."
        >
          {SKELETON_ROWS.map((i) => (
            <View key={i} style={styles.addressCard}>
              <Skeleton
                width={40}
                height={40}
                radius={12}
                color={T.sand}
                style={styles.addressIconWrap}
              />
              <View style={styles.addressContent}>
                <Skeleton
                  width="40%"
                  height={16}
                  color={T.sand}
                  style={styles.skeletonLabel}
                />
                <SkeletonText
                  lines={2}
                  lineHeight={12}
                  gap={6}
                  width="85%"
                  lastLineWidth="60%"
                  color={T.sand}
                />
              </View>
            </View>
          ))}
        </View>
      ) : filteredAddresses.length === 0 ? (
        <EmptyState
          fill
          icon="map-marker-off"
          iconSize={48}
          iconColor={T.barkLight}
          title={searchQuery ? "No addresses found" : "No saved addresses"}
          text={
            searchQuery
              ? "Try a different search term"
              : "Add your first address to get started"
          }
          titleStyle={styles.emptyTitle}
          textStyle={styles.emptyText}
        >
          {!searchQuery && (
            <PrimaryButton
              size="sm"
              icon="plus"
              label="Add Address"
              onPress={handleAddNewAddress}
              style={styles.emptyBtn}
              textStyle={styles.emptyBtnText}
            />
          )}
        </EmptyState>
      ) : (
        <FlatList
          data={filteredAddresses}
          renderItem={renderAddressItem}
          keyExtractor={(item) => item.id}
          extraData={listExtraData}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 20 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
        />
      )}
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
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    // Fixed height: identical bar on iOS/Android (matches select-map).
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
  quickActions: {
    backgroundColor: T.white,
    paddingVertical: 8,
    marginBottom: 8,
  },
  quickActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  quickActionBtnLast: {
    borderBottomWidth: 0,
  },
  quickActionText: { fontFamily: "PlusJakartaSans_600SemiBold",
    flex: 1,
    fontSize: 15,
    color: T.bark,
  },
  quickActionTextAccent: {
    color: T.pink,
  },
  // Fixed trailing slot so the chevrons / spinner share one right edge.
  quickActionTrailing: {
    width: 20,
    alignItems: "flex-end",
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    color: T.barkMid,
    paddingHorizontal: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  skeletonList: {
    paddingHorizontal: 16,
  },
  skeletonLabel: {
    marginBottom: 8,
  },
  addressCard: {
    flexDirection: "row",
    backgroundColor: T.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    // 2px so the selected state (T.green) reads clearly; the hairline tint
    // gives unselected cards an edge on both platforms without a shadow.
    borderWidth: 2,
    borderColor: T.cardBorder,
  },
  addressCardSelected: {
    borderColor: T.green,
    backgroundColor: T.greenXLight,
  },
  addressIconWrap: {
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
  addressLabel: { fontFamily: "PlusJakartaSans_700Bold",
    flexShrink: 1,
    fontSize: 16,
    color: T.bark,
  },
  distanceText: { fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 12,
    color: T.barkLight,
  },
  defaultBadge: {
    alignSelf: "center",
  },
  defaultBadgeText: {
    textTransform: "uppercase",
  },
  addressText: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 14,
    color: T.barkMid,
    lineHeight: 20,
    marginBottom: 4,
  },
  landmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  landmarkText: { fontFamily: "PlusJakartaSans_500Medium",
    flex: 1,
    fontSize: 12,
    color: T.barkLight,
  },
  addressActions: {
    flexDirection: "column",
    gap: 4,
    marginLeft: 8,
  },
  cardActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: T.bark,
  },
  emptyText: {
    color: T.barkLight,
  },
  emptyBtn: {
    backgroundColor: T.green,
    marginTop: 10,
  },
  emptyBtnText: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
  },
});
