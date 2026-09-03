import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Image } from "expo-image";

import { BackButton, EmptyState, Screen, ScreenHeader, Skeleton } from "../../components/ui";
import { C } from "../../constants/colors";
import { opacity, shadow } from "../../constants/ui";
import { getCategoryBySlug, type Category } from "../../lib/categoryService";
import { useCart, useCartItemMap } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { cdnImage } from "../../lib/imageUrl";
import { logError } from "../../lib/logError";
import { getProductsByCategory, type Product as ServiceProduct } from "../../lib/productService";
import { getNearbyProductFilter } from "../../lib/storeService";
import StarRating from "../../components/StarRating";

const FALLBACK_COLORS = [
  "#FF6B6B", "#51CF66", "#FFD43B", "#845EF7",
  "#339AF0", "#FAB005", "#E599F7", "#74C0FC"
];

const FALLBACK_ICONS = [
  "apple", "leaf", "cow", "cookie",
  "cup", "sack", "face-woman-shimmer", "home-outline"
];

// Extra reach for the ADD button so the effective target clears 44pt.
const ADD_HIT_SLOP = { top: 4, bottom: 4 };
const SKELETON_CARDS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

type ProductCardProps = {
  item: ServiceProduct;
  cartQty: number;
  onAdd: (product: Omit<import("../../context/CartContext").CartItem, "quantity">) => void;
  onUpdateQty: (productId: string, delta: number) => void;
};

