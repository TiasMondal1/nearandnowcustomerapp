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
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import ProfileMenu from "../../components/ProfileMenu";
import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getAllCategories, type Category } from "../../lib/categoryService";
import { getAllProducts, type Product } from "../../lib/productService";

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

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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
      const [productsData, categoriesData] = await Promise.all([
        getAllProducts(
          loc ? { lat: loc.latitude, lng: loc.longitude } : undefined,
        ),
        getAllCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setProducts([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchData();
    });
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

  const categoriesForProducts = useMemo(() => {
    const categoryNames = new Set(
      products
        .map((p) => p.category?.trim())
        .filter((name): name is string => !!name)
        .map((name) => name.toLowerCase()),
    );
    return categories.filter((cat) =>
      categoryNames.has(cat.name?.toLowerCase() ?? ""),
    );
  }, [products, categories]);

  const profileScale = useSharedValue(1);
  const locationScale = useSharedValue(1);

  const profileAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: profileScale.value }],
  }));

  const locationAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: locationScale.value }],
  }));

  const handleScroll = useCallback(
    (event: any) => {
      const offsetY = event?.nativeEvent?.contentOffset?.y ?? 0;
      if (!hasScrolled && offsetY > 24) {
        setHasScrolled(true);
      } else if (hasScrolled && offsetY <= 24) {
        setHasScrolled(false);
      }
    },
    [hasScrolled],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Finding products near you…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View entering={FadeIn.duration(350)} style={styles.topWrap}>
        <LinearGradient
          colors={[C.primaryXLight, C.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.topGradient}
        />

        <Animated.View
          entering={FadeInDown.duration(420).springify()}
          style={styles.appHeader}
        >
          <View style={styles.appBranding}>
            <View style={styles.logoWrap}>
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

          <Animated.View style={profileAnimatedStyle}>
            <Pressable
              onPress={() => setShowProfileMenu(true)}
              onPressIn={() => {
                profileScale.value = withSpring(0.96, {
                  damping: 16,
                  stiffness: 220,
                });
              }}
              onPressOut={() => {
                profileScale.value = withSpring(1, {
                  damping: 16,
                  stiffness: 220,
                });
              }}
              style={styles.profileBtn}
            >
              <View style={styles.profileAvatar}>
                <MaterialCommunityIcons
                  name="account-outline"
                  size={22}
                  color="#fff"
                />
              </View>
            </Pressable>
          </Animated.View>
        </Animated.View>

        {!hasScrolled && (
          <Animated.View
            entering={FadeInDown.delay(90).duration(420).springify()}
            style={styles.locationBar}
          >
            <Animated.View style={locationAnimatedStyle}>
              <Pressable
                onPress={() => router.push("/location")}
                onPressIn={() => {
                  locationScale.value = withSpring(0.985, {
                    damping: 18,
                    stiffness: 220,
                  });
                }}
                onPressOut={() => {
                  locationScale.value = withSpring(1, {
                    damping: 18,
                    stiffness: 220,
                  });
                }}
                style={({ pressed }) => [
                  styles.locationPill,
                  pressed && { opacity: 0.92 },
                ]}
              >
                <View style={styles.locationIconWrap}>
                  <MaterialCommunityIcons
                    name="map-marker"
                    size={18}
                    color={C.primary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  {location ? (
                    <Text style={styles.locationTitle} numberOfLines={1}>
                      {location.address
                        ? `${(location.label || "Home").toUpperCase()} - ${location.address}`
                        : location.label || "Selected location"}
                    </Text>
                  ) : (
                    <Text style={styles.locationTitle} numberOfLines={1}>
                      Select your location
                    </Text>
                  )}
                </View>

                <View style={styles.locationChevronWrap}>
                  <MaterialCommunityIcons
                    name="chevron-down"
                    size={18}
                    color={C.textSub}
                  />
                </View>
              </Pressable>
            </Animated.View>
          </Animated.View>
        )}

        {hasScrolled && (
          <View style={styles.stickySearchContainer}>
            <TouchableOpacity
              style={styles.searchBar}
              activeOpacity={0.9}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color={C.textLight}
              />
              <Text style={styles.searchPlaceholder}>
                Search groceries, dairy, snacks…
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        removeClippedSubviews={true}
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
            <TouchableOpacity
              style={styles.searchBar}
              activeOpacity={0.85}
              onPress={() => router.push("../support/search")}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color={C.textLight}
              />
              <Text style={styles.searchPlaceholder}>
                Search groceries, dairy, snacks…
              </Text>
            </TouchableOpacity>

            <FlatList
              data={[{ id: "all", name: "All", icon: "apps" }, ...categoriesForProducts]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.categorySlider}
              renderItem={({ item, index }) => {
                const active = activeCategory === item.name;
                const icon =
                  item.icon ||
                  FALLBACK_ICONS[(index - 1) % FALLBACK_ICONS.length];

                return (
                  <TouchableOpacity
                    onPress={() => setActiveCategory(item.name)}
                    style={[
                      styles.categoryIcon,
                      active && styles.categoryIconActive,
                    ]}
                    activeOpacity={0.7}
                  >
                    {item.id === "all" || !item.image_url ? (
                      <View
                        style={[
                          styles.categoryIconCircle,
                          active && styles.categoryIconCircleActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={icon as any}
                          size={24}
                          color={active ? "#fff" : C.primary}
                        />
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.categoryIconCircle,
                          active && styles.categoryIconCircleActive,
                        ]}
                      >
                        <Image
                          source={{ uri: item.image_url }}
                          style={styles.categoryImage}
                        />
                      </View>
                    )}
                    <Text
                      style={[
                        styles.categoryLabel,
                        active && styles.categoryLabelActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <Text style={styles.sectionLabel}>
              {activeCategory === "All" ? "All Products" : activeCategory}
              <Text style={styles.productCount}>
                {" "}
                ({filteredProducts.length})
              </Text>
            </Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="store-off-outline"
              size={56}
              color={C.textLight}
            />
            <Text style={styles.emptyTitle}>
              {location ? "No products found" : "Set your location"}
            </Text>
            <Text style={styles.emptyText}>
              {location
                ? "No products match this category near you."
                : "We'll show you what's available nearby."}
            </Text>
            {!location && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push("/location")}
              >
                <Text style={styles.emptyBtnText}>Choose Location</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item: p }) => {
          const cartItem = items.find((i) => i.product_id === p.id);
          const hasDiscount =
            p.original_price != null && p.original_price > p.price;
          const discountPct = hasDiscount
            ? Math.round(
                ((p.original_price! - p.price) / p.original_price!) * 100,
              )
            : 0;

          return (
            <View style={[styles.card, !p.in_stock && styles.cardOutOfStock]}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push(`../product/${p.id}`)}
              >
                <View style={styles.imageWrap}>
                  {p.image_url ? (
                    <Image source={{ uri: p.image_url }} style={styles.image} />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <MaterialCommunityIcons
                        name="image-off-outline"
                        size={28}
                        color={C.textLight}
                      />
                    </View>
                  )}
                  {hasDiscount && (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountText}>
                        {discountPct}% OFF
                      </Text>
                    </View>
                  )}
                  {!p.in_stock && (
                    <View style={styles.outOfStockOverlay}>
                      <Text style={styles.outOfStockText}>Out of Stock</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.cardBody}>
                <Text style={styles.productName} numberOfLines={2}>
                  {p.name}
                </Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceValue}>₹{p.price}</Text>
                  {hasDiscount && (
                    <Text style={styles.originalPrice}>
                      ₹{p.original_price}
                    </Text>
                  )}
                  <Text style={styles.priceUnit}>/{p.unit}</Text>
                </View>

                {p.in_stock ? (
                  cartItem ? (
                    <View style={styles.qtyBox}>
                      <TouchableOpacity
                        style={styles.qtyBtnWrap}
                        onPress={() => updateQty(p.id, cartItem.quantity - 1)}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtnWrap}
                        onPress={() => updateQty(p.id, cartItem.quantity + 1)}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      activeOpacity={0.85}
                      onPress={() =>
                        addItem({
                          product_id: p.id,
                          name: p.name,
                          price: p.price,
                          unit: p.unit,
                          image_url: p.image_url,
                        })
                      }
                    >
                      <Text style={styles.addText}>ADD</Text>
                      <MaterialCommunityIcons
                        name="plus"
                        size={14}
                        color="#fff"
                      />
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
        }}
      />

      {items.length > 0 && (
        <Animated.View
          entering={FadeInUp.duration(320).springify()}
          style={styles.cartPillWrap}
        >
          <Pressable
            onPress={() => router.push("/cart")}
            style={({ pressed }) => [
              styles.cartPill,
              pressed && { opacity: 0.95 },
            ]}
          >
            <View style={styles.cartPillContent}>
              <Text style={styles.cartTitle} numberOfLines={1}>
                View cart
              </Text>
              <Text style={styles.cartSubtitle} numberOfLines={1}>
                {items.reduce((sum, it) => sum + it.quantity, 0)} item
                {items.reduce((sum, it) => sum + it.quantity, 0) === 1
                  ? ""
                  : "s"}
              </Text>
            </View>

            <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: C.textSub, fontSize: 14 },
  listContent: { paddingBottom: 100, paddingHorizontal: 16 },

  topWrap: {
    backgroundColor: C.card,
    // Smooth transition into the content below (no hard divider line)
    borderBottomWidth: 0,
    overflow: "visible",
  },
  topGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    // Keep edges aligned with the location pill (locationBar paddingHorizontal)
    paddingLeft: 20,
    paddingRight: 15,
    paddingTop: 5,
    paddingBottom: 5,
    backgroundColor: "transparent",
  },
  appBranding: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  appName: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
    letterSpacing: 0.3,
  },
  appTagline: {
    marginTop: 2,
    fontSize: 12,
    color: C.textSub,
    fontWeight: "600",
  },
  profileBtn: {
    padding: 4,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.primaryLight,
  },

  locationBar: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 12,
    backgroundColor: "transparent",
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  locationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  locationChevronWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  locationLabel: {
    fontSize: 11,
    color: C.textSub,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationTitle: {
    fontSize: 15,
    color: C.text,
    fontWeight: "800",
    marginTop: 1,
  },
  locationAddress: {
    fontSize: 12,
    color: C.textSub,
    fontWeight: "600",
    marginTop: 2,
    lineHeight: 16,
  },

  stickySearchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 4,
    backgroundColor: C.bg,
  },

  cartPillWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 112,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    pointerEvents: "box-none",
  },
  cartPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: C.info,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    maxWidth: 140,
  },
  cartPillContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cartTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  cartSubtitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
    textAlign: "center",
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  searchPlaceholder: { color: C.textLight, fontSize: 15, flex: 1 },

  categorySlider: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 16,
  },
  categoryIcon: {
    alignItems: "center",
    gap: 8,
    width: 72,
  },
  categoryIconActive: {},
  categoryIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.primaryLight,
    overflow: "hidden",
  },
  categoryIconCircleActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  categoryImage: {
    width: "100%",
    height: "100%",
  },
  categoryLabel: {
    fontSize: 12,
    color: C.textSub,
    fontWeight: "600",
    textAlign: "center",
  },
  categoryLabelActive: {
    color: C.primary,
    fontWeight: "800",
  },

  sectionLabel: {
    fontSize: 15,
    color: C.text,
    fontWeight: "800",
    marginBottom: 12,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  productCount: { color: C.textSub, fontWeight: "500" },

  columnWrap: { justifyContent: "space-between", marginBottom: 12 },

  card: {
    width: "48.5%",
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 4,
  },
  cardOutOfStock: { opacity: 0.65 },
  cardBody: { padding: 12 },

  imageWrap: { position: "relative", backgroundColor: C.bgSoft },
  image: { width: "100%", height: 140, resizeMode: "cover" },
  imagePlaceholder: {
    width: "100%",
    height: 140,
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
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  discountText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  outOfStockOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  productName: {
    fontSize: 14,
    color: C.text,
    lineHeight: 19,
    fontWeight: "600",
    minHeight: 38,
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  priceValue: {
    color: C.primary,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  originalPrice: {
    color: C.textLight,
    fontSize: 13,
    textDecorationLine: "line-through",
    fontWeight: "500",
  },
  priceUnit: { color: C.textSub, fontSize: 12, fontWeight: "500" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  addText: {
    fontSize: 13,
    color: "#fff",
    fontWeight: "900",
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
  soldOutText: { color: C.textSub, fontSize: 13, fontWeight: "700" },

  qtyBox: {
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
  qtyBtnWrap: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.primary,
  },
  qtyBtnText: { color: "#fff", fontSize: 18, fontWeight: "900" },
  qtyValue: {
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 24,
    textAlign: "center",
  },

  empty: {
    marginTop: 60,
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800", marginTop: 8 },
  emptyText: {
    color: C.textSub,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: C.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
