import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../context/AuthContext";
import { deleteAddress, getUserAddresses, type SavedAddress } from "../../lib/addressService";
import AddressCard from "./AddressCard";
import { useLocation } from "../../context/LocationContext";

const PRIMARY = "#059669";
const BG = "#f9fafb";
const CARD = "#ffffff";

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
      console.error("Failed to fetch locations", err);
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
      router.replace("/home");
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
              if (!userId) return;
              await deleteAddress(id, userId);
              fetchLocations();
            },
          },
        ],
      );
    },
    [fetchLocations, userId],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedAddress }) => {
      const receiver =
        item.delivery_for === "self" ? "You" : item.receiver_name;

      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => selectLocation(item)}
          style={[styles.card, item.is_default && styles.defaultCard]}
        >
          <View style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            {item.is_default && <Text style={styles.badge}>DEFAULT</Text>}
          </View>
          <Text style={styles.address}>{item.address}</Text>
          {receiver ? (
            <Text style={styles.meta}>Delivering to {receiver}</Text>
          ) : null}
        </TouchableOpacity>
      );
    },
    [selectLocation],
  );

  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No addresses yet</Text>
        <Text style={styles.emptySub}>Add one to start ordering</Text>

        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={() => router.push("/location/add")}
        >
          <Text style={styles.emptyBtnText}>Add Address</Text>
        </TouchableOpacity>
      </View>
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Choose delivery address</Text>

      <FlatList
        data={locations}
        keyExtractor={(i) => i.id}
        contentContainerStyle={
          !locations.length && !loading ? { flex: 1 } : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
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
            onEdit={() =>
              router.push({
                pathname: "/location/edit",
                params: { id: item.id },
              })
            }
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />

      {!!locations.length && (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/location/add")}
        >
          <Text style={styles.addText}>＋ Add new address</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

/* ---------------- Skeleton ---------------- */

function SkeletonList() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.skeleton} />
      ))}
    </>
  );
}

/* ---------------- Styles ---------------- */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
    padding: 16,
  },

  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 16,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },

  defaultCard: {
    borderWidth: 1,
    borderColor: PRIMARY,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  badge: {
    fontSize: 11,
    color: PRIMARY,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: PRIMARY,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },

  address: {
    color: "#C4BDEA",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },

  meta: {
    color: "#9C94D7",
    fontSize: 12,
    marginTop: 8,
  },

  skeleton: {
    height: 92,
    borderRadius: 18,
    backgroundColor: "#1B1533",
    marginBottom: 12,
  },

  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 80,
  },

  emptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },

  emptySub: {
    color: "#8F88C9",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 20,
  },

  emptyBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },

  emptyBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  addBtn: {
    marginTop: 12,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },

  addText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
