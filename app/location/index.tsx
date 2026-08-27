import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";

import {
  Card,
  EmptyState,
  IconButton,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonText,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { deleteAddress, getUserAddresses, type SavedAddress } from "../../lib/addressService";
import { logError } from "../../lib/logError";
import AddressCard from "./AddressCard";

export default function LocationIndex() {
  const { userId } = useAuth();
  const { setLocation } = useLocation();

  const [locations, setLocations] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLocations = useCallback(async () => {
    try {
      if (!userId) return;
      const data = await getUserAddresses(userId);
      setLocations(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch addresses";
      logError("Fetch locations", err);
      Alert.alert("Saved addresses", message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLocations();
  }, [fetchLocations]);

  const selectLocation = useCallback(
    (loc: SavedAddress) => {
      setLocation({
        latitude: loc.latitude ?? 0,
        longitude: loc.longitude ?? 0,
        label: loc.label,
        address: loc.address,
        source: "saved",
      });
      // Prefer popping back to whatever screen opened this (home, checkout, etc.)
      // so the app unwinds in one animation instead of tearing down the stack
      // and rebuilding home from scratch.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/home");
      }
    },
    [setLocation],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      Alert.alert(
        "Delete address",
        "Are you sure you want to remove this address?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                if (!userId) return;
                await deleteAddress(id, userId);
                fetchLocations();
              } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to delete address";
                Alert.alert("Saved addresses", message);
              }
            },
          },
        ],
      );
    },
    [fetchLocations, userId],
  );

  const emptyComponent = useMemo(
    () => (
      <EmptyState
        fill
        icon="map-marker-plus-outline"
        title="No addresses yet"
        text="Add one to start ordering"
        style={styles.emptyWrap}
        titleStyle={styles.emptyTitle}
        textStyle={styles.emptySub}
      >
        <PrimaryButton
          label="Add Address"
          fullWidth={false}
          onPress={() => router.push("/location/add")}
          style={styles.emptyBtn}
        />
      </EmptyState>
    ),
    [],
  );

  return (
    <Screen>
      <ScreenHeader
        title="Delivery Addresses"
        onBack={() => router.back()}
        right={
          <IconButton
            icon="plus"
            bg={C.primary}
            color={C.card}
            shadow="primarySm"
            accessibilityLabel="Add new address"
            onPress={() => router.push("/location/add")}
          />
        }
      />

      <FlatList
        data={locations}
        keyExtractor={(i) => i.id}
        contentContainerStyle={
          !locations.length && !loading ? { flex: 1 } : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={loading ? <SkeletonList /> : emptyComponent}
        renderItem={({ item }) => (
          <AddressCard
            id={item.id}
            label={item.label}
            address={item.address}
            onSelect={() => selectLocation(item)}
            isDefault={item.is_default}
            onEdit={() => router.push({ pathname: "/location/edit", params: { id: item.id } })}
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />

      {!!locations.length && (
        <PrimaryButton
          size="lg"
          icon="plus"
          label="Add new address"
          shadow
          onPress={() => router.push("/location/add")}
          style={styles.addBtn}
        />
      )}
    </Screen>
  );
}

/* ---------------- Skeleton ---------------- */

function SkeletonCard() {
  return (
    <Card style={styles.skeletonCard}>
      <View style={styles.skeletonRow}>
        <Skeleton width={34} height={34} radius={10} />
        <Skeleton width={80} height={12} />
      </View>
      <SkeletonText lines={2} lineHeight={11} lastLineWidth="70%" />
    </Card>
  );
}

function SkeletonList() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </>
  );
}

/* ---------------- Styles ---------------- */

const styles = StyleSheet.create({
  listContent: { padding: 16, paddingBottom: 120 },

  skeletonCard: { marginBottom: 10 },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },

  emptyWrap: { paddingBottom: 80 },
  emptyTitle: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 18 },
  emptySub: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 15, lineHeight: 22, maxWidth: 260 },
  emptyBtn: { marginTop: 6, paddingHorizontal: 32 },

  addBtn: {
    position: "absolute",
    bottom: 28,
    left: 16,
    right: 16,
  },
});
