import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
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

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bg: "#F7F6F2",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.07)",
  cardShadow: "rgba(0,0,0,0.06)",
};

// ─── Interfaces ────────────────────────────────────────────────────────────────
interface DisplayItem {
  key: string;
  name: string;
  price: number;
  originalPrice?: number;
  image?: string;
  unit?: string;
  category: string;
  product?: Product;
  purchasable: boolean;
  addableId?: string;
  totalQty: number;
}

type CategoryChipDef = {
  name: string;
  count: number;
  imageUrl?: string;
};

// ─── Product Card ─────────────────────────────────────────────────────────────
const ProductCard = React.memo(
  function ProductCard({
    p,
    cartItem,
    onAdd,
    onUpdateQty,
    width,
  }: {
    p: Product;
    cartItem: CartItem | undefined;
    onAdd: (p: Product) => void;
    onUpdateQty: (p: Product, qty: number) => void;
    width?: number;
  }) {
    const hasDiscount = p.original_price != null && p.original_price > p.price;
    const discountPct = hasDiscount
      ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
      : 0;

    const handleOpen = useCallback(() => { router.push(`/product/${p.id}` as any); }, [p.id]);
    const handleAdd = useCallback(() => onAdd(p), [onAdd, p]);
    const handleMinus = useCallback(() => onUpdateQty(p, (cartItem?.quantity ?? 1) - 1), [onUpdateQty, p, cartItem?.quantity]);
    const handlePlus = useCallback(() => onUpdateQty(p, (cartItem?.quantity ?? 0) + 1), [onUpdateQty, p, cartItem?.quantity]);

    return (
      <View style={[styles.card, width ? { width } : undefined]}>
        <Pressable onPress={handleOpen} style={{ flex: 1 }}>
          <View style={styles.imageWrap}>
            {p.image_url ? (
              <Image
                source={{ uri: cdnImage(p.image_url, 280) }}
                style={styles.cardImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
                recyclingKey={p.id}
                priority="low"
              />
            ) : (
              <MaterialCommunityIcons name="image-off-outline" size={30} color={T.barkLight} />
            )}
            {hasDiscount && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountBadgeText}>{discountPct}% OFF</Text>
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            {p.unit ? <Text style={styles.unitText} numberOfLines={1}>{p.unit}</Text> : null}
            <Text style={styles.nameText} numberOfLines={2}>{p.name}</Text>
            <View style={styles.priceRow}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.priceText}>₹{p.price}</Text>
                {hasDiscount && (
                  <Text style={styles.oldPriceText}>₹{p.original_price}</Text>
                )}
              </View>
              {cartItem ? (
                <View style={styles.qtyBox}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={handleMinus} hitSlop={6}>
                    <MaterialCommunityIcons name="minus" size={12} color={T.white} />
                  </TouchableOpacity>
                  <Text style={styles.qtyVal}>{cartItem.quantity}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={handlePlus} hitSlop={6}>
                    <MaterialCommunityIcons name="plus" size={12} color={T.white} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addBtn} onPress={handleAdd} activeOpacity={0.85}>
                  <Text style={styles.addBtnText}>ADD</Text>
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
    prev.onUpdateQty === next.onUpdateQty &&
    prev.width === next.width,
);

const LegacyItemCard = React.memo(function LegacyItemCard({
  item,
  width,
}: {
  item: DisplayItem;
  width?: number;
}) {
  const onPress = useCallback(() => {
    router.push({ pathname: "/support/search" as any, params: { q: item.name } });
  }, [item.name]);

  return (
    <Pressable style={[styles.card, width ? { width } : undefined]} onPress={onPress}>
      <View style={styles.imageWrap}>
        {item.image ? (
          <Image
            source={{ uri: cdnImage(item.image, 280) }}
            style={styles.cardImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={item.key}
            priority="low"
          />
        ) : (
          <MaterialCommunityIcons name="image-off-outline" size={30} color={T.barkLight} />
        )}
      </View>
      <View style={styles.cardBody}>
        {item.unit ? <Text style={styles.unitText} numberOfLines={1}>{item.unit}</Text> : null}
        <Text style={styles.nameText} numberOfLines={2}>{item.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.priceText}>₹{item.price}</Text>
          <View style={styles.findBtn}>
            <MaterialCommunityIcons name="magnify" size={12} color={T.green} />
            <Text style={styles.findBtnText}>FIND</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

// ─── Category chip ────────────────────────────────────────────────────────────
const CategoryChip = React.memo(function CategoryChip({
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
        styles.chip,
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={styles.chipImgWrap}>
        <View style={styles.chipImgRow}>
          {sampleImages.slice(0, 2).map((src, i) =>
            src ? (
              <Image
                key={`${src}-${i}`}
                source={{ uri: cdnImage(src, 120) }}
                style={styles.chipImg}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={100}
                priority="low"
              />
            ) : (
              <View key={`ph-${i}`} style={[styles.chipImg, { alignItems: "center", justifyContent: "center" }]}>
                <MaterialCommunityIcons name="basket-outline" size={16} color={T.green} />
              </View>
            ),
          )}
        </View>
        {count > 2 && (
          <View style={styles.chipBadge}>
            <Text style={styles.chipBadgeText}>+{count - 2}</Text>
          </View>
        )}
      </View>
      <Text style={styles.chipLabel} numberOfLines={2}>{title}</Text>
      <Text style={styles.chipCount}>{count} item{count !== 1 ? "s" : ""}</Text>
    </Pressable>
  );
});

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

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

  // ── Product catalog ─────────────────────────────────────────────────────
  useEffect(() => {
    if (allProducts) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await readHomeCatalogCache();
        if (!cancelled && cached?.products) setAllProducts(cached.products);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [allProducts]);

  // ── Orders (SWR) ────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async (opts?: { isRefresh?: boolean }) => {
    if (!userId) { setOrders([]); setLoading(false); return; }
    if (!opts?.isRefresh) setLoading(true);
    try {
      const data = await getUserOrders(userId);
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your orders.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); setOrders([]); return; }
    let cancelled = false;
    (async () => {
      const cached = await readUserOrdersCache(userId);
      if (cancelled) return;
      if (cached && cached.length > 0) { setOrders(cached); setLoading(false); }
    })();
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) fetchOrders();
    });
    return () => { cancelled = true; task.cancel(); };
  }, [fetchOrders, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders({ isRefresh: true });
    setRefreshing(false);
  }, [fetchOrders]);

  // ── Build DisplayItems — deduplicated by catalog.id ─────────────────────
  const displayItems = useMemo<DisplayItem[]>(() => {
    if (!orders || orders.length === 0) return [];
    const orderItems = buildOrderAgainItems(orders);
    if (orderItems.length === 0) return [];
    const byMasterId = new Map<string, Product>();
    if (allProducts) for (const p of allProducts) byMasterId.set(p.id, p);

    const matchByName = (item: OrderAgainItem): Product | undefined => {
      if (!allProducts) return undefined;
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

    const seenCatalogIds = new Map<string, number>();
    const out: DisplayItem[] = [];

    for (const it of orderItems) {
      const catalog = (it.masterProductId && byMasterId.get(it.masterProductId)) || matchByName(it);
      if (catalog) {
        const existingIdx = seenCatalogIds.get(catalog.id);
        if (existingIdx !== undefined) {
          out[existingIdx].totalQty += it.totalQty;
          continue;
        }
        seenCatalogIds.set(catalog.id, out.length);
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
          category: "Others",
          purchasable: false,
          totalQty: it.totalQty,
        });
      }
    }
    return out;
  }, [orders, allProducts]);

  // Top items sorted by how often they were ordered
  const topItems = useMemo(
    () => [...displayItems].sort((a, b) => b.totalQty - a.totalQty).slice(0, 16),
    [displayItems],
  );

  const itemsByCategory = useMemo<Record<string, DisplayItem[]>>(() => {
    const out: Record<string, DisplayItem[]> = {};
    for (const it of displayItems) (out[it.category] ||= []).push(it);
    return out;
  }, [displayItems]);

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
        chips.push({ name: cat, count: list.length, imageUrl: list[0]?.image });
      }
      byGroup[gid] = groupItems;
    }
    return { chips, itemsByGroup: byGroup };
  }, [itemsByCategory]);

  const handleAdd = useCallback(
    (p: Product) =>
      addItem({ product_id: p.id, name: p.name, price: p.price, unit: p.unit, image_url: p.image_url }),
    [addItem],
  );
  const handleUpdateQty = useCallback(
    (p: Product, qty: number) => updateQty(p.id, qty),
    [updateQty],
  );
  const handleChipPress = useCallback((chip: CategoryChipDef) => {
    const slug = chip.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    router.push(`/category/${slug}` as any);
  }, []);

  const renderTopItem = useCallback(
    ({ item }: { item: DisplayItem }) =>
      item.product ? (
        <ProductCard
          p={item.product}
          cartItem={cartItemsByProductId.get(item.product.id)}
          onAdd={handleAdd}
          onUpdateQty={handleUpdateQty}
          width={148}
        />
      ) : (
        <LegacyItemCard item={item} width={148} />
      ),
    [cartItemsByProductId, handleAdd, handleUpdateQty],
  );

  const renderGroupItem = useCallback(
    ({ item }: { item: DisplayItem }) =>
      item.product ? (
        <ProductCard
          p={item.product}
          cartItem={cartItemsByProductId.get(item.product.id)}
          onAdd={handleAdd}
          onUpdateQty={handleUpdateQty}
          width={140}
        />
      ) : (
        <LegacyItemCard item={item} width={140} />
      ),
    [cartItemsByProductId, handleAdd, handleUpdateQty],
  );

  const keyExtractor = useCallback((item: DisplayItem) => item.key, []);

  // ── States ────────────────────────────────────────────────────────────────
  if (!userId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header />
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons name="account-outline" size={36} color={T.green} />
          </View>
          <Text style={styles.emptyTitle}>Sign in first</Text>
          <Text style={styles.emptyDesc}>Reorder your favourites in one tap once you're signed in.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/phone" as any)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !orders) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header />
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="large" color={T.green} />
          <Text style={styles.emptyDesc}>Loading your order history…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!loading && (orders?.length === 0 || displayItems.length === 0)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header />
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons name="basket-outline" size={36} color={T.green} />
          </View>
          <Text style={styles.emptyTitle}>No past orders yet</Text>
          <Text style={styles.emptyDesc}>
            Place your first order and come back here to reorder in a tap.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.replace("/(tabs)/home" as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>Start shopping</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.green} colors={[T.green]} />
        }
      >
        {error ? (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={C.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Previously Ordered ─────────────────────────────────────── */}
        {topItems.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Previously Ordered"
              subtitle="Your go-to items, ready to add"
            />
            <FlatList
              data={topItems}
              keyExtractor={keyExtractor}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hList}
              renderItem={renderTopItem}
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              windowSize={3}
              removeClippedSubviews
            />
          </View>
        )}

        {/* ── Categories you ordered from ───────────────────────────── */}
        {chips.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Categories you ordered from"
              subtitle={`${chips.length} categor${chips.length !== 1 ? "ies" : "y"}`}
            />
            <FlatList
              data={chips}
              keyExtractor={(c) => c.name}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hList}
              renderItem={({ item: chip }) => (
                <CategoryChip
                  title={chip.name}
                  count={chip.count}
                  sampleImages={(itemsByCategory[chip.name] || []).map((p) => p.image)}
                  onPress={() => handleChipPress(chip)}
                />
              )}
              initialNumToRender={5}
            />
          </View>
        )}

        {/* ── Per-group carousels ───────────────────────────────────── */}
        {[...CATEGORY_GROUPS, DEFAULT_GROUP].map((g) => {
          const items = itemsByGroup[g.id];
          if (!items || items.length === 0) return null;
          return (
            <View key={g.id} style={styles.section}>
              <SectionHeader title={g.title} />
              <FlatList
                data={items.slice(0, 12)}
                keyExtractor={keyExtractor}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hList}
                renderItem={renderGroupItem}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
                removeClippedSubviews
              />
            </View>
          );
        })}

        {/* ── Full grid of all previously bought ───────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="All Previously Bought"
            subtitle={`${displayItems.length} item${displayItems.length !== 1 ? "s" : ""}`}
          />
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

        {/* Bottom stamp */}
        <View style={styles.endRow}>
          <MaterialCommunityIcons name="history" size={13} color={T.barkLight} />
          <Text style={styles.endText}>That's everything you've ordered</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
