import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSession } from "../../session";
import { useLocation } from "../location/locationContent";

const API_BASE = "http://192.168.1.117:3001";
const BG = "#05030A";
const PRIMARY = "#765fba";

export default function SearchScreen() {
  const { location } = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      search();
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  const search = async () => {
    if (!location) return;

    setLoading(true);

    try {
      const session = await getSession();
      if (!session?.token) return;

      const res = await fetch(
        `${API_BASE}/customer/search?q=${query}&lat=${location.latitude}&lng=${location.longitude}`,
        {
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
        },
      );

      const json = await res.json();
      setResults(json.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.searchHeader}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>

        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search products"
          placeholderTextColor="#9C94D7"
          style={styles.input}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={PRIMARY} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.product_id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            query.length >= 2 ? (
              <Text style={styles.emptyText}>No products found</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.resultCard}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.image} />
              ) : (
                <View style={styles.imagePlaceholder} />
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.product_name}</Text>
                <Text style={styles.price}>
                  ₹{item.price} / {item.unit}
                </Text>
                <Text style={styles.store}>
                  {item.store_name} • {item.distance_km.toFixed(1)} km
                </Text>
              </View>

              <TouchableOpacity style={styles.addBtn}>
                <Text style={styles.addText}>ADD</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    backgroundColor: BG,
  },

  input: {
    flex: 1,
    backgroundColor: "#120D24",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#fff",
  },

  resultCard: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
    backgroundColor: "#140F2D",
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
  },

  image: { width: 60, height: 60, borderRadius: 10 },
  imagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: "#1f1a3a",
  },

  name: { color: "#fff", fontSize: 14, fontWeight: "600" },
  price: { color: "#C4BDEA", fontSize: 13 },
  store: { color: "#9C94D7", fontSize: 11 },

  addBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },

  addText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  emptyText: {
    textAlign: "center",
    color: "#9C94D7",
    marginTop: 40,
  },
});
