import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getProductsByCategory, type Product as ServiceProduct } from "../../lib/productService";


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

export type CategoryKey = keyof typeof CATEGORY_CONFIG;

export default function CategorySlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: CategoryKey }>();
  const category = slug ? CATEGORY_CONFIG[slug] : null;

  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addItem, items, updateQty } = useCart();
  const { location } = useLocation();

  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);

  const fetchProducts = useCallback(async (isRefresh = false) => {
    if (!slug) return;
    try {
      setError(null);
      const categoryLabel = CATEGORY_CONFIG[slug]?.label ?? slug;
      const loc = locationRef.current;
      const data = await getProductsByCategory(
        categoryLabel,
        loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
      );
      setProducts(data);
    } catch {
      setError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchProducts();
    });
    return () => task.cancel();
  }, [fetchProducts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts(true);
  }, [fetchProducts]);

  const isEmpty = !loading && products.length === 0;

  if (!category) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>Invalid category</Text>
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: ServiceProduct }) => {
    const cartItem = items.find((i) => i.product_id === item.id);
    return (
      <View style={styles.card}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <MaterialCommunityIcons name="image-off-outline" size={24} color={C.textLight} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.unit}>{item.unit ?? "1 unit"}</Text>
          <Text style={styles.price}>₹{item.price}</Text>
          {item.category ? <Text style={styles.store}>{item.category}</Text> : null}
        </View>

        {cartItem ? (
          <View style={styles.qtyRow}>
            <TouchableOpacity onPress={() => updateQty(item.id, cartItem.quantity - 1)}>
              <MaterialCommunityIcons name="minus" size={16} color={C.primary} />
            </TouchableOpacity>
            <Text style={styles.qtyText}>{cartItem.quantity}</Text>
            <TouchableOpacity onPress={() => updateQty(item.id, cartItem.quantity + 1)}>
              <MaterialCommunityIcons name="plus" size={16} color={C.primary} />
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
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MaterialCommunityIcons
            name={category.icon}
            size={20}
            color={category.color}
          />
          <Text style={styles.headerTitle}>{category.label}</Text>
        </View>

        <View style={{ width: 38 }} />
      </View>

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
          removeClippedSubviews={true}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={category.color}
              colors={[category.color]}
            />
          }
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "800" },

  list: { padding: 16, paddingBottom: 120 },

  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },

  image: {
    width: 72, height: 72, borderRadius: 12,
    backgroundColor: C.bgSoft,
  },
  imagePlaceholder: {
    width: 72, height: 72, borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center", justifyContent: "center",
  },

  name: { color: C.text, fontSize: 14, fontWeight: "700" },
  unit: { color: C.textLight, fontSize: 11, marginTop: 2 },
  price: { color: C.primary, fontSize: 15, fontWeight: "800", marginTop: 4 },
  store: { color: C.textSub, fontSize: 10, marginTop: 2 },

  addBtn: {
    alignSelf: "center",
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  qtyRow: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  qtyText: {
    color: C.primary, fontSize: 14, fontWeight: "700",
    minWidth: 20, textAlign: "center",
  },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorText: { color: C.danger, fontWeight: "700" },
  emptyText: { color: C.textSub, fontWeight: "600" },
});
