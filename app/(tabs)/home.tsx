import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProfileMenu from "../../components/ProfileMenu";
import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllProducts, type Product } from "../../lib/productService";

const CATEGORIES = [
  { key: "All", icon: "apps" },
  { key: "Fruits", icon: "food-apple" },
  { key: "Vegetables", icon: "food-variant" },
  { key: "Dairy", icon: "cow" },
  { key: "Snacks", icon: "cookie" },
  { key: "Beverages", icon: "cup" },
  { key: "Staples", icon: "sack" },
];

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();
  const { user } = useAuth();

  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);

  const fetchProducts = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const loc = locationRef.current;
      const data = await getAllProducts(
        loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
      );
      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchProducts();
    });
    return () => task.cancel();
  }, [fetchProducts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProducts(true);
    setRefreshing(false);
  }, [fetchProducts]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "All") return products;
    return products.filter(
      (p) => p.category?.toLowerCase() === activeCategory.toLowerCase(),
    );
  }, [products, activeCategory]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Finding products near you…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.appHeader}>
        <View style={styles.appBranding}>
          <Image
            source={require("../../Logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.appName}>near & now</Text>
        </View>
        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => setShowProfileMenu(true)}
          activeOpacity={0.8}
        >
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitial}>
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.locationBar}>
        <TouchableOpacity
          onPress={() => router.push("/location")}
          style={styles.locationContent}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="map-marker"
            size={20}
            color={C.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationLabel}>Deliver to</Text>
            <Text style={styles.locationAddress} numberOfLines={1}>
              {location?.label ?? "Select your location"}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-down"
            size={20}
            color={C.textSub}
          />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        removeClippedSubviews={true}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        columnWrapperStyle={styles.columnWrap}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <TouchableOpacity
              style={styles.searchBar}
              activeOpacity={0.85}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons name="magnify" size={20} color={C.textLight} />
              <Text style={styles.searchPlaceholder}>Search groceries, dairy, snacks…</Text>
            </TouchableOpacity>

            <FlatList
              data={CATEGORIES}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.key}
              contentContainerStyle={styles.categorySlider}
              renderItem={({ item }) => {
                const active = activeCategory === item.key;
                return (
                  <TouchableOpacity
                    onPress={() => setActiveCategory(item.key)}
                    style={[styles.categoryIcon, active && styles.categoryIconActive]}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.categoryIconCircle, active && styles.categoryIconCircleActive]}>
                      <MaterialCommunityIcons
                        name={item.icon as any}
                        size={24}
                        color={active ? "#fff" : C.primary}
                      />
                    </View>
                    <Text style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
                      {item.key}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <Text style={styles.sectionLabel}>
              {activeCategory === "All" ? "All Products" : activeCategory}
              <Text style={styles.productCount}> ({filteredProducts.length})</Text>
            </Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="store-off-outline" size={56} color={C.textLight} />
            <Text style={styles.emptyTitle}>
              {location ? "No products found" : "Set your location"}
            </Text>
            <Text style={styles.emptyText}>
              {location
                ? "No products match this category near you."
                : "We'll show you what's available nearby."}
            </Text>
            {!location && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push("/location")}
              >
                <Text style={styles.emptyBtnText}>Choose Location</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item: p }) => {
          const cartItem = items.find((i) => i.product_id === p.id);
          const hasDiscount =
            p.original_price != null && p.original_price > p.price;
          const discountPct = hasDiscount
            ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
            : 0;

          return (
            <View style={[styles.card, !p.in_stock && styles.cardOutOfStock]}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push(`../product/${p.id}`)}
              >
                <View style={styles.imageWrap}>
                  {p.image_url ? (
                    <Image source={{ uri: p.image_url }} style={styles.image} />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <MaterialCommunityIcons
                        name="image-off-outline"
                        size={28}
                        color={C.textLight}
                      />
                    </View>
                  )}
                  {hasDiscount && (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountText}>{discountPct}% OFF</Text>
                    </View>
                  )}
                  {!p.in_stock && (
                    <View style={styles.outOfStockOverlay}>
                      <Text style={styles.outOfStockText}>Out of Stock</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.cardBody}>
                <Text style={styles.productName} numberOfLines={2}>
                  {p.name}
                </Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceValue}>₹{p.price}</Text>
                  {hasDiscount && (
                    <Text style={styles.originalPrice}>₹{p.original_price}</Text>
                  )}
                  <Text style={styles.priceUnit}>/{p.unit}</Text>
                </View>

                {p.in_stock ? (
                  cartItem ? (
                    <View style={styles.qtyBox}>
                      <TouchableOpacity
                        style={styles.qtyBtnWrap}
                        onPress={() => updateQty(p.id, cartItem.quantity - 1)}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtnWrap}
                        onPress={() => updateQty(p.id, cartItem.quantity + 1)}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      activeOpacity={0.85}
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
                      <MaterialCommunityIcons name="plus" size={14} color="#fff" />
                    </TouchableOpacity>
                  )
                ) : (
                  <View style={styles.soldOutBtn}>
                    <Text style={styles.soldOutText}>Sold Out</Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      <ProfileMenu
        visible={showProfileMenu}
        onClose={() => setShowProfileMenu(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: C.textSub, fontSize: 14 },
  listContent: { paddingBottom: 100, paddingHorizontal: 16 },

  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appBranding: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  appName: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
    letterSpacing: 0.3,
  },
  profileBtn: {
    padding: 2,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.primaryLight,
  },
  profileInitial: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  locationBar: {
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  locationContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationLabel: {
    fontSize: 11,
    color: C.textSub,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationAddress: {
    fontSize: 14,
    color: C.text,
    fontWeight: "700",
    marginTop: 2,
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  searchPlaceholder: { color: C.textLight, fontSize: 15, flex: 1 },

  categorySlider: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 16,
  },
  categoryIcon: {
    alignItems: "center",
    gap: 8,
    width: 72,
  },
  categoryIconActive: {},
  categoryIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.primaryLight,
  },
  categoryIconCircleActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  categoryLabel: {
    fontSize: 12,
    color: C.textSub,
    fontWeight: "600",
    textAlign: "center",
  },
  categoryLabelActive: {
    color: C.primary,
    fontWeight: "800",
  },

  sectionLabel: {
    fontSize: 15,
    color: C.text,
    fontWeight: "800",
    marginBottom: 12,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  productCount: { color: C.textSub, fontWeight: "500" },

  columnWrap: { justifyContent: "space-between", marginBottom: 12 },

  card: {
    width: "48.5%",
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 4,
  },
  cardOutOfStock: { opacity: 0.65 },
  cardBody: { padding: 12 },

  imageWrap: { position: "relative", backgroundColor: C.bgSoft },
  image: { width: "100%", height: 140, resizeMode: "cover" },
  imagePlaceholder: {
    width: "100%",
    height: 140,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  discountBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: C.danger,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  discountText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  outOfStockOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  productName: {
    fontSize: 14,
    color: C.text,
    lineHeight: 19,
    fontWeight: "600",
    minHeight: 38,
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  priceValue: { color: C.primary, fontSize: 18, fontWeight: "900", letterSpacing: -0.5 },
  originalPrice: {
    color: C.textLight,
    fontSize: 13,
    textDecorationLine: "line-through",
    fontWeight: "500",
  },
  priceUnit: { color: C.textSub, fontSize: 12, fontWeight: "500" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  addText: { fontSize: 13, color: "#fff", fontWeight: "900", letterSpacing: 0.8 },
  soldOutBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
  },
  soldOutText: { color: C.textSub, fontSize: 13, fontWeight: "700" },

  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    paddingHorizontal: 5,
    paddingVertical: 5,
  },
  qtyBtnWrap: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.primary,
  },
  qtyBtnText: { color: "#fff", fontSize: 18, fontWeight: "900" },
  qtyValue: { color: C.text, fontSize: 15, fontWeight: "800", minWidth: 24, textAlign: "center" },

  empty: {
    marginTop: 60,
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800", marginTop: 8 },
  emptyText: { color: C.textSub, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: C.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
