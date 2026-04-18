import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as ExpoLocation from "expo-location";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  InteractionManager,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import ProfileMenu from "../../components/ProfileMenu";
import { useAuth } from "../../context/AuthContext";
import { useCartItemMap, useCart, type CartItem } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { getUserOrders } from "../../lib/orderService";
import {
  getCountForCategoryName,
  getProductsForCategoryName,
  isHomeCatalogCacheFresh,
  loadMasterCatalog,
  readHomeCatalogCache,
  writeHomeCatalogCache,
  type Product,
} from "../../lib/productService";

// ─── Design tokens ──────────────────────────────────────────────────────────
const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  greenGlow: "rgba(45,122,79,0.18)",
  cream: "#FAFAF7",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  white: "#FFFFFF",
  red: "#D94F3D",
  redLight: "#FCE9E7",
  card: "#FFFFFF",
  cardBorder: "rgba(60,47,30,0.08)",
  shadow: "rgba(45,122,79,0.12)",
  shadowDark: "rgba(0,0,0,0.10)",
  badge: "#FF6B35",
  imageBg: "#F7F5EF",
  skeletonLo: "#EFEDE7",
  skeletonHi: "#F7F5EF",
};

const FALLBACK_ICONS = [
  "apple",
  "leaf",
  "cow",
  "cookie",
  "cup",
  "sack",
  "food-apple-outline",
  "basket-outline",
];

/** Products shown in each category section before "See all". */
const SECTION_VISIBLE_PRODUCTS = 6;

/** A tiny 1×1 transparent pixel used as the image placeholder while the real product loads. */
const PLACEHOLDER_BLURHASH = "L6PZfSi_.AyE_3t7t7R**0o#DgR4";

// ─── Product Card (Blinkit / Instamart style) ───────────────────────────────
type ProductCardProps = {
  p: Product;
  cartItem: CartItem | undefined;
  onAdd: (p: Product) => void;
  onUpdateQty: (p: Product, qty: number) => void;
  containerStyle?: StyleProp<ViewStyle>;
};