const Header = React.memo(function Header() {
  return (
    <LinearGradient
      colors={[T.white, "#F0F9F4"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <View>
        <Text style={styles.headerTitle}>Order Again</Text>
        <Text style={styles.headerSub}>Your favourites, one tap away</Text>
      </View>
      <View style={styles.headerBadge}>
        <MaterialCommunityIcons name="history" size={20} color={T.green} />
      </View>
    </LinearGradient>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  headerTitle: { fontSize: 22, fontWeight: "900", color: T.bark, letterSpacing: -0.4 },
  headerSub: { fontSize: 13, color: T.barkLight, fontWeight: "500", marginTop: 2 },
  headerBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.15)",
  },

  // Scroll
  scroll: { paddingBottom: 140 },

  // Empty / loading
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: T.bark, letterSpacing: -0.2 },
  emptyDesc: { fontSize: 14, color: T.barkLight, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: T.green,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  emptyBtnText: { color: T.white, fontWeight: "800", fontSize: 14 },

  // Error
  errorBanner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.dangerLight,
  },
  errorText: { color: C.danger, flex: 1, fontSize: 13, fontWeight: "600" },

  // Section
  section: {
    paddingTop: 20,
    paddingBottom: 6,
    backgroundColor: T.white,
    borderTopWidth: 8,
    borderTopColor: T.bg,
  },
  sectionHeaderRow: {
    paddingHorizontal: 16,
    marginBottom: 14,
    gap: 3,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: T.bark,
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "500",
  },

  // Horizontal list
  hList: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
  },

  // Category chips
  chip: {
    width: 100,
    alignItems: "center",
    gap: 5,
  },
  chipImgWrap: {
    width: 96,
    height: 80,
    borderRadius: 14,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 6,
    position: "relative",
  },
  chipImgRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  chipImg: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: T.white,
  },
  chipBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  chipBadgeText: { fontSize: 9, fontWeight: "900", color: T.green },
  chipLabel: {
    fontSize: 11.5,
    color: T.bark,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
  },
  chipCount: {
    fontSize: 10,
    color: T.barkLight,
    fontWeight: "600",
  },

  // Product card
  card: {
    backgroundColor: T.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: "hidden",
    shadowColor: T.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  imageWrap: {
    height: 120,
    backgroundColor: T.white,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cardImage: { width: "100%", height: "100%" },
  discountBadge: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: T.green,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 14,
  },
  discountBadgeText: { color: T.white, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.2 },
  cardBody: { padding: 9, gap: 3 },
  unitText: { fontSize: 10, color: T.barkLight, fontWeight: "700" },
  nameText: {
    fontSize: 12,
    color: T.bark,
    fontWeight: "700",
    lineHeight: 15,
    minHeight: 30,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  priceText: { fontSize: 13, color: T.bark, fontWeight: "900", letterSpacing: -0.3 },
  oldPriceText: {
    fontSize: 10,
    color: T.barkLight,
    textDecorationLine: "line-through",
    marginTop: 1,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.greenXLight,
    borderWidth: 1.5,
    borderColor: T.green,
    minWidth: 46,
    alignItems: "center",
  },
  addBtnText: { fontSize: 11, color: T.green, fontWeight: "900", letterSpacing: 0.8 },
  findBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.greenXLight,
    borderWidth: 1.5,
    borderColor: T.green,
    minWidth: 46,
    justifyContent: "center",
  },
  findBtnText: { fontSize: 11, color: T.green, fontWeight: "900", letterSpacing: 0.5 },
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
  },
  qtyVal: { color: T.white, fontSize: 12, fontWeight: "900", minWidth: 14, textAlign: "center" },

  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  gridCell: { width: "50%", padding: 6 },

  // End
  endRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 20,
  },
  endText: { fontSize: 12, color: T.barkLight, fontWeight: "600" },
});
