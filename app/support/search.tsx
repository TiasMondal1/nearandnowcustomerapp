import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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

import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { searchProducts, type Product } from "../../lib/productService";

export default function SearchScreen() {
  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timeout = setTimeout(() => doSearch(), 350);
    return () => clearTimeout(timeout);
  }, [query]);

  const doSearch = async () => {
    setLoading(true);
    try {
      const data = await searchProducts(
        query,
        location ? { lat: location.latitude, lng: location.longitude } : undefined,
      );
      setResults(data);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={C.textLight} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search groceries, snacks, dairy…"
            placeholderTextColor={C.textLight}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={doSearch}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <MaterialCommunityIcons name="close-circle" size={18} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : !searched && query.length < 2 ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons name="magnify" size={52} color={C.textLight} />
          <Text style={styles.hintTitle}>Search products</Text>
          <Text style={styles.hintText}>Type at least 2 characters to search</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons name="emoticon-sad-outline" size={52} color={C.textLight} />
          <Text style={styles.hintTitle}>No results for "{query}"</Text>
          <Text style={styles.hintText}>Try a different keyword or browse categories</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const cartItem = items.find((i) => i.product_id === item.id);
            const hasDiscount = item.original_price != null && item.original_price > item.price;

            return (
              <TouchableOpacity
                style={styles.resultCard}
                onPress={() => router.push(`../product/${item.id}`)}
                activeOpacity={0.85}
              >
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <MaterialCommunityIcons name="image-off-outline" size={22} color={C.textLight} />
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>₹{item.price}</Text>
                    {hasDiscount && (
                      <Text style={styles.originalPrice}>₹{item.original_price}</Text>
                    )}
                    <Text style={styles.unit}>/ {item.unit}</Text>
                  </View>
                  <Text style={styles.category}>{item.category}</Text>
                </View>

                {!item.in_stock ? (
                  <View style={styles.soldOutTag}>
                    <Text style={styles.soldOutTagText}>Out of Stock</Text>
                  </View>
                ) : cartItem ? (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity
                      style={styles.qtyBtnWrap}
                      onPress={() => updateQty(item.id, cartItem.quantity - 1)}
                    >
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtnWrap}
                      onPress={() => updateQty(item.id, cartItem.quantity + 1)}
                    >
                      <Text style={styles.qtyBtnText}>+</Text>
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
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    padding: 0,
  },

  list: { padding: 16, gap: 10 },

  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 32,
  },
  hintTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  hintText: { color: C.textSub, fontSize: 14, textAlign: "center" },

  resultCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },

  image: { width: 64, height: 64, borderRadius: 10 },
  imagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  name: { color: C.text, fontSize: 14, fontWeight: "600", marginBottom: 3 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  price: { color: C.primary, fontSize: 15, fontWeight: "800" },
  originalPrice: { color: C.textLight, fontSize: 12, textDecorationLine: "line-through" },
  unit: { color: C.textSub, fontSize: 12 },
  category: { color: C.textLight, fontSize: 11, marginTop: 3 },

  soldOutTag: {
    backgroundColor: C.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  soldOutTagText: { color: C.textSub, fontSize: 11, fontWeight: "600" },

  addBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  qtyBtnWrap: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: C.primary,
  },
  qtyBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  qtyValue: { color: C.text, fontSize: 14, fontWeight: "700", minWidth: 18, textAlign: "center" },
});
