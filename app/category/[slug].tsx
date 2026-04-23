import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { getCategoryBySlug, type Category } from "../../lib/categoryService";
import { useCart, useCartItemMap } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { cdnImage } from "../../lib/imageUrl";
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

type ProductCardProps = {
  item: ServiceProduct;
  cartQty: number;
  onAdd: (product: Omit<import("../../context/CartContext").CartItem, "quantity">) => void;
  onUpdateQty: (productId: string, qty: number) => void;
};

const ProductCard = React.memo(function ProductCard({ item, cartQty, onAdd, onUpdateQty }: ProductCardProps) {
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
          <Image
            source={{ uri: cdnImage(item.image_url, 240) }}
            style={styles.image}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={item.id}
            priority="low"
          />
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
          <StarRating rating={item.avgRating ?? 0} reviewCount={item.reviewCount} />
        </View>

        {item.in_stock ? (
          cartQty > 0 ? (
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => onUpdateQty(item.id, cartQty - 1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyText}>{cartQty}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => onUpdateQty(item.id, cartQty + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() =>
                onAdd({
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
});

export default function CategorySlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addItem, updateQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  const { location, isHydrated } = useLocation();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!slug) return;
    try {
      setError(null);
      if (!isRefresh) setLoading(true);

      const categoryData = await getCategoryBySlug(slug);
      if (!categoryData) {
        setCategory(null);
        setProducts([]);
        return;
      }
      const loc = location;
      const productsData = await getProductsByCategory(
        categoryData.name,
        loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
      );

      setCategory(categoryData);
      setProducts(productsData);
    } catch (err) {
      console.error("Failed to load category:", err);
      setError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug, location]);

  useEffect(() => {
    if (!isHydrated) return;
    const task = InteractionManager.runAfterInteractions(() => {
      fetchData();
    });
    return () => task.cancel();
  }, [isHydrated, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const isEmpty = !loading && products.length === 0;

  // Memoized render callback — stable reference across re-renders so FlashList
  // doesn't recreate every cell when unrelated state (e.g. loading) changes.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ServiceProduct>) => (
      <ProductCard
        item={item}
        cartQty={cartItemsByProductId.get(item.id)?.quantity ?? 0}
        onAdd={addItem}
        onUpdateQty={updateQty}
      />
    ),
    [cartItemsByProductId, addItem, updateQty],
  );

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
        <FlashList
          data={products}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={3}
          contentContainerStyle={styles.list}
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