const ProductCard = React.memo(function ProductCard({ item, cartQty, onAdd, onUpdateQty }: ProductCardProps) {
  const hasDiscount = item.original_price != null && item.original_price > item.price;
  const discountPct = hasDiscount
    ? Math.round(((item.original_price! - item.price) / item.original_price!) * 100)
    : 0;

  return (
    <View style={[styles.card, !item.in_stock && styles.cardOutOfStock]}>
      <TouchableOpacity
        activeOpacity={opacity.pressCard}
        onPress={() => router.push(`../product/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={item.name}
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
          <Text style={styles.unit} numberOfLines={1}>{item.unit}</Text>
        </View>

        <View style={styles.ratingWrap}>
          <StarRating rating={item.avgRating ?? 0} reviewCount={item.reviewCount} />
        </View>

        {item.in_stock ? (
          cartQty > 0 ? (
            <View style={styles.qtyRow}>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => onUpdateQty(item.id, -1)}
                hitSlop={6}
                activeOpacity={opacity.pressIcon}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
              >
                <MaterialCommunityIcons name="minus" size={16} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.qtyText}>{cartQty}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => onUpdateQty(item.id, 1)}
                hitSlop={6}
                activeOpacity={opacity.pressIcon}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
              >
                <MaterialCommunityIcons name="plus" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addBtn}
              hitSlop={ADD_HIT_SLOP}
              activeOpacity={opacity.pressCta}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name}`}
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

  const { addItem, incrementQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  const { location, isHydrated } = useLocation();

  // Discards a slower-resolving response from a previously-viewed category —
  // without this, opening category A then quickly navigating to category B
  // could let A's response land after B's and show A's data under B's route.
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!slug) return;
    const myId = ++requestIdRef.current;
    try {
      setError(null);
      if (!isRefresh) setLoading(true);

      const categoryData = await getCategoryBySlug(slug);
      if (myId !== requestIdRef.current) return;
      if (!categoryData) {
        setCategory(null);
        setProducts([]);
        return;
      }
      let nearbyIds: Set<string> | undefined;
      if (location) {
        const filter = await getNearbyProductFilter(location.latitude, location.longitude);
        if (myId !== requestIdRef.current) return;
        nearbyIds = filter?.productIds;
      } else {
        // No location yet — the 0-4 km radius filter can't run without
        // coordinates. Show nothing rather than falling back to every
        // active store's catalog platform-wide, which would defeat the
        // radius restriction. See bug_fixes doc, 2026-09-03.
        nearbyIds = new Set();
      }
      const productsData = await getProductsByCategory(categoryData.name, { nearbyIds });
      if (myId !== requestIdRef.current) return;

      setCategory(categoryData);
      setProducts(productsData);
    } catch (err) {
      if (myId !== requestIdRef.current) return;
      logError("Load category", err);
      setError("Failed to load products");
    } finally {
      if (myId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
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
        onUpdateQty={incrementQty}
      />
    ),
    [cartItemsByProductId, addItem, incrementQty],
  );

  if (!category && !loading) {
    return (
      <Screen>
        <ScreenHeader title="Category" />
        <EmptyState fill iconWrap icon="tag-off-outline" title="Category not found" />
      </Screen>
    );
  }

  const categoryColor = category?.color || FALLBACK_COLORS[0];
  const categoryIcon = category?.icon || FALLBACK_ICONS[0];

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton />

        <View style={styles.headerTitleWrap}>
          {category?.image_url ? (
            <Image
              source={{ uri: cdnImage(category.image_url, 48) }}
              style={styles.headerImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={120}
            />
          ) : (
            <MaterialCommunityIcons
              name={categoryIcon as any}
              size={20}
              color={categoryColor}
            />
          )}
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {category?.name || "Category"}
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View
          style={styles.skeletonGrid}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading products..."
        >
          {SKELETON_CARDS.map((i) => (
            <View key={i} style={styles.card}>
              <View style={styles.image} />
              <View style={styles.cardBody}>
                <Skeleton width="90%" height={12} color={C.border} />
                <Skeleton width="60%" height={12} color={C.border} style={styles.skeletonGap} />
                <Skeleton width="45%" height={14} color={C.border} style={styles.skeletonGap} />
                <Skeleton width="100%" height={40} radius={10} color={C.bgSoft} style={styles.skeletonBtn} />
              </View>
            </View>
          ))}
        </View>
      ) : error ? (
        <EmptyState
          fill
          icon="alert-circle-outline"
          iconSize={48}
          iconColor={C.danger}
          title={error}
          action={{ label: "Retry", onPress: () => fetchData() }}
        />
      ) : isEmpty ? (
        <EmptyState fill iconWrap icon="package-variant-closed-remove" title="No products available" />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 8,
  },
  headerTitle: { color: C.text, fontSize: 18, fontFamily: "PlusJakartaSans_800ExtraBold", flexShrink: 1 },
  headerImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  headerSpacer: { width: 38 },

  list: {
    padding: 16,
    paddingBottom: 120,
  },

  // Loading skeleton — mirrors the 3-column grid (list padding + 32% cards)
  skeletonGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: 16,
    overflow: "hidden",
  },
  skeletonGap: { marginTop: 6 },
  skeletonBtn: { marginTop: 8 },

  card: {
    width: "32%",
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    ...shadow.card,
    marginBottom: 8,
  },

  cardOutOfStock: {
    opacity: 0.65,
  },

  cardBody: {
    padding: 10,
  },

  image: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: C.bgSoft,
  },

  imagePlaceholder: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  discountBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: C.deal, // deal accent, not error-red — discounts are good news
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },

  discountText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: "#fff",
    fontSize: 11,
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

  outOfStockText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: "#fff",
    fontSize: 12,
    letterSpacing: 0.5,
  },

  name: { fontFamily: "PlusJakartaSans_600SemiBold",
    color: C.text,
    fontSize: 12,
    lineHeight: 16,
    minHeight: 32,
    marginBottom: 6,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginBottom: 6,
  },

  price: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.primary,
    fontSize: 14,
  },

  originalPrice: { fontFamily: "PlusJakartaSans_500Medium",
    color: C.textLight,
    fontSize: 11,
    textDecorationLine: "line-through",
  },

  unit: { fontFamily: "PlusJakartaSans_500Medium",
    color: C.textSub,
    fontSize: 11,
    flexShrink: 1,
  },

  ratingWrap: {
    marginBottom: 6,
  },

  addBtn: {
    alignSelf: "stretch",
    backgroundColor: C.primary,
    minHeight: 40,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  addText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: "#fff",
    fontSize: 13,
    letterSpacing: 0.8,
  },

  soldOutBtn: {
    borderRadius: 10,
    minHeight: 40,
    paddingVertical: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: C.border,
  },

  soldOutText: { fontFamily: "PlusJakartaSans_700Bold",
    color: C.textSub,
    fontSize: 13,
  },

  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  qtyBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.primary,
  },

  qtyText: { fontFamily: "PlusJakartaSans_700Bold",
    color: C.primary,
    fontSize: 14,
    minWidth: 20,
    textAlign: "center",
  },
});
