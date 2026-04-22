import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    InteractionManager,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import {
    CATEGORY_GROUPS,
    DEFAULT_GROUP,
    getGroupForCategoryName,
} from "../../constants/categoryGroups";
import { useAuth } from "../../context/AuthContext";
import { useCart, useCartItemMap, type CartItem } from "../../context/CartContext";
import { cdnImage } from "../../lib/imageUrl";
import {
    buildOrderAgainItems,
    getUserOrders,
    readUserOrdersCache,
    type Order,
    type OrderAgainItem,
} from "../../lib/orderService";
import {
    getMemoryHomeCache,
    readHomeCatalogCache,
    type Product,
} from "../../lib/productService";

// ─── Design tokens (reused / aligned with home) ─────────────────────────────
const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bg: "#FAFAF7",
  sand: "#F3F1EB",
  bark: "#3C2F1E",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.08)",
  tile: "#F7F5EF",
};

/**
 * Unified "renderable" shape. Backed by either:
 *   • an order-item (`source`) that couldn't be matched in the live catalog
 *     (still renders with stored name / price / image so the user can see it), or
 *   • an order-item PLUS a live catalog Product (`product`) that gives us
 *     current price / discount / stock and is used to add to cart.
 *
 * Keeping both means the UI renders even before the catalog cache loads, and
 * doesn't go blank for items that were only found by `products.master_product_id`
 * server-side.
 */
interface DisplayItem {
  key: string;
  name: string;
  price: number;
  originalPrice?: number;
  image?: string;
  unit?: string;
  /** Category string used for chip grouping. Comes from catalog or fallback. */
  category: string;
  /** Present when we also have a matching live catalog row. */
  product?: Product;
  /** True when the product is currently purchasable (tied to cart ADD button). */
  purchasable: boolean;
  /** Stable id used for cart operations when `product` is missing. */
  addableId?: string;
  totalQty: number;
}

type CategoryChipDef = {
  name: string;
  count: number;
  imageUrl?: string;
};