const ProductCard = React.memo(
  function ProductCard({
    p,
    cartItem,
    onAdd,
    onUpdateQty,
    containerStyle,
  }: ProductCardProps) {
    const scale = useSharedValue(1);
    const hasDiscount = p.original_price != null && p.original_price > p.price;
    const discountPct = hasDiscount
      ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
      : 0;

    const animStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    const handlePressIn = useCallback(() => {
      scale.value = withSpring(0.97, { damping: 18, stiffness: 280 });
    }, [scale]);
    const handlePressOut = useCallback(() => {
      scale.value = withSpring(1, { damping: 18, stiffness: 280 });
    }, [scale]);
    const handlePress = useCallback(() => {
      router.push(`../product/${p.id}`);
    }, [p.id]);
    const handleAdd = useCallback(() => onAdd(p), [onAdd, p]);
    const handleMinus = useCallback(
      () => onUpdateQty(p, (cartItem?.quantity ?? 1) - 1),
      [onUpdateQty, p, cartItem?.quantity],
    );
    const handlePlus = useCallback(
      () => onUpdateQty(p, (cartItem?.quantity ?? 0) + 1),
      [onUpdateQty, p, cartItem?.quantity],
    );

    return (
      <View style={[styles.cardOuter, containerStyle]}>
        <Animated.View
          style={[animStyle, styles.card, !p.in_stock && styles.cardOutOfStock]}
        >
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={handlePress}
          >
            <View style={styles.imageWrap}>
              {p.image_url ? (
                <ExpoImage
                  source={{ uri: p.image_url }}
                  style={styles.image}
                  contentFit="contain"
                  transition={120}
                  cachePolicy="memory-disk"
                  placeholder={PLACEHOLDER_BLURHASH}
                  recyclingKey={p.id}
                  priority="normal"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <MaterialCommunityIcons
                    name="image-off-outline"
                    size={28}
                    color={T.barkLight}
                  />
                </View>
              )}

              {hasDiscount && (
                <View style={styles.discountFlag}>
                  <Text style={styles.discountFlagText}>{discountPct}%</Text>
                  <Text style={styles.discountFlagOff}>OFF</Text>
                </View>
              )}

              {!p.in_stock && (
                <View style={styles.outOfStockOverlay}>
                  <Text style={styles.outOfStockText}>Sold Out</Text>
                </View>
              )}
            </View>

            <View style={styles.cardBody}>
              {p.unit ? (
                <View style={styles.unitPill}>
                  <MaterialCommunityIcons
                    name="clock-fast"
                    size={9}
                    color={T.green}
                  />
                  <Text style={styles.unitPillText} numberOfLines={1}>
                    {p.unit}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.productName} numberOfLines={2}>
                {p.name}
              </Text>

              <View style={styles.priceAddRow}>
                <View style={styles.priceCol}>
                  <Text style={styles.priceValue}>₹{p.price}</Text>
                  {hasDiscount && (
                    <Text style={styles.originalPrice}>₹{p.original_price}</Text>
                  )}
                </View>

                {p.in_stock ? (
                  cartItem ? (
                    <View style={styles.qtyBox}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={handleMinus}
                        activeOpacity={0.75}
                        hitSlop={6}
                      >
                        <MaterialCommunityIcons
                          name="minus"
                          size={12}
                          color={T.white}
                        />
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={handlePlus}
                        activeOpacity={0.75}
                        hitSlop={6}
                      >
                        <MaterialCommunityIcons
                          name="plus"
                          size={12}
                          color={T.white}
                        />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      activeOpacity={0.82}
                      onPress={handleAdd}
                    >
                      <Text style={styles.addText}>ADD</Text>
                    </TouchableOpacity>
                  )
                ) : (
                  <View style={styles.soldOutBtn}>
                    <Text style={styles.soldOutText}>Out</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    );
  },
  // Custom equality: a card only needs to re-render when *its* product/cart entry changes —
  // not when unrelated products or cart items mutate.
  (prev, next) =>
    prev.p === next.p &&
    prev.cartItem === next.cartItem &&
    prev.onAdd === next.onAdd &&
    prev.onUpdateQty === next.onUpdateQty,
);

// ─── Category Tile (for the "Shop by Category" visual grid) ─────────────────
const CategoryTile = React.memo(function CategoryTile({
  item,
  index,
  onPress,
}: {
  item: Category;
  index: number;
  onPress: () => void;
}) {
  const icon = item.icon || FALLBACK_ICONS[index % FALLBACK_ICONS.length];
  return (
    <TouchableOpacity
      style={styles.catTile}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <View style={styles.catTileIconWrap}>
        {item.image_url ? (
          <ExpoImage
            source={{ uri: item.image_url }}
            style={styles.catTileImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={100}
          />
        ) : (
          <MaterialCommunityIcons
            name={icon as any}
            size={30}
            color={T.green}
          />
        )}
      </View>
      <Text style={styles.catTileLabel} numberOfLines={2}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );
});

// ─── Section header ──────────────────────────────────────────────────────────
const SectionHeader = React.memo(function SectionHeader({
  title,
  subtitle,
  onSeeAll,
}: {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.sectionSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onSeeAll && (
        <TouchableOpacity
          onPress={onSeeAll}
          activeOpacity={0.7}
          style={styles.seeAllBtn}
          hitSlop={6}
        >
          <Text style={styles.seeAllText}>See all</Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={16}
            color={T.green}
          />
        </TouchableOpacity>
      )}
    </View>
  );
});

// ─── Category section: 6-product grid + See-all ─────────────────────────────
type CategorySectionProps = {
  category: Category;
  products: Product[];
  cartItemsByProductId: Map<string, CartItem>;
  onAdd: (p: Product) => void;
  onUpdateQty: (p: Product, qty: number) => void;
  onSeeAll: (name: string) => void;
};

const CategorySection = React.memo(
  function CategorySection({
    category,
    products,
    cartItemsByProductId,
    onAdd,
    onUpdateQty,
    onSeeAll,
  }: CategorySectionProps) {
    const visible = useMemo(
      () => products.slice(0, SECTION_VISIBLE_PRODUCTS),
      [products],
    );
    const hasMore = products.length > SECTION_VISIBLE_PRODUCTS;
    const handleSeeAll = useCallback(
      () => onSeeAll(category.name),
      [category.name, onSeeAll],
    );

    if (!products.length) return null;

    return (
      <View style={styles.section}>
        <SectionHeader
          title={category.name}
          subtitle="Top picks"
          onSeeAll={hasMore ? handleSeeAll : undefined}
        />
        <View style={styles.gridWrap}>
          {visible.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              cartItem={cartItemsByProductId.get(p.id)}
              onAdd={onAdd}
              onUpdateQty={onUpdateQty}
            />
          ))}
        </View>
        {hasMore && (
          <TouchableOpacity
            style={styles.seeAllBar}
            onPress={handleSeeAll}
            activeOpacity={0.85}
          >
            <Text style={styles.seeAllBarText}>
              See all products in {category.name}
            </Text>
            <MaterialCommunityIcons
              name="arrow-right"
              size={16}
              color={T.green}
            />
          </TouchableOpacity>
        )}
      </View>
    );
  },
);

// ─── Frequently-bought horizontal section ────────────────────────────────────
const FrequentlyBoughtSection = React.memo(function FrequentlyBoughtSection({
  title,
  products,
  cartItemsByProductId,
  onAdd,
  onUpdateQty,
}: {
  title: string;
  products: Product[];
  cartItemsByProductId: Map<string, CartItem>;
  onAdd: (p: Product) => void;
  onUpdateQty: (p: Product, qty: number) => void;
}) {
  const data = useMemo(() => products.slice(0, 10), [products]);
  const renderItem = useCallback(
    ({ item: p }: { item: Product }) => (
      <ProductCard
        p={p}
        cartItem={cartItemsByProductId.get(p.id)}
        onAdd={onAdd}
        onUpdateQty={onUpdateQty}
        containerStyle={styles.cardOuterHorizontal}
      />
    ),
    [cartItemsByProductId, onAdd, onUpdateQty],
  );

  if (!data.length) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={title} subtitle="Quick reorder" />
      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalListContent}
        renderItem={renderItem}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
      />
    </View>
  );
});

