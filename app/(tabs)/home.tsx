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
    FadeOutDown,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";

import ProfileMenu from "../../components/ProfileMenu";
import { IconWrap, Screen, Skeleton } from "../../components/ui";
import { HIT_SLOP } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useCart, useCartItemMap, type CartItem } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { cdnImage } from "../../lib/imageUrl";
import { getUserOrders } from "../../lib/orderService";
import { logSilentFailure } from "../../lib/logSilentFailure";
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
import { getAllActiveProductIds, getNearbyProductFilter } from "../../lib/storeService";

// ─── Design tokens ──────────────────────────────────────────────────────────
const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  greenGlow: "rgba(45,122,79,0.18)",
  greenBorder: "rgba(45,122,79,0.2)",
  cream: "#FAFAF7",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkLight: "#A89282",
  white: "#FFFFFF",
  cardBorder: "rgba(60,47,30,0.08)",
  shadowDark: "rgba(0,0,0,0.10)",
  skeletonLo: "#EFEDE7",
  skeletonHi: "#F7F5EF",
  // Terracotta deal accent — mirrors C.deal/dealDark/dealLight in constants/colors.ts.
  // Use ONLY for commercial-benefit signals (discounts, savings) — never errors/CTAs.
  deal: "#EA580C",
  dealDark: "#C2410C",
  dealLight: "#FFEDD5",
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

/** Lifts the 22px qty buttons to a 44px target; horizontal slop stays 6 so − and + never overlap inside the 68px box. */
const QTY_HIT_SLOP = { top: 11, bottom: 11, left: 6, right: 6 };
/** Lifts the ~24px ADD button to a 44px target. */
const ADD_HIT_SLOP = { top: 10, bottom: 10, left: 4, right: 4 };
/** Address pressable is ~35px tall; slop it to 44+ without moving the layout. */
const ADDRESS_HIT_SLOP = { top: 8, bottom: 8 };

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


/** Neutral blurhash rendered as the image placeholder while the real product image loads. */
const PLACEHOLDER_BLURHASH = "L6PZfSi_.AyE_3t7t7R**0o#DgR4";

