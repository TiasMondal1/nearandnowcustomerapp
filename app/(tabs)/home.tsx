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
import { useCart } from "../cart/CartContext";
import { useLocation } from "../location/locationContent";

const PRIMARY = "#765fba";
const BG = "#05030A";

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
        contentContainerStyle={{ paddingBottom: 80, paddingHorizontal: 12 }}
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
                  color="#fff"
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
              <MaterialCommunityIcons name="magnify" size={20} color="#9C94D7" />
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
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 6,
  },
  deliverLabel: { fontSize: 11, color: "#9C94D7" },
  address: { fontSize: 15, color: "#fff", fontWeight: "600" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#120D24",
  },
  searchPlaceholder: { color: "#9C94D7", fontSize: 14 },
  categorySticky: {
    backgroundColor: BG,
    paddingVertical: 6,
    marginBottom: 10,
    zIndex: 10,
  },
  categoryRow: { paddingHorizontal: 0 },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: "#120D24",
    borderRadius: 999,
    minWidth: 90,
    marginRight: 8,
  },
  categoryActive: { backgroundColor: PRIMARY },
  categoryText: { fontSize: 10, color: "#aaa" },
  columnWrap: { justifyContent: "space-between", marginBottom: 8 },
  card: {
    width: "48%",
    backgroundColor: "#140F2D",
    borderRadius: 16,
    padding: 12,
    minHeight: 220,
    marginBottom: 10,
  },
  image: { width: "100%", height: 90, borderRadius: 10 },
  imagePlaceholder: {
    width: "100%",
    height: 90,
    borderRadius: 10,
    backgroundColor: "#1f1a3a",
  },
  productName: {
    fontSize: 13,
    color: "#fff",
    paddingTop: 10,
    minHeight: 34,
    lineHeight: 17,
  },
  priceRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  priceValue: { color: "#7CFF6B", fontSize: 14, fontWeight: "700", marginLeft: 2 },
  priceUnit: { color: "#9C94D7", fontSize: 11 },
  addBtn: {
    marginTop: 8,
    borderRadius: 999,
    paddingVertical: 6,
    backgroundColor: PRIMARY,
    alignItems: "center",
  },
  addText: { fontSize: 12, color: "#fff", fontWeight: "600" },
  qtyBox: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#120D24",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qtyBtn: { color: PRIMARY, fontSize: 18, fontWeight: "700", paddingHorizontal: 6 },
  qtyText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  cartIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#120D24",
    alignItems: "center",
    justifyContent: "center",
  },
  cartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  cartBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  empty: { marginTop: 80, alignItems: "center", paddingHorizontal: 12 },
  emptyText: { color: "#9C94D7", fontSize: 14, textAlign: "center" },
});
