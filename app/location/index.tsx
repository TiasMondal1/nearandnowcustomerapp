import { MaterialCommunityIcons } from "@expo/vector-icons";
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

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { deleteAddress, getUserAddresses, type SavedAddress } from "../../lib/addressService";
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
      console.error("Failed to fetch locations", err);
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
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delivery Addresses</Text>
        <TouchableOpacity
          style={styles.addIconBtn}
          onPress={() => router.push("/location/add")}
        >
          <MaterialCommunityIcons name="plus" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

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
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/location/add")}
        >
          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          <Text style={styles.addText}>Add new address</Text>
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
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: C.text,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  addIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  listContent: { padding: 20, paddingBottom: 120 },

  skeleton: {
    height: 88,
    borderRadius: 14,
    backgroundColor: C.bgSoft,
    marginBottom: 10,
    marginHorizontal: 16,
    marginTop: 8,
  },

  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 80,
    gap: 12,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 8,
  },
  emptySub: {
    color: C.textSub,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 16,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  emptyBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  addBtn: {
    position: "absolute",
    bottom: 28,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 18,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  addText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
