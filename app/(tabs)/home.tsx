import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getAllProducts, type Product } from "../../lib/productService";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";

const PRIMARY = "#059669";
const SECONDARY = "#047857";
const BG = "#f9fafb";

const CATEGORIES = [
  { key: "All", icon: "apps" },
  { key: "Fruits", icon: "food-apple" },
  { key: "Vegetables", icon: "food-variant" },
  { key: "Dairy", icon: "cow" },
  { key: "Snacks", icon: "cookie" },
  { key: "Beverages", icon: "cup" },
];

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();

  useEffect(() => {
    fetchProducts();
    const interval = setInterval(fetchProducts, 60000);
    return () => clearInterval(interval);
  }, [location]);

  const fetchProducts = async () => {
    try {
      if (!refreshing) setLoading(true);
      const data = await getAllProducts(
        location
          ? { lat: location.latitude, lng: location.longitude }
          : undefined,
      );
      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProducts();
    setRefreshing(false);
  };

  const filteredProducts = useMemo(() => {
    if (activeCategory === "All") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
            colors={[PRIMARY]}
          />
        }
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={styles.columnWrap}
        contentContainerStyle={{ paddingBottom: 80, paddingHorizontal: 16 }}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.deliverLabel}>Delivering to</Text>
                <TouchableOpacity onPress={() => router.push("/location")}>
                  <Text style={styles.address}>
                    {location?.label ?? "Select location"} ▼
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.cartIconWrap}
                onPress={() => router.push("../support/cart")}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name="cart-outline"
                  size={24}
                  color="#1f2937"
                />
                {items.length > 0 && (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>
                      {items.reduce((sum, i) => sum + i.quantity, 0)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.searchBar}
              activeOpacity={0.8}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons name="magnify" size={20} color="#9ca3af" />
              <Text style={styles.searchPlaceholder}>Search for products</Text>
            </TouchableOpacity>

            <View style={styles.categorySticky}>
              <FlatList
                data={CATEGORIES}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(c) => c.key}
                contentContainerStyle={styles.categoryRow}
                renderItem={({ item }) => {
                  const active = activeCategory === item.key;
                  return (
                    <TouchableOpacity
                      onPress={() => setActiveCategory(item.key)}
                      style={[
                        styles.categoryChip,
                        active && styles.categoryActive,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={item.icon as any}
                        size={18}
                        color={active ? "#fff" : "#aaa"}
                      />
                      <Text
                        style={[
                          styles.categoryText,
                          active && { color: "#fff" },
                        ]}
                      >
                        {item.key}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {location ? "No products available nearby" : "Select a location to see products"}
            </Text>
          </View>
        }
        renderItem={({ item: p }) => {
          const cartItem = items.find((i) => i.product_id === p.id);

          return (
            <View style={styles.card}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push(`../product/${p.id}`)}
              >
                {p.image_url ? (
                  <Image source={{ uri: p.image_url }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}
              </TouchableOpacity>

              <Text style={styles.productName} numberOfLines={2} ellipsizeMode="tail">
                {p.name}
              </Text>

              <View style={styles.priceRow}>
                <MaterialCommunityIcons name="currency-inr" size={14} color="#7CFF6B" />
                <Text style={styles.priceValue}>{p.price}</Text>
                <Text style={styles.priceUnit}> / {p.unit}</Text>
              </View>

              {cartItem ? (
                <View style={styles.qtyBox}>
                  <TouchableOpacity
                    onPress={() => updateQty(p.id, cartItem.quantity - 1)}
                  >
                    <Text style={styles.qtyBtn}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{cartItem.quantity}</Text>
                  <TouchableOpacity
                    onPress={() => updateQty(p.id, cartItem.quantity + 1)}
                  >
                    <Text style={styles.qtyBtn}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.addBtn, { marginTop: "auto" }]}
                  onPress={() =>
                    addItem({
                      product_id: p.id,
                      name: p.name,
                      price: p.price,
                      unit: p.unit,
                      image_url: p.image_url,
                    })
                  }
                >
                  <Text style={styles.addText}>ADD</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  deliverLabel: { fontSize: 10, color: "#6b7280", fontWeight: "600", textTransform: "uppercase" },
  address: { fontSize: 14, color: "#1f2937", fontWeight: "700", marginTop: 2 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  searchPlaceholder: { color: "#9ca3af", fontSize: 14 },
  categorySticky: {
    backgroundColor: BG,
    paddingVertical: 8,
    marginBottom: 12,
    zIndex: 10,
  },
  categoryRow: { paddingHorizontal: 16 },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 42,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderRadius: 999,
    minWidth: 100,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  categoryActive: { 
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  categoryText: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  columnWrap: { justifyContent: "space-between", marginBottom: 12 },
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 0,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    overflow: "hidden",
  },
  image: { width: "100%", height: 120, borderRadius: 0 },
  imagePlaceholder: {
    width: "100%",
    height: 120,
    backgroundColor: "#f3f4f6",
  },
  productName: {
    fontSize: 13,
    color: "#1f2937",
    paddingHorizontal: 12,
    paddingTop: 10,
    minHeight: 40,
    lineHeight: 18,
    fontWeight: "500",
  },
  priceRow: { 
    flexDirection: "row", 
    alignItems: "center", 
    marginTop: 4,
    paddingHorizontal: 12,
  },
  priceValue: { color: PRIMARY, fontSize: 16, fontWeight: "700", marginLeft: 2 },
  priceUnit: { color: "#6b7280", fontSize: 12 },
  addBtn: {
    marginTop: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 8,
    paddingVertical: 8,
    backgroundColor: PRIMARY,
    alignItems: "center",
  },
  addText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  qtyBox: {
    marginTop: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  qtyBtn: { color: PRIMARY, fontSize: 20, fontWeight: "700", paddingHorizontal: 8 },
  qtyText: { color: "#1f2937", fontSize: 15, fontWeight: "600" },
  cartIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  cartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#ef4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  cartBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  empty: { marginTop: 80, alignItems: "center", paddingHorizontal: 16 },
  emptyText: { color: "#6b7280", fontSize: 15, textAlign: "center" },
});
