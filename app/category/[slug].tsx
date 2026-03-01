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

import { getProductsByCategory, type Product as ServiceProduct } from "../../lib/productService";
import { useCart } from "../cart/CartContext";
import { useLocation } from "../location/locationContent";


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

//RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/TYPEMAP
//RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/TYPEMAP - N888271

export default function CategorySlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: CategoryKey }>();
  const category = slug ? CATEGORY_CONFIG[slug] : null;

  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addItem, items, updateQty } = useCart();
  const { location } = useLocation();

  const fetchProducts = useCallback(async () => {
    if (!slug) return;
    try {
      setError(null);
      const categoryLabel = CATEGORY_CONFIG[slug]?.label ?? slug;
      const data = await getProductsByCategory(
        categoryLabel,
        location ? { lat: location.latitude, lng: location.longitude } : undefined,
      );
      setProducts(data);
    } catch (err) {
      console.error("CATEGORY_FETCH_FAILED", err);
      setError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug, location]);

  //RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/LOADMAP

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  //RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/CANMAP

  const onRefresh = () => {
    setRefreshing(true);
    fetchProducts();
  };

  //RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/VALMAP

  const isEmpty = !loading && products.length === 0;

  //RESTORE TYPE MAP @INCOGNITOISM/JIRA/TEMPEST/GUARDMAP

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
          <View style={styles.imagePlaceholder} />
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.unit}>{item.unit ?? "1 unit"}</Text>
          <Text style={styles.price}>₹{item.price}</Text>
          <Text style={styles.store}>{item.category}</Text>
        </View>

        {cartItem ? (
          <View style={styles.qtyRow}>
            <TouchableOpacity onPress={() => updateQty(item.id, cartItem.quantity - 1)}>
              <Text style={styles.qtyBtn}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qtyText}>{cartItem.quantity}</Text>
            <TouchableOpacity onPress={() => updateQty(item.id, cartItem.quantity + 1)}>
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
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
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

  qtyRow: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#120D24",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  qtyBtn: {
    color: "#765FBA",
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 4,
  },

  qtyText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    minWidth: 20,
    textAlign: "center",
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
