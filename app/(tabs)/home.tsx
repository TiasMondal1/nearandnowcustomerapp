import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
    FlashList,
    type FlashListRef,
    type ListRenderItemInfo,
} from "@shopify/flash-list";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as ExpoLocation from "expo-location";
import { router, useFocusEffect } from "expo-router";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
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
import Animated, {
    FadeInUp,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import ProfileMenu from "../../components/ProfileMenu";
import { useAuth } from "../../context/AuthContext";
import { useCart, useCartItemMap, type CartItem } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { cdnImage } from "../../lib/imageUrl";
import { getUserOrders } from "../../lib/orderService";
import {
    getCountForCategoryName,
    getMemoryHomeCache,
    getProductsForCategoryName,
    isHomeCatalogCacheFresh,
    loadMasterCatalog,
    loadMasterCatalogFast,
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

/**
 * Module-level cache of the last reverse-geocoded "live address". When the
 * user navigates away from the home tab (e.g. into select-location and back)
 * expo-router may remount this screen, which previously re-fired the slow
 * GPS + reverse-geocode chain on every return and caused the home page to
 * briefly "hang" while permissions / GPS resolved. Caching here keeps the
 * address bar populated instantly across remounts — the fresh lookup still
 * runs in the background the first time per app launch.
 */
let __liveAddressCache: string | null = null;
let __liveAddressResolved = false;

/** Products shown in each category section before "See all". */
const SECTION_VISIBLE_PRODUCTS = 6;

/** Number of cards rendered per row in the home grid. */
const ROW_COUNT = 3;

/**
 * Typed discriminated-union of home-feed list items. FlashList virtualizes the
 * outer list, so off-screen sections / rows are unmounted from the native view
 * tree. This is the difference between scrolling 60+ images all at once (old
 * ScrollView) vs ~8 at a time (FlashList).
 */
type HomeListItem =
  | { kind: "search" }
  | { kind: "freqBought"; title: string; products: Product[] }
  | { kind: "catTileGrid"; categories: Category[] }
  | { kind: "sectionHeader"; title: string; subtitle?: string; onSeeAll?: () => void }
  | { kind: "productRow"; products: Product[]; rowKey: string }
  | { kind: "seeAllBar"; categoryName: string; onPress: () => void }
  | { kind: "endStamp" }
  | {
      kind: "empty";
      title: string;
      message: string;
      icon: keyof typeof MaterialCommunityIcons.glyphMap;
      cta?: { label: string; onPress: () => void };
    };


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
                  source={{ uri: cdnImage(p.image_url) }}
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
            source={{ uri: cdnImage(item.image_url) }}
            style={styles.catTileImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={100}
            recyclingKey={item.id}
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
  // Synchronous read of the prewarmed cache. If the splash-time prewarm has
  // populated `memoryHomeCache`, we hydrate state on the very first render —
  // the home screen paints with real content on frame 1 instead of frame 2+
  // (the difference between "cached UI is visible immediately" vs "blank
  // skeleton flashes for 60–200 ms before the cache finishes parsing").
  const initialCache = getMemoryHomeCache();

  const [loading, setLoading] = useState(!initialCache);
  const [categories, setCategories] = useState<Category[]>(
    initialCache?.categories ?? [],
  );
  const [productsByCategory, setProductsByCategory] = useState<
    Record<string, Product[]>
  >(initialCache?.productsByCategory ?? {});
  const [userTopProductIds, setUserTopProductIds] = useState<string[]>([]);

  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [liveAddress, setLiveAddress] = useState<string | null>(__liveAddressCache);
  const [locationFetching, setLocationFetching] = useState(false);

  const { location } = useLocation();
  const { addItem, updateQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  const totalQty = useMemo(() => {
    let n = 0;
    for (const [, v] of cartItemsByProductId) n += v.quantity;
    return n;
  }, [cartItemsByProductId]);
  const hasCart = cartItemsByProductId.size > 0;
  const { userId } = useAuth();

  const listRef = useRef<FlashListRef<HomeListItem> | null>(null);
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

  /**
   * Full background refresh — fetches the entire catalog and overwrites cache.
   * Used by pull-to-refresh and as the "fill" step after `fetchFreshFast`.
   */
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

  /**
   * Cold-start fast path — fetches only the top-500 most-popular products
   * (one round-trip, ~30–80 KB) so the home grid paints with real data in
   * ~120–400 ms instead of 1–5 s. The full catalog is then loaded in the
   * background so search / filter remain responsive.
   */
  const fetchFreshFast = useCallback(async () => {
    try {
      const [categoriesData, fastCatalog] = await Promise.all([
        getAllCategories(),
        loadMasterCatalogFast(500),
      ]);
      setCategories(categoriesData);
      setProductsByCategory(fastCatalog.productsByCategory);
      setLoading(false);
      // Background-fill: hydrate the rest of the catalog without blocking
      // the user. This is what powers fast category browsing later.
      InteractionManager.runAfterInteractions(() => {
        loadMasterCatalog()
          .then((full) => {
            setProductsByCategory(full.productsByCategory);
            writeHomeCatalogCache({
              products: full.products,
              productsByCategory: full.productsByCategory,
              categories: categoriesData,
            });
          })
          .catch(() => {});
      });
    } catch (error) {
      console.error("Failed to load home (fast):", error);
      // Fall back to the full fetch so the user still sees content eventually.
      await fetchFresh();
      setLoading(false);
    }
  }, [fetchFresh]);

  /**
   * Single boot effect — handles three cases:
   *   1. memory cache hit (set in initial state) → render is already done;
   *      kick off background refresh only if cache is stale.
   *   2. cold start, AsyncStorage cache exists → paint it ASAP, refresh in bg.
   *   3. cold start, no cache → run the *fast* network path so first paint
   *      happens in <500 ms instead of waiting on the full catalog fetch.
   *
   * Note: no dependency on LocationContext.isHydrated. The catalog is
   * location-independent, so blocking on hydration just adds 50–100 ms of
   * dead time on every cold start.
   */
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    let cancelled = false;

    (async () => {
      // Case 1: memory cache already used in initial state.
      if (initialCache) {
        if (!isHomeCatalogCacheFresh(initialCache)) {
          // Refresh after first paint settles.
          InteractionManager.runAfterInteractions(() => {
            if (!cancelled) fetchFresh();
          });
        }
        return;
      }

      // Case 2: AsyncStorage may still hold a cache the prewarm hasn't surfaced yet.
      const cached = await readHomeCatalogCache();
      if (cancelled) return;
      if (cached) {
        setCategories(cached.categories);
        setProductsByCategory(cached.productsByCategory);
        setLoading(false);
        if (!isHomeCatalogCacheFresh(cached)) {
          InteractionManager.runAfterInteractions(() => {
            if (!cancelled) fetchFresh();
          });
        }
        return;
      }

      // Case 3: no cache at all → fast network path.
      await fetchFreshFast();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live reverse-geocode from device GPS ──────────────────────────────────
  // Deferred past first paint: GPS + reverse-geocode is a 500–2000 ms call
  // chain that competes with the home catalog network request on the same
  // connection. By scheduling it via InteractionManager, the home grid paints
  // first and the live address fills in a moment later — exactly how Blinkit
  // / Instamart behave on cold start.
  //
  // Guarded by a module-level flag so remounts (e.g. coming back from
  // select-location) don't replay the full GPS → reverse-geocode chain and
  // visibly stall the home transition.
  useEffect(() => {
    if (__liveAddressResolved) return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
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
          const addr =
            parts.slice(0, 2).join(", ") || result.city || "Your location";
          __liveAddressCache = addr;
          setLiveAddress(addr);
        }
        __liveAddressResolved = true;
      } catch {
        // silently fall back to context location
      } finally {
        if (!cancelled) setLocationFetching(false);
      }
    });
    return () => {
      cancelled = true;
      handle.cancel?.();
    };
  }, []);

  // ── Build user's "frequently bought" list from past orders ────────────────
  // Also deferred: this hits Supabase to read up to 50 historical orders to
  // compute popularity. It feeds the "Frequently bought" carousel which is
  // *below* the fold on first paint, so there's no reason to block the
  // initial render on it. Falling back to "bought by other customers" while
  // this loads is the desired UX anyway.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
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
    });
    return () => {
      cancelled = true;
      handle.cancel?.();
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
        listRef.current?.scrollToOffset({ offset: 0, animated: true }),
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

  // ── Build the virtualized list data ──────────────────────────────────────
  // NOTE: this hook (and `renderHomeItem` below) MUST be declared before any
  // conditional `return` — moving them after the `loading` early-return
  // violates the Rules of Hooks (different hook count between renders).
  const listData = useMemo<HomeListItem[]>(() => {
    const out: HomeListItem[] = [{ kind: "search" }];

    if (activeCategory === "All") {
      if (frequentlyBought.products.length > 0) {
        out.push({
          kind: "freqBought",
          title: frequentlyBought.title,
          products: frequentlyBought.products,
        });
      }

      if (categoriesWithProducts.length > 0) {
        out.push({
          kind: "sectionHeader",
          title: "Shop by category",
          subtitle: "Everything you need",
        });
        out.push({
          kind: "catTileGrid",
          categories: categoriesWithProducts,
        });
      }

      if (categoriesWithProducts.length === 0) {
        out.push({
          kind: "empty",
          icon: !location ? "store-off-outline" : "package-variant-closed",
          title: !location ? "Set your location" : "No products found",
          message: !location
            ? "We'll show you what's fresh and available nearby."
            : "No products available near you at the moment.",
          cta: !location
            ? { label: "Choose Location", onPress: () => router.push("/location") }
            : undefined,
        });
      } else {
        for (const c of categoriesWithProducts) {
          const products = getProductsForCategoryName(productsByCategory, c.name);
          if (!products.length) continue;
          const visible = products.slice(0, SECTION_VISIBLE_PRODUCTS);

          out.push({
            kind: "sectionHeader",
            title: c.name,
            subtitle: "Top picks",
            onSeeAll:
              products.length > SECTION_VISIBLE_PRODUCTS
                ? () => handleSelectCategory(c.name)
                : undefined,
          });

          for (let i = 0; i < visible.length; i += ROW_COUNT) {
            out.push({
              kind: "productRow",
              products: visible.slice(i, i + ROW_COUNT),
              rowKey: `${c.id}-r${i}`,
            });
          }

          if (products.length > SECTION_VISIBLE_PRODUCTS) {
            out.push({
              kind: "seeAllBar",
              categoryName: c.name,
              onPress: () => handleSelectCategory(c.name),
            });
          }
        }
        out.push({ kind: "endStamp" });
      }
    } else {
      out.push({
        kind: "sectionHeader",
        title: activeCategory,
        subtitle: "Fresh picks near you",
        onSeeAll: () => handleSelectCategory("All"),
      });
      if (filteredProducts.length === 0) {
        out.push({
          kind: "empty",
          icon: "package-variant-closed",
          title: `No products in ${activeCategory}`,
          message: "Check back soon or explore other categories.",
        });
      } else {
        for (let i = 0; i < filteredProducts.length; i += ROW_COUNT) {
          out.push({
            kind: "productRow",
            products: filteredProducts.slice(i, i + ROW_COUNT),
            rowKey: `${activeCategory}-r${i}`,
          });
        }
      }
    }

    return out;
  }, [
    activeCategory,
    frequentlyBought,
    categoriesWithProducts,
    productsByCategory,
    filteredProducts,
    location,
    handleSelectCategory,
  ]);

  // ── List item renderer (lean, since each row recycles independently) ─────
  const renderHomeItem = useCallback(
    ({ item }: ListRenderItemInfo<HomeListItem>) => {
      switch (item.kind) {
        case "search":
          return (
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
          );

        case "freqBought":
          return (
            <FrequentlyBoughtSection
              title={item.title}
              products={item.products}
              cartItemsByProductId={cartItemsByProductId}
              onAdd={handleAdd}
              onUpdateQty={handleUpdateQty}
            />
          );

        case "catTileGrid":
          return (
            <View style={styles.catTileGrid}>
              {item.categories.map((c, i) => (
                <CategoryTile
                  key={c.id}
                  item={c}
                  index={i}
                  onPress={() => handleSelectCategory(c.name)}
                />
              ))}
            </View>
          );

        case "sectionHeader":
          return (
            <SectionHeader
              title={item.title}
              subtitle={item.subtitle}
              onSeeAll={item.onSeeAll}
            />
          );

        case "productRow":
          return (
            <View style={styles.productRow}>
              {item.products.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  cartItem={cartItemsByProductId.get(p.id)}
                  onAdd={handleAdd}
                  onUpdateQty={handleUpdateQty}
                />
              ))}
              {/* Pad short last rows so cards don't stretch to full width */}
              {item.products.length < ROW_COUNT &&
                Array.from({ length: ROW_COUNT - item.products.length }).map(
                  (_, i) => <View key={`pad-${i}`} style={styles.cardOuter} />,
                )}
            </View>
          );

        case "seeAllBar":
          return (
            <TouchableOpacity
              style={styles.seeAllBar}
              onPress={item.onPress}
              activeOpacity={0.85}
            >
              <Text style={styles.seeAllBarText}>
                See all products in {item.categoryName}
              </Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={16}
                color={T.green}
              />
            </TouchableOpacity>
          );

        case "endStamp":
          return (
            <View style={styles.endStamp}>
              <MaterialCommunityIcons name="leaf" size={14} color={T.green} />
              <Text style={styles.endStampText}>
                That&apos;s everything fresh near you
              </Text>
            </View>
          );

        case "empty":
          return (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={40}
                  color={T.green}
                />
              </View>
              <Text style={styles.emptyTitle}>{item.title}</Text>
              <Text style={styles.emptyText}>{item.message}</Text>
              {item.cta && (
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={item.cta.onPress}
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
                    <Text style={styles.emptyBtnText}>{item.cta.label}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          );
      }
    },
    [cartItemsByProductId, handleAdd, handleUpdateQty, handleSelectCategory],
  );

  // ── Loading (skeleton, not spinner) ──────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <AddressBarBlock
          liveAddress={liveAddress}
          location={location}
          locationFetching={locationFetching}
          profileAnimatedStyle={profileAnimatedStyle}
          onPressIn={handleProfilePressIn}
          onPressOut={handleProfilePressOut}
          onProfilePress={() => setShowProfileMenu(true)}
        />
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
      <FlashList
        ref={listRef}
        data={listData}
        renderItem={renderHomeItem}
        keyExtractor={homeListKeyExtractor}
        getItemType={homeListItemType}
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.flashListContent}
        ListHeaderComponent={
          <AddressBarBlock
            liveAddress={liveAddress}
            location={location}
            locationFetching={locationFetching}
            profileAnimatedStyle={profileAnimatedStyle}
            onPressIn={handleProfilePressIn}
            onPressOut={handleProfilePressOut}
            onProfilePress={() => setShowProfileMenu(true)}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.green}
            colors={[T.green]}
          />
        }
      />

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

// ─── FlashList helpers ──────────────────────────────────────────────────────
const homeListKeyExtractor = (item: HomeListItem, index: number): string => {
  switch (item.kind) {
    case "search":
      return "search";
    case "freqBought":
      return "freq";
    case "catTileGrid":
      return "tilegrid";
    case "sectionHeader":
      return `hdr-${item.title}-${index}`;
    case "productRow":
      return `row-${item.rowKey}`;
    case "seeAllBar":
      return `seeall-${item.categoryName}`;
    case "endStamp":
      return "end";
    case "empty":
      return `empty-${item.title}`;
  }
};

/** Tells FlashList to recycle cells of the same type — huge perf win on scroll. */
const homeListItemType = (item: HomeListItem): string => item.kind;

// ─── Address-bar block (memoized so live-location updates don't bust list memo) ──
const AddressBarBlock = React.memo(function AddressBarBlock({
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
          onPress={() => router.push("/select-location")}
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
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.cream },

  // ── Scroll container ─────────────────────────────────────────────────────
  scrollContent: { paddingBottom: 150 },
  flashListContent: { paddingBottom: 150 },
  productRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    justifyContent: "space-between",
    columnGap: 8,
    marginBottom: 12,
  },

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
