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

import { getSession } from "../../session";
import { useCart } from "../cart/CartContext";
import { useLocation } from "../location/locationContent";

const API_BASE = "http://192.168.1.117:3001";
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
  const [feed, setFeed] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [ads, setAds] = useState<Record<string, any[]>>({});

  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();

  useEffect(() => {
    console.log("🛒 CART ITEMS:", items);
  }, [items]);

  /* ─────────── Fetch feed ─────────── */

  useEffect(() => {
    if (!location) {
      setLoading(false);
      return;
    }

    fetchFeed();
    const interval = setInterval(fetchFeed, 60000);
    return () => clearInterval(interval);
  }, [location]);

  const fetchFeed = async () => {
    try {
      if (!refreshing) setLoading(true);

      const session = await getSession();
      if (!session?.token || !location) {
        setLoading(false);
        return;
      }

      const res = await fetch(
        `${API_BASE}/customer/home-feed?lat=${location.latitude}&lng=${location.longitude}`,
        { headers: { Authorization: `Bearer ${session.token}` } },
      );

      const json = await res.json();
      setFeed(json.stores || []);
      setAds(json.ads || {});
    } catch {
      setFeed([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  };

  /* ─────────── Filtering ─────────── */

  const filteredFeed = useMemo(() => {
    if (activeCategory === "All") return feed;

    return feed
      .map((store) => ({
        ...store,
        products: store.products.filter(
          (p: any) => p.category === activeCategory,
        ),
      }))
      .filter((s) => s.products.length > 0);
  }, [feed, activeCategory]);

  /* ─────────── Inject ads ─────────── */

  const AD_FREQUENCY = 2;

  const mixedFeed = useMemo(() => {
    const result: any[] = [];
    let adIndex = 0;

    filteredFeed.forEach((store, i) => {
      result.push({ type: "store", data: store });

      if ((i + 1) % AD_FREQUENCY === 0) {
        if (ads.mid_feed_1?.[adIndex]) {
          result.push({ type: "ad", data: ads.mid_feed_1[adIndex] });
          adIndex++;
        } else {
          result.push({ type: "ad-placeholder" });
        }
      }
    });

    return result;
  }, [filteredFeed, ads]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  /* ─────────── UI ─────────── */

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={mixedFeed}
        keyExtractor={(item, i) =>
          item.type === "store" ? item.data.store_id : `${item.type}-${i}`
        }
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
        ListHeaderComponent={
          <>
            {/* HEADER */}
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.deliverLabel}>Delivering to</Text>
                <TouchableOpacity onPress={() => router.push("/location")}>
                  <Text style={styles.address}>
                    📍 {location?.label ?? "Select location"} ▼
                  </Text>
                </TouchableOpacity>
              </View>

              {/* CART ICON */}
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

            {/* SEARCH */}
            <TouchableOpacity
              style={styles.searchBar}
              activeOpacity={0.8}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color="#9C94D7"
              />
              <Text style={styles.searchPlaceholder}>Search for products</Text>
            </TouchableOpacity>

            {/* TOP BANNER */}
            {ads.top_banner?.[0] && (
              <View style={styles.bannerAd}>
                <Image
                  source={{ uri: ads.top_banner[0].image_url }}
                  style={styles.bannerImage}
                />
              </View>
            )}

            {/* CATEGORIES */}
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
                        name={item.icon}
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
        contentContainerStyle={{ paddingBottom: 60 }}
        renderItem={({ item }) => {
          if (item.type === "ad") {
            return (
              <View style={styles.adSlot}>
                <Image
                  source={{ uri: item.data.image_url }}
                  style={styles.bannerImage}
                />
              </View>
            );
          }

          if (item.type === "ad-placeholder") {
            return (
              <View style={styles.adSlot}>
                <Text style={styles.adPlaceholderText}>Sponsored</Text>
              </View>
            );
          }

          const store = item.data;

          return (
            <View style={{ marginBottom: 14 }}>
              <View style={styles.storeHeader}>
                <Text style={styles.storeName}>{store.store_name}</Text>
                <View style={styles.distancePill}>
                  <Text style={styles.distance}>
                    {store.distance_km.toFixed(1)} km
                  </Text>
                </View>
              </View>

              <FlatList
                data={store.products}
                keyExtractor={(p) => p.product_id}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={styles.columnWrap}
                contentContainerStyle={styles.productList}
                renderItem={({ item: p }) => {
                  const storeIds = Array.from(
                    new Set(items.map((i) => i.store_id)),
                  );

                  const isThirdStore =
                    storeIds.length >= 2 && !storeIds.includes(store.store_id);

                  const cartItem = items.find(
                    (i) => i.product_id === p.product_id,
                  );

                  return (
                    <View style={styles.card}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() =>
                          router.push(`../product/${p.product_id}`)
                        }
                      >
                        {p.image_url ? (
                          <Image
                            source={{ uri: p.image_url }}
                            style={styles.image}
                          />
                        ) : (
                          <View style={styles.imagePlaceholder} />
                        )}
                      </TouchableOpacity>
                      <Text
                        style={styles.productName}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                      >
                        {p.name}
                      </Text>

                      <View style={styles.priceRow}>
                        <MaterialCommunityIcons
                          name="currency-inr"
                          size={14}
                          color="#7CFF6B" // solid green ₹
                        />
                        <Text style={styles.priceValue}>{p.price}</Text>
                        <Text style={styles.priceUnit}></Text>
                      </View>

                      {cartItem ? (
                        <View style={styles.qtyBox}>
                          <TouchableOpacity
                            onPress={() =>
                              updateQty(p.product_id, cartItem.quantity - 1)
                            }
                          >
                            <Text style={styles.qtyBtn}>−</Text>
                          </TouchableOpacity>

                          <Text style={styles.qtyText}>
                            {cartItem.quantity}
                          </Text>

                          <TouchableOpacity
                            onPress={() =>
                              updateQty(p.product_id, cartItem.quantity + 1)
                            }
                          >
                            <Text style={styles.qtyBtn}>+</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          disabled={isThirdStore}
                          style={[
                            styles.addBtn,
                            { marginTop: "auto" },
                            isThirdStore && { opacity: 0.4 },
                          ]}
                          onPress={() =>
                            addItem({
                              product_id: p.product_id,
                              store_id: store.store_id,
                              name: p.name,
                              price: p.price,
                              unit: p.unit,
                              image_url: p.image_url,
                              distance_km: store.distance_km,
                            })
                          }
                        >
                          <Text style={styles.addText}>
                            {isThirdStore ? "LIMIT" : "ADD"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

/* ─────────── STYLES ─────────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },

  deliverLabel: { fontSize: 11, color: "#9C94D7" },
  address: { fontSize: 15, color: "#fff", fontWeight: "600" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#120D24",
  },

  searchPlaceholder: {
    color: "#9C94D7",
    fontSize: 14,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },

  categorySticky: {
    backgroundColor: BG,
    paddingVertical: 6,
    zIndex: 10,
    elevation: 10, // Android
  },

  priceValue: {
    color: "#7CFF6B",
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 2,
  },

  priceUnit: {
    color: "#9C94D7",
    fontSize: 11,
  },

  bannerAd: {
    marginHorizontal: 16,
    marginBottom: 10,
    height: 120,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1c1636",
  },

  bannerImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },

  stickyWrap: {
    backgroundColor: BG,
    paddingVertical: 6,
  },

  categoryRow: { paddingHorizontal: 16 },

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

  storeHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  storeName: { fontSize: 20, fontWeight: "700", color: "#fff" },

  distancePill: {
    backgroundColor: "#1c1636",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },

  distance: { fontSize: 12, color: "#aaa" },

  productList: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },

  columnWrap: {
    justifyContent: "space-between",
    marginBottom: 8,
  },

  card: {
    width: "48%",
    backgroundColor: "#140F2D",
    borderRadius: 16,
    padding: 12,
    height: 230,
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
    minHeight: 34, // 🔒 LOCK HEIGHT (2 lines)
    lineHeight: 17,
  },
  price: { fontSize: 12, color: "#C4BDEA" },

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

  qtyBtn: {
    color: PRIMARY,
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 6,
  },

  qtyText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  adSlot: {
    height: 90,
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 16,
    backgroundColor: "#1c1636",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },

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

  cartBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },

  adPlaceholderText: {
    color: "#9C94D7",
    fontSize: 13,
    fontWeight: "600",
  },
});
