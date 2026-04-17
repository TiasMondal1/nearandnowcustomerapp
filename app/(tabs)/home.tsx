import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as ExpoLocation from "expo-location";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  InteractionManager,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import ProfileMenu from "../../components/ProfileMenu";
import StarRating from "../../components/StarRating";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import {
  getCategoryCounts,
  getCountForCategoryName,
  getProductsPage,
  HOME_PAGE_SIZE,
  readHomePageCache,
  writeHomePageCache,
  type Product,
} from "../../lib/productService";

/** Fisher–Yates shuffle (new array). */
function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Design tokens (override / extend your C palette) ───────────────────────
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
};

const FALLBACK_ICONS = [
  "apple",
  "leaf",
  "cow",
  "cookie",
  "cup",
  "sack",
  "face-woman-shimmer",
  "home-outline",
];

// ─── Animated Product Card ───────────────────────────────────────────────────
function ProductCard({
  p,
  index,
  cartItem,
  onAdd,
  onUpdateQty,
}: {
  p: Product;
  index: number;
  cartItem: any;
  onAdd: () => void;
  onUpdateQty: (qty: number) => void;
}) {
  const scale = useSharedValue(1);
  const hasDiscount = p.original_price != null && p.original_price > p.price;
  const discountPct = hasDiscount
    ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
    : 0;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    // Outer wrapper owns the layout/entering animation so Reanimated doesn't warn
    // about `transform` on the same node being overwritten by the layout animation.
    <Animated.View
      entering={FadeInDown.delay(index * 40).duration(300)}
      style={styles.cardOuter}
    >
      <Animated.View style={[animStyle, styles.card, !p.in_stock && styles.cardOutOfStock]}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 18, stiffness: 280 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 18, stiffness: 280 });
        }}
        onPress={() => router.push(`../product/${p.id}`)}
      >
        {/* ── Image zone ── */}
        <View style={styles.imageWrap}>
          {p.image_url ? (
            <Image source={{ uri: p.image_url }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <MaterialCommunityIcons
                name="image-off-outline"
                size={28}
                color={T.barkLight}
              />
            </View>
          )}

          {/* Gradient overlay for text legibility */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.28)"]}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 0, y: 1 }}
            pointerEvents="none"
          />

          {hasDiscount && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>−{discountPct}%</Text>
            </View>
          )}

          {!p.in_stock && (
            <View style={styles.outOfStockOverlay}>
              <Text style={styles.outOfStockText}>Sold Out</Text>
            </View>
          )}
        </View>
      </Pressable>

      {/* ── Card body ── */}
      <View style={styles.cardBody}>
        <Text style={styles.productName} numberOfLines={2}>
          {p.name}
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.priceValue}>₹{p.price}</Text>
          {hasDiscount && (
            <Text style={styles.originalPrice}>₹{p.original_price}</Text>
          )}
        </View>

        {p.unit ? <Text style={styles.priceUnit}>{p.unit}</Text> : null}

        <View style={styles.ratingWrap}>
          <StarRating rating={p.avgRating ?? 0} reviewCount={p.reviewCount} />
        </View>

        {p.in_stock ? (
          cartItem ? (
            <View style={styles.qtyBox}>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => onUpdateQty(cartItem.quantity - 1)}
                activeOpacity={0.75}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => onUpdateQty(cartItem.quantity + 1)}
                activeOpacity={0.75}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addBtn}
              activeOpacity={0.82}
              onPress={onAdd}
            >
              <LinearGradient
                colors={[T.greenLight, T.green]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.addBtnGradient}
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={15}
                  color={T.white}
                />
                <Text style={styles.addText}>ADD</Text>
              </LinearGradient>
            </TouchableOpacity>
          )
        ) : (
          <View style={styles.soldOutBtn}>
            <Text style={styles.soldOutText}>Sold Out</Text>
          </View>
        )}
      </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Category Chip ────────────────────────────────────────────────────────────