// ─── Product Card (Blinkit / Instamart style) ───────────────────────────────
type ProductCardProps = {
  p: Product;
  cartItem: CartItem | undefined;
  onAdd: (p: Product) => void;
  onUpdateQty: (p: Product, delta: number) => void;
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
      () => onUpdateQty(p, -1),
      [onUpdateQty, p],
    );
    const handlePlus = useCallback(
      () => onUpdateQty(p, 1),
      [onUpdateQty, p],
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
            accessibilityRole="button"
          >
            <View style={styles.imageWrap}>
              {p.image_url ? (
                <ExpoImage
                  source={{ uri: cdnImage(p.image_url, 240) }}
                  style={styles.image}
                  contentFit="contain"
                  transition={120}
                  cachePolicy="memory-disk"
                  placeholder={PLACEHOLDER_BLURHASH}
                  recyclingKey={p.id}
                  priority="low"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <MaterialCommunityIcons
                    name="image-off-outline"
                    size={24}
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
                    name="package-variant-closed"
                    size={10}
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
                  <Text
                    style={[styles.priceValue, hasDiscount && styles.priceValueDeal]}
                    numberOfLines={1}
                  >
                    ₹{p.price}
                  </Text>
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
                        hitSlop={QTY_HIT_SLOP}
                        accessibilityRole="button"
                        accessibilityLabel="Decrease quantity"
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
                        hitSlop={QTY_HIT_SLOP}
                        accessibilityRole="button"
                        accessibilityLabel="Increase quantity"
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
                      activeOpacity={0.8}
                      onPress={handleAdd}
                      hitSlop={ADD_HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${p.name}`}
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

const CAT_TINTS = [
  "#E8F5E9", "#FFF8E1", "#E3F2FD", "#FCE4EC",
  "#EDE7F6", "#E0F7FA", "#FBE9E7", "#F9FBE7",
];

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
  const tint = item.color || CAT_TINTS[index % CAT_TINTS.length];
  return (
    <TouchableOpacity
      style={styles.catTile}
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityRole="button"
    >
      <IconWrap size={68} radius={20} bg={tint} style={styles.catTileIconWrap}>
        {item.image_url ? (
          <ExpoImage
            source={{ uri: cdnImage(item.image_url, 180) }}
            style={styles.catTileImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={100}
            placeholder={PLACEHOLDER_BLURHASH}
            recyclingKey={item.id}
            priority="low"
          />
        ) : (
          <MaterialCommunityIcons
            name={icon as any}
            size={30}
            color={T.green}
          />
        )}
      </IconWrap>
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
  accentColor,
}: {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  accentColor?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View
        style={[
          styles.sectionTitleAccent,
          accentColor ? { backgroundColor: accentColor } : null,
        ]}
      />
      <View style={styles.sectionTitleCol}>
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
          style={styles.chip}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
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
  onUpdateQty: (p: Product, delta: number) => void;
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
    <View style={styles.freqShelf}>
      {/* Warm terracotta wash marks the deals shelf — same hue as the discount
          flags at 6% opacity, fading into the feed. Non-interactive. */}
      <LinearGradient
        colors={["rgba(234,88,12,0)", "rgba(234,88,12,0.07)", "rgba(234,88,12,0)"]}
        locations={[0, 0.22, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <SectionHeader title={title} subtitle="Quick reorder" accentColor={T.deal} />
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
    <View style={[styles.cardOuter, styles.skeletonCardOuter]}>
      <View style={[styles.card, styles.skeletonCard]}>
        <View style={styles.imageWrap}>
          {/* 96 mirrors styles.image height so the skeleton card matches the real card */}
          <Skeleton height={96} radius={8} color={T.skeletonHi} />
        </View>
        <View style={styles.cardBody}>
          <Skeleton width="40%" height={10} color={T.skeletonLo} />
          <Skeleton width="90%" height={10} color={T.skeletonLo} style={styles.skeletonMt8} />
          <Skeleton width="70%" height={10} color={T.skeletonLo} style={styles.skeletonMt6} />
          <View style={[styles.priceAddRow, styles.skeletonMt8]}>
            <Skeleton width="30%" height={14} color={T.skeletonLo} />
            <Skeleton width={46} height={24} radius={8} color={T.skeletonLo} />
          </View>
        </View>
      </View>
    </View>
  );
});

function SkeletonHomeFeed() {
  return (
    <View>
      <View style={styles.sectionHeader}>
        <Skeleton
          width={4}
          height={18}
          radius={2}
          color={T.skeletonLo}
          style={styles.skeletonAccent}
        />
        <View style={styles.sectionTitleCol}>
          <Skeleton width={120} height={16} color={T.skeletonLo} />
          <Skeleton width={80} height={10} color={T.skeletonLo} style={styles.skeletonMt6} />
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

  // null = no location set (show all); Set = computed filter (may be empty = no stores)
  const [nearbyIds, setNearbyIds] = useState<Set<string> | null>(null);
  const [noStoresNearby, setNoStoresNearby] = useState(false);
  const lastFilteredLocationKey = useRef<string | null>(null);

  const { location, isHydrated } = useLocation();
  const { addItem, incrementQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  const totalQty = useMemo(() => {
    let n = 0;
    for (const v of cartItemsByProductId.values()) n += v.quantity;
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

  // Discards a slower-resolving fetch superseded by a newer one (e.g. two
  // quick location changes) — the existing per-effect `cancelled` flags at
  // each call site only stop a superseded effect from *starting* a new
  // fetchFresh call, they don't stop an already-in-flight call's late
  // response from overwriting fresher state once it resolves.
  const fetchFreshSeqRef = useRef(0);

  /**
   * Full background refresh — fetches the entire catalog and overwrites cache.
   * Pass `filter` when the user has a location set so only nearby products load.
   */
  const fetchFresh = useCallback(async (filter?: Set<string>) => {
    const myId = ++fetchFreshSeqRef.current;
    try {
      const [categoriesData, catalog] = await Promise.all([
        getAllCategories(),
        loadMasterCatalog({ nearbyIds: filter }),
      ]);
      if (myId !== fetchFreshSeqRef.current) return;
      setCategories(categoriesData);
      setProductsByCategory(catalog.productsByCategory);
      // Only persist to cache when no location filter (cache is global, not per-location).
      if (!filter) {
        InteractionManager.runAfterInteractions(() => {
          writeHomeCatalogCache({
            products: catalog.products,
            productsByCategory: catalog.productsByCategory,
            categories: categoriesData,
          });
        });
      }
    } catch (error) {
      logSilentFailure("Load home", error);
    }
  }, []);

  /**
   * Cold-start fast path — fetches only the top-500 most-popular products
   * (one round-trip) so the home grid paints with real data quickly.
   * Pass `filter` to restrict results to nearby-store inventory.
   */
  const fetchFreshFast = useCallback(async (filter?: Set<string>) => {
    try {
      const [categoriesData, fastCatalog] = await Promise.all([
        getAllCategories(),
        loadMasterCatalogFast(500, filter),
      ]);
      setCategories(categoriesData);
      setProductsByCategory(fastCatalog.productsByCategory);
      setLoading(false);
      // Background-fill: hydrate the rest of the catalog.
      InteractionManager.runAfterInteractions(() => {
        loadMasterCatalog({ nearbyIds: filter })
          .then((full) => {
            setProductsByCategory(full.productsByCategory);
            if (!filter) {
              writeHomeCatalogCache({
                products: full.products,
                productsByCategory: full.productsByCategory,
                categories: categoriesData,
              });
            }
          })
          .catch((err) => logSilentFailure("Background-fill full catalog", err));
      });
    } catch (error) {
      logSilentFailure("Load home (fast)", error);
      await fetchFresh(filter);
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
   * location-independent on cold start; the location effect below applies
   * the nearby filter once hydration completes.
   */
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    let cancelled = false;

    (async () => {
      // Case 1: memory cache already used in initial state.
      if (initialCache) {
        if (!isHomeCatalogCacheFresh(initialCache)) {
          InteractionManager.runAfterInteractions(async () => {
            if (cancelled) return;
            const filter = await getAllActiveProductIds();
            if (!cancelled) fetchFresh(filter.size > 0 ? filter : undefined);
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
          InteractionManager.runAfterInteractions(async () => {
            if (cancelled) return;
            const filter = await getAllActiveProductIds();
            if (!cancelled) fetchFresh(filter.size > 0 ? filter : undefined);
          });
        }
        return;
      }

      // Case 3: no cache at all → get active store filter then fast network path.
      const filter = await getAllActiveProductIds();
      if (!cancelled) await fetchFreshFast(filter.size > 0 ? filter : undefined);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Nearby store filter — recompute when user location changes ────────────
  // Runs after isHydrated so we never block the cold-start paint. When the
  // location changes significantly (>~110 m) we compute a new nearby filter
  // and reload the catalog so the user only sees products from active stores
  // within 4 km of their delivery address.
  useEffect(() => {
    if (!isHydrated || !location) {
      // No location — fall back to all active-store products (not raw master catalog).
      if (nearbyIds !== null) {
        setNearbyIds(null);
        setNoStoresNearby(false);
        let cancelled = false;
        getAllActiveProductIds().then((filter) => {
          if (!cancelled) fetchFresh(filter.size > 0 ? filter : undefined);
        });
        return () => { cancelled = true; };
      }
      return;
    }

    // Round to 3 decimal places (~110 m grid) to avoid re-firing on GPS jitter.
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (lastFilteredLocationKey.current === key) return;
    lastFilteredLocationKey.current = key;

    let cancelled = false;
    (async () => {
      const filter = await getNearbyProductFilter(location.latitude, location.longitude);
      if (cancelled || !filter) return;
      const noStores = filter.storeIds.length === 0;
      setNearbyIds(filter.productIds);
      setNoStoresNearby(noStores);
      await fetchFresh(noStores ? undefined : filter.productIds);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude, isHydrated]);

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
    await fetchFresh(noStoresNearby ? undefined : nearbyIds ?? undefined);
    setRefreshing(false);
  }, [fetchFresh, nearbyIds, noStoresNearby]);

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
        isLoose: p.isLoose,
      }),
    [addItem],
  );

  const handleUpdateQty = useCallback(
    (p: Product, delta: number) => incrementQty(p.id, delta),
    [incrementQty],
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
        const emptyItem: HomeListItem = (() => {
          if (!location) {
            return {
              kind: "empty" as const,
              icon: "store-off-outline" as const,
              title: "Set your location",
              message: "We'll show you what's fresh and available nearby.",
              cta: { label: "Choose Location", onPress: () => router.push("/location") },
            };
          }
          if (noStoresNearby) {
            return {
              kind: "empty" as const,
              icon: "map-marker-off-outline" as const,
              title: "No stores near you",
              message: "We don't have a delivery store within 4 km of your location yet.",
              cta: { label: "Change Location", onPress: () => router.push("/location") },
            };
          }
          return {
            kind: "empty" as const,
            icon: "package-variant-closed" as const,
            title: "No products found",
            message: "No products available near you at the moment.",
          };
        })();
        out.push(emptyItem);
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
    noStoresNearby,
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
                activeOpacity={0.8}
                onPress={() => router.push("../support/search")}
                accessibilityRole="search"
                accessibilityLabel="Search products"
              >
                <IconWrap
                  size={30}
                  radius={10}
                  bg={T.greenXLight}
                  icon="magnify"
                  iconSize={19}
                  iconColor={T.green}
                />
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
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.seeAllBarText} numberOfLines={1}>
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
              <IconWrap
                size={80}
                circle
                bg={T.greenXLight}
                icon={item.icon}
                iconSize={40}
                iconColor={T.green}
                style={styles.emptyIconWrap}
              />
              <Text style={styles.emptyTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.emptyText}>{item.message}</Text>
              {item.cta && (
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={item.cta.onPress}
                  activeOpacity={0.8}
                  accessibilityRole="button"
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
      <Screen bg={T.cream} edges={["top"]}>
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
          <View style={[styles.searchBar, styles.searchBarSkeleton]}>
            <Skeleton width={30} height={30} radius={10} color={T.skeletonLo} />
            <Skeleton width="60%" height={12} color={T.skeletonLo} />
          </View>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SkeletonHomeFeed />
          <SkeletonHomeFeed />
        </ScrollView>
        <ProfileMenu
          visible={showProfileMenu}
          onClose={() => setShowProfileMenu(false)}
        />
      </Screen>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Screen bg={T.cream} edges={["top"]}>
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
          exiting={FadeOutDown.duration(220)}
          style={styles.cartBar}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => router.push("/support/checkout")}
            style={({ pressed }) => [
              styles.cartPill,
              pressed && styles.cartPillPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`View cart, ${totalQty} ${totalQty === 1 ? "item" : "items"}`}
          >
            <LinearGradient
              colors={[T.greenLight, T.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cartPillGradient}
            >
              <View style={[styles.cartCircle, styles.cartQtyBubble]}>
                <Text style={styles.cartQtyText}>{totalQty}</Text>
              </View>
              <Text style={styles.cartPillLabel}>
                {totalQty === 1 ? "item in cart" : "items in cart"}
              </Text>
              <View style={styles.cartCircle}>
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
    </Screen>
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
  const locationLabel = location?.label;
  const addressText = liveAddress
    ? liveAddress
    : location?.address
      ? location.address
      : location?.label
        ? location.label
        : null;

  return (
    <View style={styles.addressBarBg}>
      {/* Soft fresh-green wash, identical to checkout's header so tabs and
          checkout share one visual language. Watermark leaf echoes the feed's
          end-stamp motif; both layers are non-interactive. */}
      <LinearGradient
        colors={[T.greenXLight, T.white]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={styles.headerLeafWrap} pointerEvents="none">
        <MaterialCommunityIcons name="leaf" size={110} color={T.green} />
      </View>
      <View style={styles.appBar}>
        <Pressable
          style={({ pressed }) => [
            styles.addressPressable,
            pressed && styles.pressed,
          ]}
          onPress={() => router.push("/select-location")}
          android_ripple={{ color: "rgba(45,122,79,0.08)", borderless: false }}
          hitSlop={ADDRESS_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Change delivery address"
        >
          <View style={styles.deliveryLabelRow}>
            <View style={styles.deliveryDot} />
            <Text style={styles.deliveryLabelText} numberOfLines={1}>
              {locationLabel ?? "Delivery to"}
            </Text>
            {locationFetching && (
              <ActivityIndicator
                size="small"
                color={T.green}
                style={styles.locationSpinner}
              />
            )}
          </View>
          <View style={styles.locationInlineRow}>
            <Text style={styles.deliveryAddressText} numberOfLines={1}>
              {addressText ?? "Set delivery address"}
            </Text>
            <MaterialCommunityIcons
              name="chevron-down"
              size={15}
              color={T.barkLight}
            />
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.chip}
            activeOpacity={0.8}
            onPress={() => router.push("/wallet" as any)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="wallet-outline" size={15} color={T.green} />
            <Text style={styles.walletText}>Wallet</Text>
          </TouchableOpacity>

          <Animated.View style={profileAnimatedStyle}>
            <Pressable
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              onPress={onProfilePress}
              style={styles.profileBtn}
              accessibilityRole="button"
              accessibilityLabel="Account menu"
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
  flashListContent: { paddingBottom: 150 },
  productRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    justifyContent: "space-between",
    columnGap: 8,
    marginBottom: 12,
  },

  // ── Skeleton helpers ─────────────────────────────────────────────────────
  skeletonCardOuter: { opacity: 0.92 },
  skeletonCard: { borderColor: "transparent" },
  skeletonAccent: { marginRight: 2 },
  skeletonMt8: { marginTop: 8 },
  skeletonMt6: { marginTop: 6 },
  pressed: { opacity: 0.7 },

  // ── Address bar block (scrolls away) ─────────────────────────────────────
  addressBarBg: {
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
    overflow: "hidden", // clips the watermark leaf; no shadow here, so safe on Android
  },
  freqShelf: {
    paddingBottom: 4,
  },
  headerLeafWrap: {
    position: "absolute",
    right: -26,
    top: -34,
    opacity: 0.07,
    transform: [{ rotate: "-24deg" }],
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  addressPressable: { flex: 1, borderRadius: 10 },
  deliveryLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  deliveryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.green,
  },
  deliveryLabelText: {
    fontSize: 11,
    color: T.green,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  locationSpinner: { marginLeft: 4, transform: [{ scale: 0.75 }] },
  deliveryAddressText: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
    color: T.bark,
    letterSpacing: -0.2,
    flex: 1,
  },
  locationInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  /** Shared green chip (Wallet, See all). */
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.greenXLight,
    borderWidth: 1,
    borderColor: T.greenBorder,
  },
  walletText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 12, color: T.green },
  profileBtn: { padding: 3 },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },

  // ── Sticky search ────────────────────────────────────────────────────────
  stickyWrap: {
    backgroundColor: T.cream,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.cardBorder,
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
  searchBarSkeleton: {
    backgroundColor: T.skeletonHi,
    borderColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  searchPlaceholder: { fontFamily: "PlusJakartaSans_500Medium",
    color: T.barkLight,
    fontSize: 14,
    flex: 1,
  },

  // ── Section header ───────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
    marginBottom: 12,
    gap: 10,
  },
  sectionTitleCol: { flex: 1 },
  sectionTitleAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: T.green,
    marginRight: 2,
  },
  sectionTitle: { fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 17,
    color: T.bark,
    letterSpacing: -0.3,
  },
  sectionSub: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 11.5,
    color: T.barkLight,
    marginTop: 2,
  },
  seeAllText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 12,
    color: T.green,
    letterSpacing: 0.2,
  },

  horizontalListContent: { paddingHorizontal: 16, gap: 8 },

  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    justifyContent: "space-between",
    rowGap: 12,
  },

  seeAllBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.25)",
    borderStyle: "dashed",
  },
  seeAllBarText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.green,
    fontSize: 13,
    letterSpacing: 0.2,
    flexShrink: 1,
  },

  // ── Shop-by-category tile grid ───────────────────────────────────────────
  catTileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    justifyContent: "flex-start",
  },
  catTile: {
    width: "25%",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 12,
    gap: 8,
  },
  // Clips the cover image to the IconWrap's 20px radius; the tinted bg is the only depth cue.
  catTileIconWrap: { overflow: "hidden" },
  catTileImg: { width: "100%", height: "100%" },
  catTileLabel: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 11,
    color: T.bark,
    textAlign: "center",
    letterSpacing: 0.1,
    lineHeight: 14,
  },

  endStamp: {
    marginTop: 24,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: T.greenXLight,
    borderWidth: 1,
    borderColor: T.greenGlow,
  },
  endStampText: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 12,
    color: T.green,
    letterSpacing: 0.2,
  },

  // ── Product card ──────────────────────────────────────────────────────────
  cardOuter: { width: "31.8%" },
  cardOuterHorizontal: { width: 132 },
  // overflow:hidden clips iOS layer shadows, so the card relies on its 1px border for
  // definition — identical on both platforms.
  card: {
    flex: 1,
    backgroundColor: T.white,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  cardOutOfStock: { opacity: 0.62 },
  imageWrap: {
    position: "relative",
    backgroundColor: T.white,
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
    backgroundColor: T.deal,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  discountFlagText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.white,
    fontSize: 10,
    lineHeight: 11,
    letterSpacing: 0.2,
  },
  discountFlagOff: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.white,
    fontSize: 7.5,
    lineHeight: 9,
    letterSpacing: 0.8,
  },

  outOfStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.white,
    fontSize: 11,
    letterSpacing: 0.6,
  },

  cardBody: { padding: 8 },
  unitPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: T.greenXLight,
    marginBottom: 4,
  },
  unitPillText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.green,
    fontSize: 9,
    letterSpacing: 0.2,
  },
  productName: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 11.5,
    color: T.bark,
    lineHeight: 14.5,
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
  priceValue: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.bark,
    fontSize: 13,
    letterSpacing: -0.3,
    lineHeight: 15,
  },
  priceValueDeal: {
    color: T.dealDark,
  },
  originalPrice: { fontFamily: "PlusJakartaSans_500Medium",
    color: T.barkLight,
    fontSize: 10,
    textDecorationLine: "line-through",
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
  addText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 11.5,
    color: T.green,
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
  soldOutText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.barkLight,
    fontSize: 10.5,
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
  qtyValue: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.white,
    fontSize: 12,
    minWidth: 14,
    textAlign: "center",
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  empty: {
    marginTop: 48,
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconWrap: {
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.15)",
  },
  emptyTitle: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.bark,
    fontSize: 17,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  emptyText: { fontFamily: "PlusJakartaSans_500Medium",
    color: T.barkLight,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
  },
  // Solid bg + no overflow:hidden here so the iOS shadow renders; the gradient clips itself.
  emptyBtn: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: T.green,
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
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    overflow: "hidden",
  },
  emptyBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: T.white, fontSize: 14 },

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
  // Solid bg + no overflow:hidden so the iOS shadow renders (it was clipped before);
  // elevation 14 is the Android stacking order above the tab bar — keep it.
  cartPill: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: T.green,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 14,
  },
  cartPillPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },
  cartPillGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 8,
    gap: 10,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 999,
    overflow: "hidden",
  },
  /** White 30px circle used for both the qty bubble and the arrow. */
  cartCircle: {
    minWidth: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  cartQtyBubble: { paddingHorizontal: 8 },
  cartQtyText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.green,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  cartPillLabel: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: T.white,
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