const keyExtractor = (p: Product) => p.id;

// ─── Skeleton card (shown during cold boot instead of blank screen) ─────────
const SkeletonCard = React.memo(function SkeletonCard() {
  return (
    <View style={[styles.cardOuter, { opacity: 0.92 }]}>
      <View style={[styles.card, { borderColor: "transparent" }]}>
        <View style={[styles.imageWrap, { backgroundColor: T.skeletonHi }]}>
          <View style={{ height: 96 }} />
        </View>
        <View style={styles.cardBody}>
          <View style={[styles.skeletonLine, { width: "40%", height: 10 }]} />
          <View
            style={[
              styles.skeletonLine,
              { width: "90%", marginTop: 8, height: 10 },
            ]}
          />
          <View
            style={[
              styles.skeletonLine,
              { width: "70%", marginTop: 5, height: 10 },
            ]}
          />
          <View style={styles.priceAddRow}>
            <View
              style={[styles.skeletonLine, { width: "30%", height: 14 }]}
            />
            <View
              style={[
                styles.skeletonLine,
                { width: 46, height: 24, borderRadius: 8 },
              ]}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

function SkeletonHomeFeed() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <View style={[styles.skeletonLine, { width: 120, height: 16 }]} />
          <View
            style={[
              styles.skeletonLine,
              { width: 80, height: 10, marginTop: 6 },
            ]}
          />
        </View>
      </View>
      <View style={styles.gridWrap}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsByCategory, setProductsByCategory] = useState<
    Record<string, Product[]>
  >({});
  const [userTopProductIds, setUserTopProductIds] = useState<string[]>([]);

  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const [locationFetching, setLocationFetching] = useState(false);

  const { location, isHydrated } = useLocation();
  const { addItem, updateQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  const totalQty = useMemo(() => {
    let n = 0;
    for (const [, v] of cartItemsByProductId) n += v.quantity;
    return n;
  }, [cartItemsByProductId]);
  const hasCart = cartItemsByProductId.size > 0;
  const { userId } = useAuth();

  const scrollRef = useRef<ScrollView | null>(null);
  const didInitialFetch = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const derivedCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(productsByCategory)) {
      counts[k.toLowerCase().trim()] = v.length;
    }
    return counts;
  }, [productsByCategory]);

  /** Fetches fresh data and updates state + cache. */
  const fetchFresh = useCallback(async () => {
    try {
      const [categoriesData, catalog] = await Promise.all([
        getAllCategories(),
        loadMasterCatalog(),
      ]);
      setCategories(categoriesData);
      setProductsByCategory(catalog.productsByCategory);
      // Defer the AsyncStorage write so it never blocks the render thread.
      InteractionManager.runAfterInteractions(() => {
        writeHomeCatalogCache({
          products: catalog.products,
          productsByCategory: catalog.productsByCategory,
          categories: categoriesData,
        });
      });
    } catch (error) {
      console.error("Failed to load home:", error);
    }
  }, []);

  /** Cold start: paint from cache immediately, refresh only if cache is stale. */
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;

    let cancelled = false;
    (async () => {
      const cached = await readHomeCatalogCache();
      if (!cancelled && cached) {
        setCategories(cached.categories);
        setProductsByCategory(cached.productsByCategory);
        setLoading(false);
      }

      if (!isHydrated) return;

      // Skip background refresh if cache is fresh (<5 min). This stops the app from doing
      // a full-catalog DB scan on every mount — the #1 source of perceived "constant
      // refreshing" slowness.
      if (isHomeCatalogCacheFresh(cached)) return;

      InteractionManager.runAfterInteractions(async () => {
        if (cancelled) return;
        await fetchFresh();
        if (!cancelled) setLoading(false);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, fetchFresh]);

  // ── Live reverse-geocode from device GPS ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLocationFetching(true);
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        if (cancelled) return;
        const [result] = await ExpoLocation.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (cancelled) return;
        if (result) {
          const parts = [result.name, result.street, result.district, result.city]
            .filter(Boolean);
          setLiveAddress(
            parts.slice(0, 2).join(", ") || result.city || "Your location",
          );
        }
      } catch {
        // silently fall back to context location
      } finally {
        if (!cancelled) setLocationFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Build user's "frequently bought" list from past orders ────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const orders = await getUserOrders(userId);
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const order of orders) {
          for (const it of order.items || []) {
            if (!it.product_id) continue;
            counts[it.product_id] =
              (counts[it.product_id] || 0) + (it.quantity || 1);
          }
        }
        const ids = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .map(([id]) => id);
        setUserTopProductIds(ids);
      } catch {
        /* fall back silently to "bought by others" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFresh();
    setRefreshing(false);
  }, [fetchFresh]);

  const categoriesWithProducts = useMemo(
    () =>
      categories.filter(
        (c) => getCountForCategoryName(derivedCategoryCounts, c.name) > 0,
      ),
    [categories, derivedCategoryCounts],
  );

  useEffect(() => {
    if (activeCategory === "All") return;
    const stillValid = categoriesWithProducts.some(
      (c) => c.name === activeCategory,
    );
    if (!stillValid) setActiveCategory("All");
  }, [activeCategory, categoriesWithProducts]);

  const handleSelectCategory = useCallback(
    (name: string) => {
      if (name === activeCategory) return;
      setActiveCategory(name);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ y: 0, animated: true }),
      );
    },
    [activeCategory],
  );

  const filteredProducts = useMemo(() => {
    if (activeCategory === "All") return [] as Product[];
    return getProductsForCategoryName(productsByCategory, activeCategory);
  }, [activeCategory, productsByCategory]);

  /** Frequently bought section: personalized first, fall back to newest products. */
  const frequentlyBought = useMemo(() => {
    const flat: Product[] = [];
    for (const arr of Object.values(productsByCategory)) flat.push(...arr);
    if (!flat.length) return { title: "", products: [] as Product[] };

    if (userTopProductIds.length > 0) {
      const byId = new Map<string, Product>();
      for (const p of flat) byId.set(p.id, p);
      const personalized: Product[] = [];
      for (const id of userTopProductIds) {
        const p = byId.get(id);
        if (p) personalized.push(p);
        if (personalized.length >= 10) break;
      }
      if (personalized.length > 0) {
        return { title: "Frequently bought", products: personalized };
      }
    }

    // Fallback: most recently added, in-stock first.
    const popular = [...flat]
      .sort((a, b) => {
        if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      })
      .slice(0, 10);
    return {
      title: "Frequently bought by other customers",
      products: popular,
    };
  }, [productsByCategory, userTopProductIds]);

  const profileScale = useSharedValue(1);
  const profileAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: profileScale.value }],
  }));
  const handleProfilePressIn = useCallback(() => {
    profileScale.value = withSpring(0.93, { damping: 16, stiffness: 260 });
  }, [profileScale]);
  const handleProfilePressOut = useCallback(() => {
    profileScale.value = withSpring(1, { damping: 16, stiffness: 260 });
  }, [profileScale]);

  const handleAdd = useCallback(
    (p: Product) =>
      addItem({
        product_id: p.id,
        name: p.name,
        price: p.price,
        unit: p.unit,
        image_url: p.image_url,
      }),
    [addItem],
  );

  const handleUpdateQty = useCallback(
    (p: Product, qty: number) => updateQty(p.id, qty),
    [updateQty],
  );

  // ── Loading (skeleton, not spinner) ──────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {renderAddressBar({
          liveAddress,
          location,
          locationFetching,
          profileAnimatedStyle,
          onPressIn: handleProfilePressIn,
          onPressOut: handleProfilePressOut,
          onProfilePress: () => setShowProfileMenu(true),
        })}
        <View style={styles.stickyWrap}>
          <View style={[styles.searchBar, { backgroundColor: T.skeletonHi }]}>
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                backgroundColor: T.skeletonLo,
              }}
            />
            <View
              style={[styles.skeletonLine, { width: "60%", height: 12 }]}
            />
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <SkeletonHomeFeed />
          <SkeletonHomeFeed />
        </ScrollView>
        <ProfileMenu
          visible={showProfileMenu}
          onClose={() => setShowProfileMenu(false)}
        />
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.green}
            colors={[T.green]}
          />
        }
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={Platform.OS === "android"}
        overScrollMode="never"
      >
        {renderAddressBar({
          liveAddress,
          location,
          locationFetching,
          profileAnimatedStyle,
          onPressIn: handleProfilePressIn,
          onPressOut: handleProfilePressOut,
          onProfilePress: () => setShowProfileMenu(true),
        })}

        <View style={styles.stickyWrap}>
          <TouchableOpacity
            style={styles.searchBar}
            activeOpacity={0.88}
            onPress={() => router.push("../support/search")}
          >
            <View style={styles.searchIconWrap}>
              <MaterialCommunityIcons
                name="magnify"
                size={19}
                color={T.green}
              />
            </View>
            <Text style={styles.searchPlaceholder}>
              Search groceries, dairy, snacks…
            </Text>
          </TouchableOpacity>
        </View>

        {activeCategory === "All" ? (
          <>
            <FrequentlyBoughtSection
              title={frequentlyBought.title}
              products={frequentlyBought.products}
              cartItemsByProductId={cartItemsByProductId}
              onAdd={handleAdd}
              onUpdateQty={handleUpdateQty}
            />

            {categoriesWithProducts.length > 0 && (
              <View style={styles.section}>
                <SectionHeader
                  title="Shop by category"
                  subtitle="Everything you need"
                />
                <View style={styles.catTileGrid}>
                  {categoriesWithProducts.map((c, i) => (
                    <CategoryTile
                      key={c.id}
                      item={c}
                      index={i}
                      onPress={() => handleSelectCategory(c.name)}
                    />
                  ))}
                </View>
              </View>
            )}

            {categoriesWithProducts.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name={!location ? "store-off-outline" : "package-variant-closed"}
                    size={40}
                    color={T.green}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {!location ? "Set your location" : "No products found"}
                </Text>
                <Text style={styles.emptyText}>
                  {!location
                    ? "We'll show you what's fresh and available nearby."
                    : "No products available near you at the moment."}
                </Text>
                {!location && (
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => router.push("/location")}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={[T.greenLight, T.green]}
                      style={styles.emptyBtnGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <MaterialCommunityIcons
                        name="map-marker-outline"
                        size={16}
                        color={T.white}
                      />
                      <Text style={styles.emptyBtnText}>Choose Location</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              categoriesWithProducts.map((c) => (
                <CategorySection
                  key={c.id}
                  category={c}
                  products={getProductsForCategoryName(
                    productsByCategory,
                    c.name,
                  )}
                  cartItemsByProductId={cartItemsByProductId}
                  onAdd={handleAdd}
                  onUpdateQty={handleUpdateQty}
                  onSeeAll={handleSelectCategory}
                />
              ))
            )}

            <View style={styles.endStamp}>
              <MaterialCommunityIcons name="leaf" size={14} color={T.green} />
              <Text style={styles.endStampText}>
                That&apos;s everything fresh near you
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <SectionHeader
              title={activeCategory}
              subtitle="Fresh picks near you"
              onSeeAll={() => handleSelectCategory("All")}
            />
            {filteredProducts.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name="package-variant-closed"
                    size={40}
                    color={T.green}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  No products in {activeCategory}
                </Text>
                <Text style={styles.emptyText}>
                  Check back soon or explore other categories.
                </Text>
              </View>
            ) : (
              <View style={styles.gridWrap}>
                {filteredProducts.map((p) => (
                  <ProductCard
                    key={p.id}
                    p={p}
                    cartItem={cartItemsByProductId.get(p.id)}
                    onAdd={handleAdd}
                    onUpdateQty={handleUpdateQty}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Cart CTA pill (centered, compact) ──────────────────────────── */}
      {hasCart && (
        <Animated.View
          entering={FadeInUp.duration(340).springify()}
          style={styles.cartBar}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => router.push("/support/checkout")}
            style={({ pressed }) => [
              styles.cartPill,
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.95 },
            ]}
          >
            <LinearGradient
              colors={[T.greenLight, T.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cartPillGradient}
            >
              <View style={styles.cartQtyBubble}>
                <Text style={styles.cartQtyText}>{totalQty}</Text>
              </View>
              <Text style={styles.cartPillLabel}>
                {totalQty === 1 ? "item in cart" : "items in cart"}
              </Text>
              <View style={styles.cartArrowWrap}>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={16}
                  color={T.green}
                />
              </View>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      )}

      <ProfileMenu
        visible={showProfileMenu}
        onClose={() => setShowProfileMenu(false)}
      />
    </SafeAreaView>
  );
}

// ─── Shared address-bar renderer (keeps the main component tidy) ────────────
function renderAddressBar({
  liveAddress,
  location,
  locationFetching,
  profileAnimatedStyle,
  onPressIn,
  onPressOut,
  onProfilePress,
}: {
  liveAddress: string | null;
  location: { label?: string; address?: string } | null | undefined;
  locationFetching: boolean;
  profileAnimatedStyle: any;
  onPressIn: () => void;
  onPressOut: () => void;
  onProfilePress: () => void;
}) {
  return (
    <View style={styles.addressBarBg}>
      <LinearGradient
        colors={[T.greenXLight, T.cream]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={styles.appBar}>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => router.push("/location")}
        >
          <View style={styles.deliveryLabelRow}>
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={14}
              color={T.green}
            />
            <Text style={styles.deliveryLabelText}>Delivery to</Text>
            {locationFetching && (
              <ActivityIndicator
                size="small"
                color={T.green}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
          <View style={styles.locationInlineRow}>
            <Text style={styles.deliveryAddressText} numberOfLines={1}>
              {liveAddress
                ? liveAddress
                : location
                  ? location.address
                    ? `${location.label ? location.label + " · " : ""}${location.address}`
                    : location.label || "Your location"
                  : "Set delivery address"}
            </Text>
            <MaterialCommunityIcons
              name="chevron-down"
              size={16}
              color={T.bark}
            />
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.walletBtn} activeOpacity={0.8}>
            <LinearGradient
              colors={[T.greenXLight, "#d4edda"]}
              style={StyleSheet.absoluteFillObject}
            />
            <MaterialCommunityIcons
              name="wallet-outline"
              size={16}
              color={T.green}
            />
            <Text style={styles.walletText}>₹0</Text>
          </TouchableOpacity>

          <Animated.View style={profileAnimatedStyle}>
            <Pressable
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              onPress={onProfilePress}
              style={styles.profileBtn}
            >
              <LinearGradient
                colors={[T.greenLight, T.green]}
                style={styles.profileAvatar}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <MaterialCommunityIcons
                  name="account-outline"
                  size={20}
                  color={T.white}
                />
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.cream },

  // ── Scroll container ─────────────────────────────────────────────────────
  scrollContent: { paddingBottom: 150 },

  // ── Skeleton helpers ─────────────────────────────────────────────────────
  skeletonLine: {
    backgroundColor: T.skeletonLo,
    borderRadius: 6,
  },

  // ── Address bar block (scrolls away) ─────────────────────────────────────
  addressBarBg: { backgroundColor: T.cream },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 12,
  },
  deliveryLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  deliveryLabelText: {
    fontSize: 12,
    color: T.green,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  deliveryAddressText: {
    fontSize: 16,
    fontWeight: "800",
    color: T.bark,
    letterSpacing: -0.3,
    flex: 1,
  },
  locationInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "95%",
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  walletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.18)",
    backgroundColor: T.greenXLight,
  },
  walletText: { fontSize: 13, fontWeight: "800", color: T.green },
  profileBtn: { padding: 3 },
  profileAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },

  // ── Sticky search ────────────────────────────────────────────────────────
  stickyWrap: {
    backgroundColor: T.cream,
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 2,
  },

  // ── Search bar ────────────────────────────────────────────────────────────
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 3,
  },
  searchIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  searchPlaceholder: {
    color: T.barkLight,
    fontSize: 14,
    flex: 1,
    fontWeight: "500",
  },

  // ── Section (generic wrapper) ────────────────────────────────────────────
  section: { marginTop: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    marginBottom: 10,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    color: T.bark,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11.5,
    color: T.barkLight,
    fontWeight: "500",
    marginTop: 1,
  },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: T.greenXLight,
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.18)",
  },
  seeAllText: {
    fontSize: 12,
    color: T.green,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  horizontalListContent: { paddingHorizontal: 14, gap: 10 },

  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 14,
    justifyContent: "space-between",
    rowGap: 12,
  },

  seeAllBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 14,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.25)",
    borderStyle: "dashed",
  },
  seeAllBarText: {
    color: T.green,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  // ── Shop-by-category tile grid ───────────────────────────────────────────
  catTileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    justifyContent: "flex-start",
  },
  catTile: {
    width: "25%",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 10,
    gap: 6,
  },
  catTileIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.15)",
    overflow: "hidden",
  },
  catTileImg: { width: "100%", height: "100%" },
  catTileLabel: {
    fontSize: 11,
    color: T.bark,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.1,
    lineHeight: 14,
  },

  endStamp: {
    marginTop: 28,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: T.greenXLight,
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.18)",
  },
  endStampText: {
    fontSize: 12,
    color: T.green,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // ── Product card ──────────────────────────────────────────────────────────
  cardOuter: { width: "31.8%" },
  cardOuterHorizontal: { width: 132 },
  card: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.cardBorder,
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 2,
  },
  cardOutOfStock: { opacity: 0.62 },
  imageWrap: {
    position: "relative",
    backgroundColor: T.imageBg,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  image: { width: "100%", height: 96 },
  imagePlaceholder: {
    width: "100%",
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },

  discountFlag: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: T.green,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  discountFlagText: {
    color: T.white,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 11,
    letterSpacing: 0.2,
  },
  discountFlagOff: {
    color: T.white,
    fontSize: 7.5,
    fontWeight: "800",
    lineHeight: 9,
    letterSpacing: 0.8,
  },

  outOfStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: T.white,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  cardBody: { padding: 8, paddingTop: 7 },
  unitPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.greenXLight,
    marginBottom: 5,
  },
  unitPillText: {
    color: T.green,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  productName: {
    fontSize: 11.5,
    color: T.bark,
    lineHeight: 14.5,
    fontWeight: "700",
    minHeight: 29,
    marginBottom: 6,
  },
  priceAddRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  priceCol: { flexShrink: 1 },
  priceValue: {
    color: T.bark,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.3,
    lineHeight: 15,
  },
  originalPrice: {
    color: T.barkLight,
    fontSize: 10,
    textDecorationLine: "line-through",
    fontWeight: "500",
    marginTop: 1,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.green,
    backgroundColor: T.greenXLight,
    minWidth: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: {
    fontSize: 11.5,
    color: T.green,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  soldOutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: T.sand,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
  },
  soldOutText: {
    color: T.barkLight,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: T.green,
    borderRadius: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minWidth: 68,
  },
  qtyBtn: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: T.green,
  },
  qtyValue: {
    color: T.white,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 14,
    textAlign: "center",
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  empty: {
    marginTop: 40,
    alignItems: "center",
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.15)",
  },
  emptyTitle: {
    color: T.bark,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 4,
    letterSpacing: -0.2,
  },
  emptyText: {
    color: T.barkLight,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    fontWeight: "500",
  },
  emptyBtn: {
    marginTop: 10,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  emptyBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 26,
  },
  emptyBtnText: { color: T.white, fontWeight: "800", fontSize: 14 },

  // ── Cart pill ─────────────────────────────────────────────────────────────
  cartBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 110,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cartPill: {
    alignSelf: "center",
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 18,
    elevation: 14,
  },
  cartPillGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 9,
    gap: 10,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 999,
  },
  cartQtyBubble: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  cartQtyText: {
    color: T.green,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  cartPillLabel: {
    color: T.white,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  cartArrowWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
});