function CategoryChip({
  item,
  index,
  active,
  count,
  onPress,
}: {
  item: any;
  index: number;
  active: boolean;
  count: number;
  onPress: () => void;
}) {
  const icon =
    item.icon || FALLBACK_ICONS[(index - 1) % FALLBACK_ICONS.length];

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.categoryChip}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.categoryCircle,
          active && styles.categoryCircleActive,
        ]}
      >
        {item.id === "all" ||
        !("image_url" in item) ||
        !item.image_url ? (
          <MaterialCommunityIcons
            name={icon as any}
            size={22}
            color={active ? T.white : T.green}
          />
        ) : (
          <Image
            source={{ uri: (item as any).image_url }}
            style={styles.categoryImage}
          />
        )}
        {active && (
          <View style={styles.categoryActiveRing} pointerEvents="none" />
        )}
        {count > 0 && (
          <View style={styles.categoryCountBadge} pointerEvents="none">
            <Text style={styles.categoryCountText}>
              {count > 99 ? "99+" : count}
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.categoryLabel, active && styles.categoryLabelActive]}
        numberOfLines={1}
      >
        {item.name}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  // `loading` only blocks on cold cache. If we have cached data, render it immediately.
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);

  // Paginated product list for the *currently active* category (or All).
  const [pageItems, setPageItems] = useState<Product[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Live location state
  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const [locationFetching, setLocationFetching] = useState(false);

  const { location, isHydrated } = useLocation();
  const { addItem, items, updateQty } = useCart();

  // Android: on Home tab, hardware back should close the app, never go back to auth/signup.
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

  /** Loads categories + counts + first page fresh and replaces state. */
  const fetchInitial = useCallback(async () => {
    try {
      const [categoriesData, countsData, firstPage] = await Promise.all([
        getAllCategories(),
        getCategoryCounts(),
        getProductsPage(null, 0, HOME_PAGE_SIZE),
      ]);
      const shuffled = shuffleArray(firstPage);
      setCategories(categoriesData);
      setCategoryCounts(countsData.counts);
      setTotalCount(countsData.total);
      setActiveCategory((prev) => (prev === "All" ? prev : "All"));
      setPageItems(shuffled);
      setPageOffset(firstPage.length);
      setHasMore(firstPage.length >= HOME_PAGE_SIZE);
      writeHomePageCache({
        categories: categoriesData,
        categoryCounts: countsData,
        firstPage,
      });
    } catch (error) {
      console.error("Failed to load home:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Paint from cache ASAP so the UI is never blank. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readHomePageCache();
      if (cancelled || !cached) return;
      setCategories(cached.categories);
      setCategoryCounts(cached.categoryCounts.counts);
      setTotalCount(cached.categoryCounts.total);
      setPageItems(shuffleArray(cached.firstPage));
      setPageOffset(cached.firstPage.length);
      setHasMore(cached.firstPage.length >= HOME_PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const task = InteractionManager.runAfterInteractions(() => fetchInitial());
    return () => task.cancel();
  }, [isHydrated, fetchInitial]);

  /** Fetch the first page for the active category (called when user taps a chip). */
  const loadCategoryFirstPage = useCallback(async (categoryName: string) => {
    try {
      setLoadingMore(true);
      const cat = categoryName === "All" ? null : categoryName;
      const rows = await getProductsPage(cat, 0, HOME_PAGE_SIZE);
      setPageItems(shuffleArray(rows));
      setPageOffset(rows.length);
      setHasMore(rows.length >= HOME_PAGE_SIZE);
    } catch (e) {
      console.error("Failed to load category page:", e);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  /** Appends the next page on scroll-to-end. */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const cat = activeCategory === "All" ? null : activeCategory;
      const rows = await getProductsPage(cat, pageOffset, HOME_PAGE_SIZE);
      const shuffled = shuffleArray(rows);
      setPageItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const add = shuffled.filter((p) => !seen.has(p.id));
        return [...prev, ...add];
      });
      setPageOffset((o) => o + rows.length);
      setHasMore(rows.length >= HOME_PAGE_SIZE);
    } catch (e) {
      console.error("Failed to load more:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [activeCategory, pageOffset, loadingMore, hasMore]);

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
          setLiveAddress(parts.slice(0, 2).join(", ") || result.city || "Your location");
        }
      } catch {
        // silently fall back to context location
      } finally {
        if (!cancelled) setLocationFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInitial();
    setRefreshing(false);
  }, [fetchInitial]);

  /** Only show chips for categories that have products (uses counts, not a full product scan). */
  const categoriesWithProducts = useMemo(
    () =>
      shuffleArray(
        categories.filter((c) => getCountForCategoryName(categoryCounts, c.name) > 0),
      ),
    [categories, categoryCounts],
  );

  useEffect(() => {
    if (activeCategory === "All") return;
    const stillValid = categoriesWithProducts.some((c) => c.name === activeCategory);
    if (!stillValid) setActiveCategory("All");
  }, [activeCategory, categoriesWithProducts]);

  const handleSelectCategory = useCallback(
    (name: string) => {
      if (name === activeCategory) return;
      setActiveCategory(name);
      loadCategoryFirstPage(name);
    },
    [activeCategory, loadCategoryFirstPage],
  );

  const filteredProducts = pageItems;
  const activeCountLabel =
    activeCategory === "All"
      ? totalCount
      : getCountForCategoryName(categoryCounts, activeCategory);

  const profileScale = useSharedValue(1);
  const profileAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: profileScale.value }],
  }));

  const handleScroll = useCallback(
    (event: any) => {
      const offsetY = event?.nativeEvent?.contentOffset?.y ?? 0;
      if (!hasScrolled && offsetY > 28) setHasScrolled(true);
      else if (hasScrolled && offsetY <= 28) setHasScrolled(false);
    },
    [hasScrolled],
  );

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <LinearGradient
          colors={[T.greenXLight, T.cream]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.loadingIcon}>
          <MaterialCommunityIcons name="leaf" size={32} color={T.green} />
        </View>
        <ActivityIndicator size="large" color={T.green} style={{ marginTop: 16 }} />
        <Text style={styles.loadingText}>Finding fresh picks near you…</Text>
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
        <LinearGradient
          colors={[T.greenXLight, T.cream]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* App bar row: delivery location left + icons right */}
        <Animated.View
          entering={FadeInDown.duration(420).springify()}
          style={styles.appBar}
        >
          {/* "Delivery to…" location block */}
          <Pressable
            style={{ flex: 1 }}
            onPress={() => router.push("/location")}
          >
            {/* Label row */}
            <View style={styles.deliveryLabelRow}>
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={14}
                color={T.green}
              />
              <Text style={styles.deliveryLabelText}>Delivery to</Text>
              {locationFetching && (
                <ActivityIndicator size="small" color={T.green} style={{ marginLeft: 4 }} />
              )}
            </View>

            {/* Address line */}
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

          {/* Right side: wallet + profile */}
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.walletBtn} activeOpacity={0.8}>
              <LinearGradient
                colors={[T.greenXLight, "#d4edda"]}
                style={StyleSheet.absoluteFillObject}
              />
              <MaterialCommunityIcons name="wallet-outline" size={16} color={T.green} />
              <Text style={styles.walletText}>₹0</Text>
            </TouchableOpacity>

            <Animated.View style={profileAnimatedStyle}>
              <Pressable
                onPressIn={() => {
                  profileScale.value = withSpring(0.93, { damping: 16, stiffness: 260 });
                }}
                onPressOut={() => {
                  profileScale.value = withSpring(1, { damping: 16, stiffness: 260 });
                }}
                onPress={() => setShowProfileMenu(true)}
                style={styles.profileBtn}
              >
                <LinearGradient
                  colors={[T.greenLight, T.green]}
                  style={styles.profileAvatar}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <MaterialCommunityIcons name="account-outline" size={20} color={T.white} />
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </View>
        </Animated.View>

        {/* Sticky search bar (appears on scroll) */}
        {hasScrolled && (
          <Animated.View
            entering={FadeInDown.duration(220)}
            style={styles.stickySearch}
          >
            <TouchableOpacity
              style={styles.searchPill}
              activeOpacity={0.88}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons name="magnify" size={19} color={T.barkLight} />
              <Text style={styles.searchPlaceholder}>
                Search groceries, dairy, snacks…
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Thin accent line at bottom of header */}
        <View style={styles.headerRule} />
      </Animated.View>

      {/* ── Product list ─────────────────────────────────────────────────── */}
      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.green}
            colors={[T.green]}
          />
        }
        removeClippedSubviews
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        columnWrapperStyle={styles.columnWrap}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore && hasMore ? (
            <View style={{ paddingVertical: 18, alignItems: "center" }}>
              <ActivityIndicator size="small" color={T.green} />
            </View>
          ) : !hasMore && pageItems.length > 0 ? (
            <View style={{ paddingVertical: 18, alignItems: "center" }}>
              <Text style={{ color: T.barkLight, fontSize: 12, fontWeight: "600" }}>
                You&apos;ve reached the end
              </Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          <>
            {/* Search bar (default, below fold) */}
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

            {/* Category strip */}
            <FlatList
              data={[
                { id: "all", name: "All", icon: "apps" },
                ...categoriesWithProducts,
              ]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.categoryStrip}
              renderItem={({ item, index }) => {
                const count =
                  item.id === "all"
                    ? totalCount
                    : getCountForCategoryName(categoryCounts, item.name);
                return (
                  <CategoryChip
                    item={item}
                    index={index}
                    count={count}
                    active={activeCategory === item.name}
                    onPress={() => handleSelectCategory(item.name)}
                  />
                );
              }}
            />

            {/* Section header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {activeCategory === "All" ? "All Products" : activeCategory}
              </Text>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionCount}>{activeCountLabel}</Text>
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons
                name={activeCategory === "All" || !location ? "store-off-outline" : "package-variant-closed"}
                size={40}
                color={T.green}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {!location
                ? "Set your location"
                : activeCategory === "All"
                  ? "No products found"
                  : `No products in ${activeCategory}`}
            </Text>
            <Text style={styles.emptyText}>
              {!location
                ? "We'll show you what's fresh and available nearby."
                : activeCategory === "All"
                  ? "No products available near you at the moment."
                  : `No products available in the ${activeCategory} category near you.`}
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
        }
        renderItem={({ item: p, index }) => {
          const cartItem = items.find((i) => i.product_id === p.id);
          return (
            <ProductCard
              p={p}
              index={index}
              cartItem={cartItem}
              onAdd={() =>
                addItem({
                  product_id: p.id,
                  name: p.name,
                  price: p.price,
                  unit: p.unit,
                  image_url: p.image_url,
                })
              }
              onUpdateQty={(qty) => updateQty(p.id, qty)}
            />
          );
        }}
      />

      {/* ── Cart CTA pill ─────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <Animated.View
          entering={FadeInUp.duration(340).springify()}
          style={styles.cartBar}
        >
          <Pressable
            onPress={() => router.push("/support/checkout")}
            style={({ pressed }) => [
              styles.cartPill,
              pressed && { opacity: 0.93 },
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
                View Cart · {totalQty} {totalQty === 1 ? "item" : "items"}
              </Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={18}
                color={T.white}
              />
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.cream },

  // ── Loading ──────────────────────────────────────────────────────────────
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  loadingIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  loadingText: {
    color: T.barkMid,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 20,
    letterSpacing: 0.2,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    backgroundColor: T.cream,
    zIndex: 20,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },

  // Delivery to… header block
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

  // Right actions: wallet + profile
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
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
  walletText: {
    fontSize: 13,
    fontWeight: "800",
    color: T.green,
  },

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

  // ── Sticky search ─────────────────────────────────────────────────────────
  stickySearch: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    paddingTop: 4,
  },
  headerRule: {
    height: 1,
    backgroundColor: "rgba(60,47,30,0.07)",
    marginHorizontal: 0,
  },

  // ── List ─────────────────────────────────────────────────────────────────
  listContent: {
    paddingBottom: 120,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  columnWrap: {
    justifyContent: "space-between",
    marginBottom: 14,
  },

  // ── Search bar ────────────────────────────────────────────────────────────
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    marginBottom: 6,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 3,
  },
  searchPill: {
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.9,
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

  // ── Category strip ────────────────────────────────────────────────────────
  categoryStrip: {
    paddingVertical: 18,
    paddingHorizontal: 2,
    gap: 12,
  },
  categoryChip: {
    alignItems: "center",
    gap: 7,
    width: 68,
  },
  categoryCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    overflow: "hidden",
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },
  categoryCircleActive: {
    backgroundColor: T.green,
    borderColor: T.green,
    shadowColor: T.green,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  categoryActiveRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 27,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  categoryImage: { width: "100%", height: "100%" },
  categoryCountBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: T.badge,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: T.white,
  },
  categoryCountText: {
    color: T.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  categoryLabel: {
    fontSize: 11,
    color: T.barkMid,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.1,
  },
  categoryLabelActive: {
    color: T.green,
    fontWeight: "800",
  },

  // ── Section header ────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 17,
    color: T.bark,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  sectionBadge: {
    backgroundColor: T.greenXLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.15)",
  },
  sectionCount: {
    fontSize: 12,
    color: T.green,
    fontWeight: "800",
  },

  // ── Product card ──────────────────────────────────────────────────────────
  cardOuter: {
    width: "48.5%",
  },
  card: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.cardBorder,
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 5,
  },
  cardOutOfStock: { opacity: 0.6 },
  imageWrap: { position: "relative", backgroundColor: T.sand },
  image: { width: "100%", height: 145, resizeMode: "cover" },
  imagePlaceholder: {
    width: "100%",
    height: 145,
    backgroundColor: T.sand,
    alignItems: "center",
    justifyContent: "center",
  },
  discountBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: T.badge,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  discountText: {
    color: T.white,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  outOfStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: T.white,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  cardBody: { padding: 11 },
  productName: {
    fontSize: 13.5,
    color: T.bark,
    lineHeight: 18,
    fontWeight: "700",
    minHeight: 36,
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    marginBottom: 2,
  },
  priceValue: {
    color: T.green,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  originalPrice: {
    color: T.barkLight,
    fontSize: 12.5,
    textDecorationLine: "line-through",
    fontWeight: "500",
  },
  priceUnit: {
    color: T.barkLight,
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 6,
  },
  ratingWrap: { marginBottom: 8 },

  addBtn: {
    borderRadius: 11,
    overflow: "hidden",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  addBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
  },
  addText: {
    fontSize: 13,
    color: T.white,
    fontWeight: "900",
    letterSpacing: 1,
  },
  soldOutBtn: {
    borderRadius: 11,
    paddingVertical: 10,
    backgroundColor: T.sand,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: T.cardBorder,
  },
  soldOutText: { color: T.barkLight, fontSize: 12.5, fontWeight: "700" },

  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: T.greenXLight,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(45,122,79,0.2)",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  qtyBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: T.green,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  qtyBtnText: { color: T.white, fontSize: 18, fontWeight: "900" },
  qtyValue: {
    color: T.bark,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 22,
    textAlign: "center",
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  empty: {
    marginTop: 56,
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
    bottom: 108,
    alignItems: "center",
    paddingHorizontal: 24,
    pointerEvents: "box-none",
  },
  cartPill: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 10,
  },
  cartPillGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 18,
    gap: 12,
  },
  cartQtyBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
  },
  cartQtyText: {
    color: T.white,
    fontSize: 13,
    fontWeight: "900",
  },
  cartPillLabel: {
    flex: 1,
    color: T.white,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  cartPillPrice: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    fontWeight: "700",
  },
});