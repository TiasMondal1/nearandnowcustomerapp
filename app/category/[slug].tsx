import React, { useCallback, useEffect, useState } from "react";

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

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSession } from "../../session";
import { useCart } from "../cart/CartContext";

/* ─────────────────────────────────────────────────────────────
 * API
 * ───────────────────────────────────────────────────────────── */

const API_BASE = "http://192.168.1.117:3001";

/* ─────────────────────────────────────────────────────────────
 * CATEGORY CONFIG (STATIC)
 * -------------------------------------------------------------
 * Must stay in sync with backend categories
 * ───────────────────────────────────────────────────────────── */

export const CATEGORY_CONFIG = {
  fruits: {
    label: "Fruits",
    icon: "apple",
    color: "#FF6B6B",
  },
  vegetables: {
    label: "Vegetables",
    icon: "leaf",
    color: "#51CF66",
  },
  dairy: {
    label: "Dairy",
    icon: "cow",
    color: "#FFD43B",
  },
  snacks: {
    label: "Snacks",
    icon: "cookie",
    color: "#845EF7",
  },
  beverages: {
    label: "Beverages",
    icon: "cup",
    color: "#339AF0",
  },
  staples: {
    label: "Staples",
    icon: "sack",
    color: "#FAB005",
  },
  personal_care: {
    label: "Personal Care",
    icon: "face-woman-shimmer",
    color: "#E599F7",
  },
  household: {
    label: "Household",
    icon: "home-outline",
    color: "#74C0FC",
  },
} as const;

/** ✅ SAFE slug type */
export type CategoryKey = keyof typeof CATEGORY_CONFIG;

/* ─────────────────────────────────────────────────────────────
 * TYPES
 * ───────────────────────────────────────────────────────────── */

type Product = {
  id: string;
  name: string;
  price: number;
  unit?: string;
  image_url?: string;
  store_id: string;
  store_name: string;
  distance_km: number;
};

/* ─────────────────────────────────────────────────────────────
 * MAIN SCREEN
 * ───────────────────────────────────────────────────────────── */

export default function CategorySlugScreen() {
  /* ───────── ROUTE PARAMS ───────── */

  const { slug } = useLocalSearchParams<{ slug: CategoryKey }>();

  const category = slug ? CATEGORY_CONFIG[slug] : null;

  /* ───────── STATE ───────── */

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addItem } = useCart();

  /* ───────────────────────────────────────────────────────────
   * FETCH PRODUCTS
   * -----------------------------------------------------------
   * Backend should:
   * GET /customer/category/:slug
   * ─────────────────────────────────────────────────────────── */

  const fetchProducts = useCallback(async () => {
    if (!slug) return;

    try {
      setError(null);

      const session = await getSession();
      if (!session?.token) {
        throw new Error("SESSION_EXPIRED");
      }

      const res = await fetch(`${API_BASE}/customer/category/${slug}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "FETCH_FAILED");
      }

      setProducts(json.products ?? []);
    } catch (err) {
      console.error("CATEGORY_FETCH_FAILED", err);
      setError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  /* ───────── INITIAL LOAD ───────── */

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  /* ───────── PULL TO REFRESH ───────── */

  const onRefresh = () => {
    setRefreshing(true);
    fetchProducts();
  };

  /* ───────────────────────────────────────────────────────────
   * DERIVED VALUES
   * ─────────────────────────────────────────────────────────── */

  const isEmpty = !loading && products.length === 0;

  /* ───────────────────────────────────────────────────────────
   * GUARDS
   * ─────────────────────────────────────────────────────────── */

  if (!category) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>Invalid category</Text>
      </SafeAreaView>
    );
  }

  /* ───────────────────────────────────────────────────────────
   * RENDER PRODUCT CARD
   * ─────────────────────────────────────────────────────────── */

  const renderItem = ({ item }: { item: Product }) => {
    return (
      <View style={styles.card}>
        {/* IMAGE */}
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder} />
        )}

        {/* INFO */}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>

          <Text style={styles.unit}>{item.unit ?? "1 unit"}</Text>

          <Text style={styles.price}>₹{item.price}</Text>

          <Text style={styles.store}>
            {item.store_name} • {item.distance_km.toFixed(1)} km
          </Text>
        </View>

        {/* ADD BUTTON */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() =>
            addItem({
              product_id: item.id,
              store_id: item.store_id,
              name: item.name,
              price: item.price,
              unit: item.unit,
              image_url: item.image_url,
              distance_km: item.distance_km,
            })
          }
        >
          <Text style={styles.addText}>ADD</Text>
        </TouchableOpacity>
      </View>
    );
  };

  /* ───────────────────────────────────────────────────────────
   * UI
   * ─────────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MaterialCommunityIcons
            name={category.icon}
            size={20}
            color={category.color}
          />
          <Text style={styles.headerTitle}>{category.label}</Text>
        </View>

        <View style={{ width: 24 }} />
      </View>

      {/* CONTENT */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={category.color} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No products available</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={category.color}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────────────────────
 * STYLES
 * ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#05030A",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1F1A3A",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },

  list: {
    padding: 16,
    paddingBottom: 120,
  },

  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#140F2D",
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2A2450",
  },

  image: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: "#1C1636",
  },

  imagePlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: "#1C1636",
  },

  name: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  unit: {
    color: "#9C94D7",
    fontSize: 11,
    marginTop: 2,
  },

  price: {
    color: "#3CFF8F",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },

  store: {
    color: "#9C94D7",
    fontSize: 10,
    marginTop: 2,
  },

  addBtn: {
    alignSelf: "center",
    backgroundColor: "#765FBA",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },

  addText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  errorText: {
    color: "#FF6B6B",
    fontWeight: "700",
  },

  emptyText: {
    color: "#9C94D7",
    fontWeight: "600",
  },
});
