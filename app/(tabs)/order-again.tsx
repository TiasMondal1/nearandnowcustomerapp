import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FlatList,
    InteractionManager,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type PressableStateCallbackType,
} from "react-native";

import { IconWrap, PrimaryButton, Screen, Skeleton } from "../../components/ui";
import { C } from "../../constants/colors";
import {
    CATEGORY_GROUPS,
    DEFAULT_GROUP,
    getGroupForCategoryName,
} from "../../constants/categoryGroups";
import { HIT_SLOP, opacity } from "../../constants/ui";
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
  // Terracotta deal accent — mirrors C.deal in constants/colors.ts; deals only.
  deal: "#EA580C",
  greenXLight: "#EAF6EE",
  greenBorder: "rgba(45,122,79,0.15)",
  white: "#FFFFFF",
  bg: "#F7F6F2",
  bark: "#3C2F1E",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.07)",
  cardShadow: "rgba(0,0,0,0.06)",
};

// Extra reach for the compact ADD chip so the effective target clears 44pt.
const ADD_HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };
const SKELETON_CARDS = [0, 1, 2];
const SKELETON_CHIPS = [0, 1, 2, 3];

const cardPressStyle = ({ pressed }: PressableStateCallbackType) => [
  styles.pressFill,
  pressed && styles.pressed,
];

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
    onUpdateQty: (p: Product, delta: number) => void;
    width?: number;
  }) {
    const hasDiscount = p.original_price != null && p.original_price > p.price;
    const discountPct = hasDiscount
      ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
      : 0;

    const handleOpen = useCallback(() => { router.push(`/product/${p.id}` as any); }, [p.id]);
    const handleAdd = useCallback(() => onAdd(p), [onAdd, p]);
    const handleMinus = useCallback(() => onUpdateQty(p, -1), [onUpdateQty, p]);
    const handlePlus = useCallback(() => onUpdateQty(p, 1), [onUpdateQty, p]);

    return (
      <View style={[styles.card, width ? { width } : undefined]}>
        <Pressable
          onPress={handleOpen}
          style={cardPressStyle}
          accessibilityRole="button"
          accessibilityLabel={p.name}
        >
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
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={handleMinus}
                    hitSlop={HIT_SLOP}
                    activeOpacity={opacity.pressIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease quantity"
                  >
                    <MaterialCommunityIcons name="minus" size={14} color={T.white} />
                  </TouchableOpacity>
                  <Text style={styles.qtyVal}>{cartItem.quantity}</Text>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={handlePlus}
                    hitSlop={HIT_SLOP}
                    activeOpacity={opacity.pressIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Increase quantity"
                  >
                    <MaterialCommunityIcons name="plus" size={14} color={T.white} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={handleAdd}
                  hitSlop={ADD_HIT_SLOP}
                  activeOpacity={opacity.pressCta}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${p.name}`}
                >
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
    <Pressable
      style={({ pressed }) => [styles.card, width ? { width } : undefined, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Find ${item.name}`}
    >
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
      accessibilityRole="button"
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
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
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function OrderAgainScreen() {
  const { userId } = useAuth();
  const { addItem, incrementQty } = useCart();
  const cartItemsByProductId = useCartItemMap();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [allProducts, setAllProducts] = useState<Product[] | null>(() => {
    const mem = getMemoryHomeCache();
    return mem?.products ?? null;
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // "All Previously Bought" renders a growing window instead of mounting
  // every distinct previously-bought product's ProductCard at once — unlike
  // the sections above it (which already use tuned, virtualized horizontal
  // FlatLists), this section used a plain `.map()` inside the screen's
  // outer ScrollView, so a long-tenured customer's full product history
  // mounted (image + add/quantity controls each) simultaneously, on and
  // off screen, defeating virtualization entirely.
  const GRID_PAGE_SIZE = 24;
  const [gridVisibleCount, setGridVisibleCount] = useState(GRID_PAGE_SIZE);
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

  useEffect(() => { setGridVisibleCount(GRID_PAGE_SIZE); }, [displayItems]);

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
      addItem({ product_id: p.id, name: p.name, price: p.price, unit: p.unit, image_url: p.image_url, isLoose: p.isLoose }),
    [addItem],
  );
  const handleUpdateQty = useCallback(
    (p: Product, delta: number) => incrementQty(p.id, delta),
    [incrementQty],
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
      <Screen bg={T.bg} edges={["top"]}>
        <Header />
        <View style={styles.emptyWrap}>
          <IconWrap
            size={72}
            circle
            bg={T.greenXLight}
            icon="account-outline"
            iconSize={36}
            iconColor={T.green}
            style={styles.emptyIconWrap}
          />
          <Text style={styles.emptyTitle}>Sign in first</Text>
          <Text style={styles.emptyDesc}>Reorder your favourites in one tap once you&apos;re signed in.</Text>
          <PrimaryButton
            label="Sign in"
            onPress={() => router.push("/phone" as any)}
            fullWidth={false}
            shadow
            style={styles.emptyBtn}
            textStyle={styles.emptyBtnText}
          />
        </View>
      </Screen>
    );
  }

  if (loading && !orders) {
    return (
      <Screen bg={T.bg} edges={["top"]}>
        <Header />
        <View
          style={styles.skeletonWrap}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your order history…"
        >
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Skeleton width={150} height={16} color={T.cardBorder} />
              <Skeleton width={120} height={10} color={T.cardBorder} />
            </View>
            <View style={[styles.hList, styles.skeletonRow]}>
              {SKELETON_CARDS.map((i) => (
                <View key={i} style={[styles.card, styles.skeletonCard]}>
                  <View style={styles.imageWrap} />
                  <View style={styles.cardBody}>
                    <Skeleton width={40} height={10} color={T.cardBorder} />
                    <Skeleton width="100%" height={12} color={T.cardBorder} />
                    <Skeleton width="70%" height={12} color={T.cardBorder} />
                    <View style={styles.priceRow}>
                      <Skeleton width={44} height={14} color={T.cardBorder} />
                      <Skeleton width={52} height={30} radius={8} color={T.cardBorder} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Skeleton width={200} height={16} color={T.cardBorder} />
              <Skeleton width={80} height={10} color={T.cardBorder} />
            </View>
            <View style={[styles.hList, styles.skeletonRow]}>
              {SKELETON_CHIPS.map((i) => (
                <View key={i} style={styles.chip}>
                  <Skeleton width={96} height={80} radius={14} color={T.cardBorder} />
                  <Skeleton width={64} height={12} color={T.cardBorder} />
                  <Skeleton width={40} height={10} color={T.cardBorder} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  if (!loading && (orders?.length === 0 || displayItems.length === 0)) {
    return (
      <Screen bg={T.bg} edges={["top"]}>
        <Header />
        <View style={styles.emptyWrap}>
          <IconWrap
            size={72}
            circle
            bg={T.greenXLight}
            icon="basket-outline"
            iconSize={36}
            iconColor={T.green}
            style={styles.emptyIconWrap}
          />
          <Text style={styles.emptyTitle}>No past orders yet</Text>
          <Text style={styles.emptyDesc}>
            Place your first order and come back here to reorder in a tap.
          </Text>
          <PrimaryButton
            label="Start shopping"
            onPress={() => router.replace("/(tabs)/home" as any)}
            fullWidth={false}
            shadow
            style={styles.emptyBtn}
            textStyle={styles.emptyBtnText}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bg={T.bg} edges={["top"]}>
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
            {displayItems.slice(0, gridVisibleCount).map((it) => (
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
          {gridVisibleCount < displayItems.length && (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={() => setGridVisibleCount((c) => c + GRID_PAGE_SIZE)}
              activeOpacity={opacity.pressCta}
              accessibilityRole="button"
            >
              <Text style={styles.loadMoreText}>
                Load More ({displayItems.length - gridVisibleCount} remaining)
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom stamp */}
        <View style={styles.endRow}>
          <MaterialCommunityIcons name="history" size={14} color={T.barkLight} />
          <Text style={styles.endText}>That&apos;s everything you&apos;ve ordered</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
const Header = React.memo(function Header() {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle} accessibilityRole="header">Order Again</Text>
        <Text style={styles.headerSub}>Your favourites, one tap away</Text>
      </View>
      <IconWrap size={40} radius={12} bg={T.greenXLight} icon="history" iconSize={20} iconColor={T.green} />
    </View>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loadMoreBtn: {
    alignSelf: "center",
    marginTop: 16,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: T.green,
  },
  loadMoreText: { color: T.green, fontFamily: "PlusJakartaSans_700Bold", fontSize: 13 },

  // Header (shared tab-header spec with categories.tsx)
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  headerTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, color: T.bark, letterSpacing: -0.4 },
  headerSub: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, color: T.barkLight, marginTop: 2 },

  // Scroll
  scroll: { paddingBottom: 140 },

  // Loading skeleton — mirrors the first two section bands
  skeletonWrap: { flex: 1, overflow: "hidden" },
  skeletonRow: { flexDirection: "row" },
  skeletonCard: { width: 148 },

  // Empty / signed-out
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIconWrap: {
    borderWidth: 1.5,
    borderColor: T.greenBorder,
  },
  emptyTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, color: T.bark, letterSpacing: -0.2 },
  emptyDesc: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 14, color: T.barkLight, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: T.green,
    shadowColor: T.green,
    shadowOpacity: 0.18,
    elevation: 3,
  },
  emptyBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14 },

  // Error
  errorBanner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.dangerLight,
  },
  errorText: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.danger, flex: 1, fontSize: 13 },

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
    marginBottom: 16,
    gap: 4,
  },
  sectionTitle: { fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 17,
    color: T.bark,
    letterSpacing: -0.3,
  },
  sectionSubtitle: { fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 12,
    color: T.barkLight,
  },

  // Horizontal list
  hList: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },

  // Category chips
  chip: {
    width: 100,
    alignItems: "center",
    gap: 4,
  },
  chipPressed: { opacity: opacity.pressCard, transform: [{ scale: 0.97 }] },
  chipImgWrap: {
    width: 96,
    height: 80,
    borderRadius: 14,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 8,
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
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.cardBorder,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  chipBadgeText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 10, color: T.green },
  chipLabel: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 12,
    color: T.bark,
    textAlign: "center",
    lineHeight: 16,
  },
  chipCount: { fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 10,
    color: T.barkLight,
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
  pressFill: { flex: 1 },
  pressed: { opacity: 0.92 },
  imageWrap: {
    height: 120,
    backgroundColor: T.bg,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cardImage: { width: "100%", height: "100%" },
  discountBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: T.deal,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  discountBadgeText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: T.white, fontSize: 10, letterSpacing: 0.2 },
  cardBody: { padding: 10, gap: 4 },
  unitText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 10, color: T.barkLight },
  nameText: { fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 12,
    color: T.bark,
    lineHeight: 15,
    minHeight: 30,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  priceText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 13, color: T.bark, letterSpacing: -0.3 },
  oldPriceText: { fontFamily: "PlusJakartaSans_300Light",
    fontSize: 10,
    color: T.barkLight,
    textDecorationLine: "line-through",
    marginTop: 1,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: T.greenXLight,
    borderWidth: 1.5,
    borderColor: T.green,
    minWidth: 52,
    alignItems: "center",
  },
  addBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 11, color: T.green, letterSpacing: 0.8 },
  findBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: T.greenXLight,
    borderWidth: 1.5,
    borderColor: T.green,
    minWidth: 52,
    justifyContent: "center",
  },
  findBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 11, color: T.green, letterSpacing: 0.5 },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.green,
    borderRadius: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minWidth: 76,
    justifyContent: "space-between",
  },
  qtyBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  qtyVal: { fontFamily: "PlusJakartaSans_800ExtraBold", color: T.white, fontSize: 12, minWidth: 14, textAlign: "center" },

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
    paddingVertical: 24,
  },
  endText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: T.barkLight },
});
