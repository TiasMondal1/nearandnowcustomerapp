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
import { getCategoryBySlug, type Category } from "../../lib/categoryService";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getProductsByCategory, type Product as ServiceProduct } from "../../lib/productService";
import StarRating from "../../components/StarRating";

const FALLBACK_COLORS = [
  "#FF6B6B", "#51CF66", "#FFD43B", "#845EF7", 
  "#339AF0", "#FAB005", "#E599F7", "#74C0FC"
];

const FALLBACK_ICONS = [
  "apple", "leaf", "cow", "cookie", 
  "cup", "sack", "face-woman-shimmer", "home-outline"
];

export default function CategorySlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addItem, items, updateQty } = useCart();
  const { location } = useLocation();

  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!slug) return;
    try {
      setError(null);
      if (!isRefresh) setLoading(true);
      
      const [categoryData, productsData] = await Promise.all([
        getCategoryBySlug(slug),
        (async () => {
          const cat = await getCategoryBySlug(slug);
          if (!cat) return [];
          const loc = locationRef.current;
          return getProductsByCategory(
            cat.name,
            loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
          );
        })()
      ]);

      setCategory(categoryData);
      setProducts(productsData);
    } catch (err) {
      console.error("Failed to load category:", err);
      setError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchData();
    });
    return () => task.cancel();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const isEmpty = !loading && products.length === 0;

  if (!category && !loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Category</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>Category not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const categoryColor = category?.color || FALLBACK_COLORS[0];
  const categoryIcon = category?.icon || FALLBACK_ICONS[0];

  const renderItem = ({ item }: { item: ServiceProduct }) => {
    const cartItem = items.find((i) => i.product_id === item.id);
    const hasDiscount = item.original_price != null && item.original_price > item.price;
    const discountPct = hasDiscount
      ? Math.round(((item.original_price! - item.price) / item.original_price!) * 100)
      : 0;

    return (
      <View style={[styles.card, !item.in_stock && styles.cardOutOfStock]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push(`../product/${item.id}`)}
        >
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <MaterialCommunityIcons name="image-off-outline" size={24} color={C.textLight} />
            </View>
          )}
          {hasDiscount && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>{discountPct}% OFF</Text>
            </View>
          )}
          {!item.in_stock && (
            <View style={styles.outOfStockOverlay}>
              <Text style={styles.outOfStockText}>Out of Stock</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.cardBody}>
          <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>₹{item.price}</Text>
            {hasDiscount && (
              <Text style={styles.originalPrice}>₹{item.original_price}</Text>
            )}
            <Text style={styles.unit}>{item.unit}</Text>
          </View>

          <View style={styles.ratingWrap}>
            <StarRating
              rating={item.avgRating ?? 0}
              reviewCount={item.reviewCount}
            />
          </View>

          {item.in_stock ? (
            cartItem ? (
              <View style={styles.qtyRow}>
                <TouchableOpacity 
                  style={styles.qtyBtn}
                  onPress={() => updateQty(item.id, cartItem.quantity - 1)}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyText}>{cartItem.quantity}</Text>
                <TouchableOpacity 
                  style={styles.qtyBtn}
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
            )
          ) : (
            <View style={styles.soldOutBtn}>
              <Text style={styles.soldOutText}>Sold Out</Text>
            </View>
          )}
        </View>
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
          {category?.image_url ? (
            <Image 
              source={{ uri: category.image_url }} 
              style={styles.headerImage}
            />
          ) : (
            <MaterialCommunityIcons
              name={categoryIcon as any}
              size={20}
              color={categoryColor}
            />
          )}
          <Text style={styles.headerTitle}>{category?.name || "Category"}</Text>
        </View>

        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={categoryColor} />
          <Text style={styles.loadingText}>Loading products...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={C.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchData()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="package-variant-closed-remove" size={56} color={C.textLight} />
          <Text style={styles.emptyText}>No products available</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
        numColumns={3}
          columnWrapperStyle={styles.columnWrap}
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
              tintColor={categoryColor}
              colors={[categoryColor]}
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
    width: 38, 
    height: 38, 
    borderRadius: 12,
    backgroundColor: C.bgSoft, 
    alignItems: "center", 
    justifyContent: "center",
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  headerImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },

  list: { 
    padding: 16, 
    paddingBottom: 120,
  },

  columnWrap: { 
    justifyContent: "space-between", 
    marginBottom: 12,
  },

  card: {
    width: "32%",
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 4,
  },

  cardOutOfStock: { 
    opacity: 0.65,
  },

  cardBody: { 
    padding: 12,
  },

  image: {
    width: "100%", 
    height: 140, 
    backgroundColor: C.bgSoft,
  },

  imagePlaceholder: {
    width: "100%", 
    height: 140, 
    borderRadius: 12,
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

  discountText: { 
    color: "#fff", 
    fontSize: 11, 
    fontWeight: "900", 
    letterSpacing: 0.3,
  },

  outOfStockOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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

  name: { 
    color: C.text, 
    fontSize: 14, 
    fontWeight: "600",
    lineHeight: 19,
    minHeight: 38,
    marginBottom: 8,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 6,
    flexWrap: "wrap",
  },

  price: { 
    color: C.primary, 
    fontSize: 15, 
    fontWeight: "800",
  },

  originalPrice: {
    color: C.textLight,
    fontSize: 13,
    textDecorationLine: "line-through",
    fontWeight: "500",
  },

  unit: { 
    color: C.textSub, 
    fontSize: 12, 
    fontWeight: "500",
  },

  ratingWrap: {
    marginBottom: 4,
  },

  addBtn: {
    alignSelf: "stretch",
    backgroundColor: C.primary,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  addText: { 
    color: "#fff", 
    fontWeight: "800", 
    fontSize: 13,
    letterSpacing: 0.8,
  },

  soldOutBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
  },

  soldOutText: { 
    color: C.textSub, 
    fontSize: 13, 
    fontWeight: "700",
  },

  qtyRow: {
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

  qtyBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.primary,
  },

  qtyBtnText: { 
    color: "#fff", 
    fontSize: 18, 
    fontWeight: "900",
  },

  qtyText: {
    color: C.primary, 
    fontSize: 14, 
    fontWeight: "700",
    minWidth: 20, 
    textAlign: "center",
  },

  center: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center",
    gap: 12,
  },

  loadingText: {
    color: C.textSub,
    fontSize: 14,
  },

  errorText: { 
    color: C.danger, 
    fontWeight: "700",
    fontSize: 15,
  },

  emptyText: { 
    color: C.textSub, 
    fontWeight: "600",
    fontSize: 15,
  },

  retryBtn: {
    marginTop: 12,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },

  retryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
