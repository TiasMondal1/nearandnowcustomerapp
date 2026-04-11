import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  InteractionManager,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
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
import { getAllProducts, getAllProductsByCategory, type Product } from "../../lib/productService";

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
    <Animated.View
      entering={FadeInDown.delay(index * 40).duration(300)}
      style={[animStyle, styles.card, !p.in_stock && styles.cardOutOfStock]}
    >
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
  );
}

// ─── Category Chip ────────────────────────────────────────────────────────────
function CategoryChip({
  item,
  index,
  active,
  onPress,
}: {
  item: any;
  index: number;
  active: boolean;
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
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsByCategory, setProductsByCategory] = useState<Record<string, Product[]>>({});
  const [activeCategory, setActiveCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  const { location } = useLocation();
  const { addItem, items, updateQty } = useCart();

  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const loc = locationRef.current;
      const [productsData, categoriesData, productsByCategoryData] = await Promise.all([
        getAllProducts(
          loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
        ),
        getAllCategories(),
        getAllProductsByCategory(
          loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
        ),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
      setProductsByCategory(productsByCategoryData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setProducts([]);
      setCategories([]);
      setProductsByCategory({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => fetchData());
    return () => task.cancel();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  }, [fetchData]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "All") return products;
    return products.filter(
      (p) => p.category?.toLowerCase() === activeCategory.toLowerCase(),
    );
  }, [products, activeCategory]);

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
        {/* Warm gradient wash behind header */}
        <LinearGradient
          colors={[T.cream, "rgba(250,250,247,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* App bar row */}
        <Animated.View
          entering={FadeInDown.duration(420).springify()}
          style={styles.appBar}
        >
          {/* Logo + Name */}
          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <LinearGradient
                colors={[T.greenXLight, T.white]}
                style={StyleSheet.absoluteFillObject}
              />
              <Image
                source={require("../../Logo.png")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.appName}>Near & Now</Text>
              <Text style={styles.appTagline} numberOfLines={1}>
                Digital dukaan, local dil se
              </Text>
            </View>
          </View>

          {/* Profile button */}
          <Animated.View style={profileAnimatedStyle}>
            <Pressable
              onPressIn={() => {
                profileScale.value = withSpring(0.93, {
                  damping: 16,
                  stiffness: 260,
                });
              }}
              onPressOut={() => {
                profileScale.value = withSpring(1, {
                  damping: 16,
                  stiffness: 260,
                });
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
                <MaterialCommunityIcons
                  name="account-outline"
                  size={20}
                  color={T.white}
                />
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Animated.View>

        {/* Location pill */}
        {!hasScrolled && (
          <Animated.View
            entering={FadeInDown.delay(80).duration(400).springify()}
            style={styles.locationBar}
          >
            <Pressable
              onPress={() => router.push("/location")}
              style={({ pressed }) => [
                styles.locationPill,
                pressed && { opacity: 0.88 },
              ]}
            >
              <View style={styles.locationIconCircle}>
                <MaterialCommunityIcons
                  name="map-marker"
                  size={16}
                  color={T.green}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationTag}>DELIVERING TO</Text>
                <Text style={styles.locationText} numberOfLines={1}>
                  {location
                    ? location.address
                      ? `${(location.label || "Home").toUpperCase()} · ${location.address}`
                      : location.label || "Selected location"
                    : "Set your delivery location"}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-down"
                size={18}
                color={T.barkLight}
              />
            </Pressable>
          </Animated.View>
        )}

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
              <MaterialCommunityIcons
                name="magnify"
                size={19}
                color={T.barkLight}
              />
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
                ...categories,
              ]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.categoryStrip}
              renderItem={({ item, index }) => (
                <CategoryChip
                  item={item}
                  index={index}
                  active={activeCategory === item.name}
                  onPress={() => setActiveCategory(item.name)}
                />
              )}
            />

            {/* Section header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {activeCategory === "All" ? "All Products" : activeCategory}
              </Text>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionCount}>
                  {filteredProducts.length}
                </Text>
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
    paddingTop: 6,
    paddingBottom: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    flex: 1,
  },
  logoWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: T.greenXLight,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  logoImage: { width: 34, height: 34 },
  appName: {
    fontSize: 18,
    fontWeight: "800",
    color: T.bark,
    letterSpacing: -0.3,
  },
  appTagline: {
    fontSize: 11.5,
    color: T.barkLight,
    fontWeight: "600",
    marginTop: 1,
    letterSpacing: 0.15,
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

  // ── Location bar ─────────────────────────────────────────────────────────
  locationBar: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    paddingTop: 2,
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: T.white,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    shadowColor: T.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  locationIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  locationTag: {
    fontSize: 10,
    color: T.green,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  locationText: {
    fontSize: 13.5,
    color: T.bark,
    fontWeight: "700",
    marginTop: 1,
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
  card: {
    width: "48.5%",
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