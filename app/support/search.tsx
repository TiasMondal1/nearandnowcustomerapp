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

import { searchProducts, type Product } from "../../lib/productService";
import { useCart } from "../cart/CartContext";
import { useLocation } from "../location/locationContent";

const BG = "#05030A";
const PRIMARY = "#765fba";

export default function SearchScreen() {
  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => search(), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const search = async () => {
    setLoading(true);
    try {
      const data = await searchProducts(
        query,
        location ? { lat: location.latitude, lng: location.longitude } : undefined,
      );
      setResults(data);
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            query.length >= 2 ? (
              <Text style={styles.emptyText}>No products found</Text>
            ) : null
          }
          renderItem={({ item }) => {
            const cartItem = items.find((i) => i.product_id === item.id);
            return (
              <TouchableOpacity
                style={styles.resultCard}
                onPress={() => router.push(`../product/${item.id}`)}
                activeOpacity={0.85}
              >
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}

                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.price}>
                    ₹{item.price} / {item.unit}
                  </Text>
                  <Text style={styles.category}>{item.category}</Text>
                </View>

                {cartItem ? (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity
                      onPress={() => updateQty(item.id, cartItem.quantity - 1)}
                    >
                      <Text style={styles.qtyBtn}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{cartItem.quantity}</Text>
                    <TouchableOpacity
                      onPress={() => updateQty(item.id, cartItem.quantity + 1)}
                    >
                      <Text style={styles.qtyBtn}>+</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addBtn}
                    onPress={() =>
                      addItem({
                        product_id: item.id,
                        name: item.name,
                        price: item.price,
                        unit: item.unit,
                        image_url: item.image_url,
                      })
                    }
                  >
                    <Text style={styles.addText}>ADD</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
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
  category: { color: "#9C94D7", fontSize: 11 },

  addBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#120D24",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  qtyBtn: { color: PRIMARY, fontSize: 18, fontWeight: "700", paddingHorizontal: 4 },
  qtyText: { color: "#fff", fontSize: 14, fontWeight: "600", minWidth: 20, textAlign: "center" },

  emptyText: {
    textAlign: "center",
    color: "#9C94D7",
    marginTop: 40,
  },
});
