import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Alert } from "react-native";
import { getSession } from "../../session";
import AddressCard from "./AddressCard";
import { useLocation } from "./locationContent";




const API_BASE = "http://192.168.1.117:3001";
const PRIMARY = "#765fba";
const BG = "#05030A";
const CARD = "#120D24";

type LocationItem = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  is_default: boolean;
  delivery_for: "self" | "other";
  receiver_name?: string;
  receiver_nickname?: string;
};

export default function LocationIndex() {
  const { setLocation } = useLocation();

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLocations = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session?.token) return;

      const res = await fetch(`${API_BASE}/customer/locations`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });

      const json = await res.json();
      setLocations(json.locations ?? []);
    } catch (err) {
      console.error("Failed to fetch locations", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLocations();
  }, [fetchLocations]);

  const selectLocation = useCallback(
    (loc: LocationItem) => {
      setLocation({
        latitude: loc.latitude,
        longitude: loc.longitude,
        label: loc.label,
        address: loc.address,
        source: "saved",
      });

      router.replace("/home");
    },
    [setLocation]
  );

  const deleteLocation = useCallback(
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
            const session = await getSession();
            if (!session?.token) return;

            await fetch(`${API_BASE}/customer/locations/${id}`, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${session.token}`,
              },
            });

            fetchLocations(); // refresh list
          },
        },
      ]
    );
  },
  [fetchLocations]
);


  const renderItem = useCallback(
    ({ item }: { item: LocationItem }) => {
      const receiver =
        item.delivery_for === "self"
          ? "You"
          : item.receiver_nickname || item.receiver_name;

      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => selectLocation(item)}
          style={[
            styles.card,
            item.is_default && styles.defaultCard,
          ]}
        >
          <View style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            {item.is_default && (
              <Text style={styles.badge}>DEFAULT</Text>
            )}
          </View>

          <Text style={styles.address}>{item.address}</Text>

          <Text style={styles.meta}>
            Delivering to {receiver}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectLocation]
  );

  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>
          No addresses yet
        </Text>
        <Text style={styles.emptySub}>
          Add one to start ordering
        </Text>

        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={() => router.push("/location/add")}
        >
          <Text style={styles.emptyBtnText}>
            Add Address
          </Text>
        </TouchableOpacity>
      </View>
    ),
    []
  );

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>
        Choose delivery address
      </Text>

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
      id={item.id}                     // ✅ REQUIRED for gestures
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
      onDelete={() => deleteLocation(item.id)}
    />
  )}
/>


      {!!locations.length && (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/location/add")}
        >
          <Text style={styles.addText}>
            ＋ Add new address
          </Text>
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