// ─── Product card (full catalog row) ─────────────────────────────────────────
const ProductCard = React.memo(
  function ProductCard({
    p,
    cartItem,
    onAdd,
    onUpdateQty,
  }: {
    p: Product;
    cartItem: CartItem | undefined;
    onAdd: (p: Product) => void;
    onUpdateQty: (p: Product, qty: number) => void;
  }) {
    const hasDiscount = p.original_price != null && p.original_price > p.price;
    const discountPct = hasDiscount
      ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
      : 0;

    const handleOpen = useCallback(() => {
      router.push(`/product/${p.id}` as any);
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
      <View style={styles.card}>
        <Pressable onPress={handleOpen}>
          <View style={styles.imageWrap}>
            {p.image_url ? (
              <Image
                source={{ uri: cdnImage(p.image_url, 240) }}
                style={styles.cardImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
                recyclingKey={p.id}
                priority="low"
              />
            ) : (
              <MaterialCommunityIcons
                name="image-off-outline"
                size={28}
                color={T.barkLight}
              />
            )}
            {hasDiscount && (
              <View style={styles.discountFlag}>
                <Text style={styles.discountFlagText}>{discountPct}%</Text>
                <Text style={styles.discountFlagOff}>OFF</Text>
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.unit} numberOfLines={1}>
              {p.unit || ""}
            </Text>
            <Text style={styles.name} numberOfLines={2}>
              {p.name}
            </Text>
            <View style={styles.priceRow}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.price}>₹{p.price}</Text>
                {hasDiscount && (
                  <Text style={styles.oldPrice}>₹{p.original_price}</Text>
                )}
              </View>
              {cartItem ? (
                <View style={styles.qtyBox}>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={handleMinus}
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
                  activeOpacity={0.85}
                  onPress={handleAdd}
                >
                  <Text style={styles.addText}>ADD</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Pressable>
      </View>
    );
  },
  (prev, next) =>
    prev.p === next.p &&
    prev.cartItem === next.cartItem &&
    prev.onAdd === next.onAdd &&
    prev.onUpdateQty === next.onUpdateQty,
);

/**
 * Fallback card rendered when the catalog doesn't have a matching product (or
 * the catalog cache hasn't loaded yet). Shows the stored order-item info and
 * lets the user search for a live match.
 */
const LegacyItemCard = React.memo(function LegacyItemCard({
  item,
}: {
  item: DisplayItem;
}) {
  const onPress = useCallback(() => {
    router.push({
      pathname: "/support/search" as any,
      params: { q: item.name },
    });
  }, [item.name]);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.imageWrap}>
        {item.image ? (
          <Image
            source={{ uri: cdnImage(item.image, 240) }}
            style={styles.cardImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={item.key}
            priority="low"
          />
        ) : (
          <MaterialCommunityIcons
            name="image-off-outline"
            size={28}
            color={T.barkLight}
          />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.unit} numberOfLines={1}>
          {item.unit || ""}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{item.price}</Text>
          <View style={styles.findBtn}>
            <MaterialCommunityIcons
              name="magnify"
              size={13}
              color={T.green}
            />
            <Text style={styles.findText}>FIND</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

/** Group chip shown in "Frequently bought" / "More that you ordered". */
const GroupChip = React.memo(function GroupChip({
  title,
  count,
  sampleImages,
  onPress,
}: {
  title: string;
  count: number;
  sampleImages: (string | undefined)[];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chipOuter,
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
      ]}
    >
      <View style={styles.chipImageWrap}>
        <View style={styles.chipImageRow}>
          {sampleImages.slice(0, 2).map((src, i) =>
            src ? (
              <Image
                key={`${src}-${i}`}
                source={{ uri: cdnImage(src, 120) }}
                style={styles.chipImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
                priority="low"
              />
            ) : (
              <View key={`ph-${i}`} style={[styles.chipImage, styles.chipPh]}>
                <MaterialCommunityIcons
                  name="basket-outline"
                  size={18}
                  color={T.green}
                />
              </View>
            ),
          )}
        </View>
        {count > 2 && (
          <View style={styles.chipCountBadge}>
            <Text style={styles.chipCountText}>+{count - 2} more</Text>
          </View>
        )}
      </View>
      <Text style={styles.chipLabel} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
});

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function OrderAgainScreen() {
  const { userId } = useAuth();
  const { addItem, updateQty } = useCart();
  const cartItemsByProductId = useCartItemMap();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [allProducts, setAllProducts] = useState<Product[] | null>(() => {
    const mem = getMemoryHomeCache();
    return mem?.products ?? null;
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Product catalog (used to enrich order-items) ─────────────────────────
  useEffect(() => {
    if (allProducts) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await readHomeCatalogCache();
        if (!cancelled && cached?.products) setAllProducts(cached.products);
      } catch {
        /* cache read is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allProducts]);

  // ── Orders (SWR pattern) ──────────────────────────────────────────────────
  const fetchOrders = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      if (!userId) {
        setOrders([]);
        setLoading(false);
        return;
      }
      if (!opts?.isRefresh) setLoading(true);
      try {
        const data = await getUserOrders(userId);
        setOrders(data);
        setError(null);
      } catch (err) {
        console.warn("[OrderAgain] fetch failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your orders. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setOrders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await readUserOrdersCache(userId);
      if (cancelled) return;
      if (cached && cached.length > 0) {
        setOrders(cached);
        setLoading(false);
      }
    })();
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) fetchOrders();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [fetchOrders, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders({ isRefresh: true });
    setRefreshing(false);
  }, [fetchOrders]);

  // ── Build unified DisplayItems from orders + catalog ─────────────────────
  //
  // The list renders from `buildOrderAgainItems` FIRST (everything the
  // customer has ever bought, hydrated from `order_items`). For any item
  // whose `masterProductId` maps to a live catalog row we swap in the
  // catalog data for richer rendering (discount, original price) and more
  // importantly a cart-compatible id. Items without a catalog match still
  // render via the fallback card.
  const displayItems = useMemo<DisplayItem[]>(() => {
    if (!orders || orders.length === 0) return [];
    const orderItems = buildOrderAgainItems(orders);
    if (orderItems.length === 0) return [];

    const byMasterId = new Map<string, Product>();
    if (allProducts) for (const p of allProducts) byMasterId.set(p.id, p);

    const matchByName = (item: OrderAgainItem): Product | undefined => {
      if (!allProducts) return undefined;
      // Last-ditch name fuzzy match for legacy orders with no master_product_id.
      // We compare on lowercased/trimmed name; if multiple products share a
      // name we prefer the one whose unit also matches.
      const nameKey = (item.name || "").trim().toLowerCase();
      if (!nameKey) return undefined;
      const unitKey = (item.unit || "").trim().toLowerCase();
      let fallback: Product | undefined;
      for (const p of allProducts) {
        if ((p.name || "").trim().toLowerCase() !== nameKey) continue;
        if (!unitKey) return p;
        if ((p.unit || "").trim().toLowerCase() === unitKey) return p;
        fallback = fallback || p;
      }
      return fallback;
    };

    const out: DisplayItem[] = [];
    for (const it of orderItems) {
      const catalog =
        (it.masterProductId && byMasterId.get(it.masterProductId)) ||
        matchByName(it);

      if (catalog) {
        out.push({
          key: `c:${catalog.id}`,
          name: catalog.name,
          price: catalog.price,
          originalPrice: catalog.original_price,
          image: catalog.image_url,
          unit: catalog.unit,
          category: catalog.category || "Others",
          product: catalog,
          purchasable: true,
          addableId: catalog.id,
          totalQty: it.totalQty,
        });
      } else {
        out.push({
          key: it.key,
          name: it.name,
          price: it.price,
          image: it.image,
          unit: it.unit,
          // Without a catalog match we can't reliably bucket the item, so it
          // falls into "Others" and lands in the "More" group chip.
          category: "Others",
          purchasable: false,
          totalQty: it.totalQty,
        });
      }
    }
    return out;
  }, [orders, allProducts]);

  // Items grouped by raw category (used for chip rendering + carousels).
  const itemsByCategory = useMemo<Record<string, DisplayItem[]>>(() => {
    const out: Record<string, DisplayItem[]> = {};
    for (const it of displayItems) {
      (out[it.category] ||= []).push(it);
    }
    return out;
  }, [displayItems]);

  // Bucket categories → top-level groups for section headers and chips.
  const { chips, itemsByGroup } = useMemo(() => {
    const chips: CategoryChipDef[] = [];
    const byGroup: Record<string, DisplayItem[]> = {};

    const allGroupOrder = [...CATEGORY_GROUPS, DEFAULT_GROUP].map((g) => g.id);
    const categoriesByGroup = new Map<string, string[]>();

    for (const cat of Object.keys(itemsByCategory)) {
      const grp = getGroupForCategoryName(cat);
      const list = categoriesByGroup.get(grp.id) || [];
      list.push(cat);
      categoriesByGroup.set(grp.id, list);
    }

    for (const gid of allGroupOrder) {
      const cats = categoriesByGroup.get(gid);
      if (!cats) continue;
      const groupItems: DisplayItem[] = [];
      for (const cat of cats) {
        const list = itemsByCategory[cat] || [];
        groupItems.push(...list);
        chips.push({
          name: cat,
          count: list.length,
          imageUrl: list[0]?.image,
        });
      }
      byGroup[gid] = groupItems;
    }

    return { chips, itemsByGroup: byGroup };
  }, [itemsByCategory]);

  // Blinkit-style: first 6 chips are the hero grid.
  const primaryChips = chips.slice(0, 6);
  const secondaryChips = chips.slice(6);

  // Handlers
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

  const handleChipPress = useCallback((chip: CategoryChipDef) => {
    const slug = chip.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    router.push(`/category/${slug}` as any);
  }, []);

  const renderDisplayItem = useCallback(
    ({ item }: { item: DisplayItem }) =>
      item.product ? (
        <ProductCard
          p={item.product}
          cartItem={cartItemsByProductId.get(item.product.id)}
          onAdd={handleAdd}
          onUpdateQty={handleUpdateQty}
        />
      ) : (
        <LegacyItemCard item={item} />
      ),
    [cartItemsByProductId, handleAdd, handleUpdateQty],
  );

  const keyExtractor = useCallback((item: DisplayItem) => item.key, []);

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!userId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <HeaderBlock />
        <View style={styles.centerEmpty}>
          <MaterialCommunityIcons
            name="account-outline"
            size={64}
            color={T.barkLight}
          />
          <Text style={styles.emptyTitle}>Sign in to see your orders</Text>
          <Text style={styles.emptyText}>
            Reorder your favourites in one tap once you&apos;re signed in.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push("/phone" as any)}
          >
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !orders) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <HeaderBlock />
        <View style={styles.centerEmpty}>
          <ActivityIndicator size="large" color={T.green} />
          <Text style={styles.emptyText}>Loading your order history…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!loading && (orders?.length === 0 || displayItems.length === 0)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <HeaderBlock />
        <View style={styles.centerEmpty}>
          <MaterialCommunityIcons
            name="basket-outline"
            size={64}
            color={T.barkLight}
          />
          <Text style={styles.emptyTitle}>No past orders yet</Text>
          <Text style={styles.emptyText}>
            Once you place your first order, come back here to reorder in a tap.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace("/(tabs)/home" as any)}
          >
            <Text style={styles.primaryBtnText}>Start shopping</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render full "Order Again" screen ─────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <HeaderBlock />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.green}
            colors={[T.green]}
          />
        }
      >
        {error && !orders?.length ? (
          <View style={styles.errorCard}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={24}
              color={C.danger}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {primaryChips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently bought</Text>
            <View style={styles.chipGrid}>
              {primaryChips.map((chip) => {
                const items = itemsByCategory[chip.name] || [];
                const sampleImages = items.map((p) => p.image);
                return (
                  <GroupChip
                    key={chip.name}
                    title={chip.name}
                    count={chip.count}
                    sampleImages={sampleImages}
                    onPress={() => handleChipPress(chip)}
                  />
                );
              })}
            </View>
          </View>
        )}

        {secondaryChips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>More that you ordered</Text>
            <View style={styles.chipGrid}>
              {secondaryChips.map((chip) => {
                const items = itemsByCategory[chip.name] || [];
                const sampleImages = items.map((p) => p.image);
                return (
                  <GroupChip
                    key={chip.name}
                    title={chip.name}
                    count={chip.count}
                    sampleImages={sampleImages}
                    onPress={() => handleChipPress(chip)}
                  />
                );
              })}
            </View>
          </View>
        )}

        {/* Per-group horizontal carousels */}
        {[...CATEGORY_GROUPS, DEFAULT_GROUP].map((g) => {
          const items = itemsByGroup[g.id];
          if (!items || items.length === 0) return null;
          return (
            <View key={g.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{g.title}</Text>
              <FlatList
                data={items.slice(0, 12)}
                keyExtractor={keyExtractor}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hListContent}
                renderItem={renderDisplayItem}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
                removeClippedSubviews
              />
            </View>
          );
        })}

        {/* Full "Previously Bought" grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Previously Bought</Text>
          <View style={styles.grid}>
            {displayItems.map((it) => (
              <View key={it.key} style={styles.gridCell}>
                {it.product ? (
                  <ProductCard
                    p={it.product}
                    cartItem={cartItemsByProductId.get(it.product.id)}
                    onAdd={handleAdd}
                    onUpdateQty={handleUpdateQty}
                  />
                ) : (
                  <LegacyItemCard item={it} />
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────
const HeaderBlock = React.memo(function HeaderBlock() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Order Again</Text>
      <Text style={styles.headerSub}>Pick up where you left off</Text>
    </View>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },

  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  headerTitle: {
    fontSize: 22,
    color: T.bark,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  headerSub: { fontSize: 13, color: T.barkLight, marginTop: 3 },

  scrollContent: { paddingBottom: 130, paddingTop: 4 },

  centerEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  emptyTitle: {
    color: T.bark,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 6,
  },
  emptyText: {
    color: T.barkLight,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.green,
  },
  primaryBtnText: { color: T.white, fontWeight: "800", fontSize: 14 },

  errorCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.dangerLight,
  },
  errorText: { color: C.danger, flex: 1, fontSize: 13, fontWeight: "600" },

  section: { marginTop: 20, paddingHorizontal: 14 },
  sectionTitle: {
    fontSize: 17,
    color: T.bark,
    fontWeight: "900",
    letterSpacing: -0.2,
    marginBottom: 10,
    paddingHorizontal: 4,
  },

  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chipOuter: {
    width: "33.33%",
    padding: 4,
    alignItems: "center",
  },
  chipImageWrap: {
    width: "100%",
    aspectRatio: 1.1,
    borderRadius: 14,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 8,
  },
  chipImageRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  chipImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: T.white,
  },
  chipPh: { alignItems: "center", justifyContent: "center" },
  chipCountBadge: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  chipCountText: { color: T.green, fontSize: 10, fontWeight: "800" },
  chipLabel: {
    marginTop: 6,
    fontSize: 12,
    color: T.bark,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 15,
  },

  hListContent: { paddingHorizontal: 4, gap: 10, paddingVertical: 4 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gridCell: {
    width: "33.33%",
    padding: 4,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    width: 140,
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    height: 100,
    backgroundColor: T.tile,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cardImage: { width: "100%", height: "100%" },
  discountFlag: {
    position: "absolute",
    top: 0,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: T.green,
    borderBottomRightRadius: 8,
  },
  discountFlagText: {
    color: T.white,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 11,
  },
  discountFlagOff: {
    color: T.white,
    fontSize: 7.5,
    fontWeight: "800",
    lineHeight: 9,
  },
  cardBody: { padding: 8 },
  unit: {
    fontSize: 10,
    color: T.barkLight,
    fontWeight: "700",
    marginBottom: 3,
  },
  name: {
    fontSize: 12,
    color: T.bark,
    lineHeight: 14.5,
    fontWeight: "700",
    minHeight: 29,
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  price: {
    color: T.bark,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  oldPrice: {
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
  addText: {
    fontSize: 11.5,
    color: T.green,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  findBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.green,
    backgroundColor: T.greenXLight,
    minWidth: 46,
    justifyContent: "center",
  },
  findText: {
    fontSize: 11,
    color: T.green,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.green,
    borderRadius: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minWidth: 68,
    justifyContent: "space-between",
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
});
