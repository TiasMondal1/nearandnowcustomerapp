// Address book: flat AddressCard rows (swipe Edit / Delete, delete confirms), focus revalidate so an add/edit
// shows up on return (U20), tap = set as the active location (never with (0,0) — C1), and an inset-aware dock
// whose "Add address" goes to the centre-pin map with returnTo="/location" (no legacy /location/add pushes, U3).
// (quartz, 2026-10-03)
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";

import { AddressCard } from "../../components/location/AddressCard";
import {
  BottomDock,
  EmptyState,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  SkeletonText,
  notify,
  useDockHeight,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { layout } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { useRefetchOnReconnect } from "../../hooks/useRefetchOnReconnect";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { deleteAddress, getUserAddresses, peekAddresses, type SavedAddress } from "../../lib/addressService";
import { feedback } from "../../lib/feedback";
import { logError } from "../../lib/logError";
import { QC_KEYS, useCachedValue } from "../../lib/queryCache";

// ─── Constants / helpers ──────────────────────────────────────────────────────

const SKELETON_ROWS = [0, 1, 2] as const;

type Coords = { latitude: number; longitude: number };

function isValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function addressCoords(a: SavedAddress): Coords | null {
  const lat = typeof a.latitude === "number" ? a.latitude : Number(a.latitude);
  const lng = typeof a.longitude === "number" ? a.longitude : Number(a.longitude);
  return isValidCoords(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

const ADD_HREF = { pathname: "/location/select-map", params: { returnTo: "/location" } } as const;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LocationIndex(): React.JSX.Element {
  const { userId } = useAuth();
  const uid = userId ?? "";
  const { setLocation } = useLocation();
  const dockHeight = useDockHeight();

  // Memory first (optimistic mutations repaint instantly), one fetch per focus, forced after the first.
  const cachedList = useCachedValue<SavedAddress[]>(QC_KEYS.addresses(uid));
  const [fetchedList, setFetchedList] = useState<SavedAddress[] | undefined>(() => peekAddresses(uid));
  const addresses = cachedList ?? fetchedList;
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const focusedOnceRef = useRef(false);

  const revalidate = useCallback(
    async (force: boolean) => {
      if (!uid) return;
      const seq = ++loadSeqRef.current;
      try {
        const list = await getUserAddresses(uid, { force });
        if (seq !== loadSeqRef.current) return;
        setFetchedList(list);
        setLoadError(null);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        logError("Load addresses", err);
        setLoadError(err instanceof Error ? err.message : "Couldn't load your addresses");
      }
    },
    [uid],
  );

  useFocusEffect(
    useCallback(() => {
      const force = focusedOnceRef.current;
      focusedOnceRef.current = true;
      void revalidate(force);
    }, [revalidate]),
  );
  useRefetchOnReconnect(() => {
    void revalidate(true);
  });

  // ── Actions ──
  const goAdd = () => router.push(ADD_HREF);

  const handleSelect = (a: SavedAddress) => {
    const coords = addressCoords(a);
    if (!coords) {
      feedback.error();
      notify({
        id: "location-invalid",
        title: "This address has no map location",
        message: "Edit it to pin the spot on the map",
        tone: "warning",
        action: { label: "Edit", onPress: () => router.push({ pathname: "/location/edit", params: { id: a.id } }) },
      });
      return;
    }
    setLocation({ ...coords, label: a.label, address: a.address, source: "saved" });
    feedback.toggle(true);
    notify({ id: "delivering-to", title: `Delivering to ${a.label}`, icon: "map-marker" });
  };

  const handleEdit = (a: SavedAddress) => router.push({ pathname: "/location/edit", params: { id: a.id } });

  const performDelete = async (a: SavedAddress) => {
    if (!uid) return;
    try {
      await deleteAddress(a.id, uid); // optimistic: the row is gone from memory before the request lands
      feedback.heavy();
      notify({ id: "address-deleted", title: "Address deleted" });
    } catch (err) {
      logError("Delete address", err);
      feedback.error();
      notify({ id: "address-delete-error", title: "Couldn't delete the address", message: err instanceof Error ? err.message : undefined, tone: "error" });
    }
  };

  // Destructive → a confirmation stays a native Alert (PLAN §5: only confirmations keep Alert.alert).
  const handleDelete = (a: SavedAddress) => {
    Alert.alert("Delete address", `Remove "${a.label}" from your saved addresses?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void performDelete(a) },
    ]);
  };

  // ── Derived ──
  const loading = useForceSkeleton(!!uid && addresses === undefined && !loadError);
  const count = addresses ? addresses.length : 0;

  const renderItem = ({ item, index }: { item: SavedAddress; index: number }) => (
    <AddressCard
      address={item}
      onPress={() => handleSelect(item)}
      onEdit={() => handleEdit(item)}
      onDelete={() => handleDelete(item)}
      divider={index < count - 1}
      testID={`address-card-${item.id}`}
    />
  );

  const listEmpty = loading ? (
    <SkeletonScreen label="Loading addresses…">
      {SKELETON_ROWS.map((i) => (
        <View key={i} style={[styles.skeletonRow, i < SKELETON_ROWS.length - 1 && styles.skeletonDivider]}>
          <Skeleton width={44} height={44} radius={12} />
          <View style={styles.skeletonCol}>
            <Skeleton width="40%" height={14} style={styles.skeletonTitle} />
            <SkeletonText lines={2} lineHeight={12} gap={6} width="90%" lastLineWidth="60%" />
          </View>
        </View>
      ))}
    </SkeletonScreen>
  ) : loadError && !addresses ? (
    <EmptyState
      fill
      icon="cloud-off-outline"
      title="Couldn't load addresses"
      text={loadError}
      action={{ label: "Retry", onPress: () => void revalidate(true) }}
    />
  ) : (
    <EmptyState
      fill
      icon="map-marker-plus-outline"
      title="No addresses yet"
      text="Save an address to get your orders delivered faster"
      action={{ label: "Add address", icon: "plus", onPress: goAdd }}
    />
  );

  return (
    <Screen bg={C.card} edges={["top"]}>
      <ScreenHeader size="lg" title="Addresses" backFallbackHref="/(tabs)/home" />
      <FlatList
        data={addresses ?? []}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={[styles.listContent, { paddingBottom: dockHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
      />
      <BottomDock>
        <PrimaryButton size="lg" icon="plus" label="Add address" onPress={goAdd} />
      </BottomDock>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  listContent: { flexGrow: 1, paddingBottom: layout.scrollBottomTab },
  // AddressRow (ListRow lg) twin: ph16 pv16 gap14, 44 px glyph.
  skeletonRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  skeletonDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  skeletonCol: { flex: 1 },
  skeletonTitle: { marginBottom: 8 },
});
