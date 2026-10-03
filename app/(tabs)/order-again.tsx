// codename: vega
// Order again — one vertical FlashList (W2-order-again · CONTRACTS §4.9/§4.11/§3.1/§2.17 · design/blinkit-parity §3.3,
// BP-05, BP-11, BP-21 · speed-and-ease 14 / 19). Item kinds: hero (TabHeader) · lastOrder ("Your last order · Add all")
// · chips (category filter strip with thumbs) · group (scope header + "See all") · gridRow (two ProductCard grid cells)
// · legacy (an item that left the catalog → quiet "Find similar" row) · end ("Show more" paging or the end stamp) ·
// empty (no history / error, both on EmptyState). Data: memory/disk order seed → getUserOrders (cached 20 s, deduped
// with Home) after interactions; the catalog comes from the Home cache (memory, then disk) and is matched by master id
// first, then by a name index built once per catalog identity; category slugs resolve from the cached categories
// (MAP C15) so "See all" never 404s. Feedback: Add all → cartActions.addMany silent + ONE feedback.add() + a toast
// with Undo (silent); chips → Chip's own select haptic; pull-to-refresh → tapSound; everything that only navigates is
// silent. Nothing here subscribes to the whole cart — each ProductCard's Stepper subscribes to its own quantity.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  InteractionManager,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItemInfo as RailRenderItemInfo,
} from "react-native";

import {
  Chip,
  EmptyState,
  notify,
  PressableScale,
  PrimaryButton,
  ProductCard,
  Screen,
  Skeleton,
  SkeletonProductCard,
  SkeletonScreen,
  TabHeader,
  useCartBarFootprint,
} from "../../components/ui";
import { CATEGORY_GROUPS, DEFAULT_GROUP, getGroupForCategoryName } from "../../constants/categoryGroups";
import { C } from "../../constants/colors";
import { fontFamily, HIT_SLOP, layout, motion, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { cartActions, getCartSnapshot } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { useProfileMenu } from "../../context/ProfileMenuContext";
import { useRefetchOnReconnect } from "../../hooks/useRefetchOnReconnect";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { getAllCategories, peekCategories, resolveCategorySlug, type Category } from "../../lib/categoryService";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { cdnImage } from "../../lib/imageUrl";
import { logSilentFailure } from "../../lib/logSilentFailure";
import {
  buildOrderAgainItems,
  buildReorderItems,
  getMemoryOrders,
  getUserOrders,
  readUserOrdersCache,
  type Order,
  type OrderAgainItem,
  type ReorderItem,
} from "../../lib/orderService";
import {
  getCachedProduct,
  getMemoryHomeCache,
  readHomeCatalogCache,
  type HomeCatalogCache,
  type Product,
} from "../../lib/productService";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The grid renders a growing window instead of mounting every distinct previously-bought product at once: a
 * long-tenured customer's full history would otherwise mount hundreds of image cards (MAP P10). FlashList
 * virtualises what is in the window; the window itself grows by "Show more".
 */
const GRID_PAGE_SIZE = 24;
/** Legacy (non-catalog) items and products without a category land here, as before. */
const OTHERS_CATEGORY = "Others";
/** Overlapping thumbs on the last-order card (design BP-21: 3 × 40 px). */
const LAST_ORDER_THUMBS = 3;
const THUMB_SIZE = 40;
const THUMB_OVERLAP = 12;
const LEGACY_THUMB_SIZE = 44;
/** Width hints for `cdnImage` (≈ rendered px × 3). */
const IMAGE_WIDTH = { chip: 72, thumb: 120 } as const;
/** One toast id so a second "Add all" replaces the first instead of stacking. */
const REORDER_TOAST_ID = "reorder-last-order";
const REFRESH_ERROR_TOAST_ID = "order-again-refresh-error";
const SKELETON_CHIPS = [0, 1, 2, 3] as const;
const SKELETON_THUMBS = [0, 1, 2] as const;
const NO_STICKY: number[] = [];

// ─── Types ────────────────────────────────────────────────────────────────────

/** A previously bought item, either matched to a live catalog product or left as a legacy name. */
type DisplayItem =
  | { kind: "catalog"; key: string; product: Product; category: string }
  | { kind: "legacy"; key: string; name: string; unit?: string; image?: string; category: string };

type ChipDef = {
  key: string;
  /** null = the "All" chip. */
  name: string | null;
  label: string;
  /** Precomputed 24 px thumb (the first image in that category), so the strip never maps images per render. */
  thumbUri?: string;
};

type HeroItem = {
  kind: "hero";
  key: "hero";
  showAvatar: boolean;
  unread: boolean;
  addressLabel: string | null;
  addressLine: string | null;
  avatarInitial: string | undefined;
};
type LastOrderItem = {
  kind: "lastOrder";
  key: "last-order";
  order: Order;
  thumbs: string[];
  itemCount: number;
  totalLabel: string;
  whenLabel: string;
  orderNumber: string | null;
};
type ChipsItem = { kind: "chips"; key: "chips"; chips: ChipDef[]; active: string | null };
type GroupItem = {
  kind: "group";
  key: string;
  title: string;
  count: number;
  seeAllSlug: string | null;
  seeAllName: string | null;
};
type GridRowItem = { kind: "gridRow"; key: string; left: Product; right: Product | null };
type LegacyItem = { kind: "legacy"; key: string; name: string; unit?: string; image?: string };
type EndItem = { kind: "end"; key: "end"; remaining: number };
type EmptyItem = { kind: "empty"; key: "empty"; variant: "none" | "error"; message?: string };

type OrderAgainListItem =
  | HeroItem
  | LastOrderItem
  | ChipsItem
  | GroupItem
  | GridRowItem
  | LegacyItem
  | EndItem
  | EmptyItem;

type CatalogIndex = {
  identity: HomeCatalogCache | null;
  byId: Map<string, Product>;
  byName: Map<string, Product[]>;
};

type CatalogState = { cache: HomeCatalogCache | null; resolved: boolean };

// ─── Module-level list helpers (stable identities for FlashList) ──────────────

const keyExtractor = (item: OrderAgainListItem): string => item.key;
/** Recycles cells by kind — every kind has a different box model. */
const getItemType = (item: OrderAgainListItem): string => item.kind;
const chipKeyExtractor = (chip: ChipDef): string => chip.key;

const goToSelectLocation = () => {
  router.push({ pathname: "/select-location", params: { returnTo: "/(tabs)/order-again" } });
};
const goToSignIn = () => {
  router.push("/phone");
};
// A tab switch, not a replace: REPLACE targeted at a sibling tab is swallowed by the tab router (W3 R6-02).
const goToHome = () => {
  router.navigate("/(tabs)/home");
};

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_DISPLAY_ITEMS: DisplayItem[] = [];
const EMPTY_INDEX: CatalogIndex = { identity: null, byId: new Map(), byName: new Map() };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalise(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function createdAtMs(order: Order): number {
  const t = Date.parse(order.created_at);
  return Number.isFinite(t) ? t : 0;
}

/** "today" · "yesterday" · "3 days ago" · "2 weeks ago" · "12 Aug" — short enough for the meta line. */
function describeWhen(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "last week" : `${weeks} weeks ago`;
  }
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** One pass over the catalog: id → product and nameKey → products (speed-and-ease 14: built once per catalog identity). */
function buildCatalogIndex(cache: HomeCatalogCache | null): CatalogIndex {
  if (!cache) return EMPTY_INDEX;
  const byId = new Map<string, Product>();
  const byName = new Map<string, Product[]>();
  for (const p of cache.products) {
    byId.set(p.id, p);
    const nameKey = normalise(p.name);
    if (!nameKey) continue;
    const bucket = byName.get(nameKey);
    if (bucket) bucket.push(p);
    else byName.set(nameKey, [p]);
  }
  return { identity: cache, byId, byName };
}

/** Same unit wins; otherwise the first product with that name (the pre-rewrite fallback order). */
function matchByName(index: CatalogIndex, item: OrderAgainItem): Product | undefined {
  const candidates = index.byName.get(normalise(item.name));
  if (!candidates || candidates.length === 0) return undefined;
  const unitKey = normalise(item.unit);
  if (!unitKey) return candidates[0];
  return candidates.find((p) => normalise(p.unit) === unitKey) ?? candidates[0];
}

/** Distinct previously-bought items, deduplicated by catalog id, in `buildOrderAgainItems` order (most recent first). */
function buildDisplayItems(orders: Order[] | null, index: CatalogIndex): DisplayItem[] {
  if (!orders || orders.length === 0) return EMPTY_DISPLAY_ITEMS;
  const orderItems = buildOrderAgainItems(orders);
  if (orderItems.length === 0) return EMPTY_DISPLAY_ITEMS;

  const seen = new Set<string>();
  const out: DisplayItem[] = [];
  for (const it of orderItems) {
    const product = (it.masterProductId ? index.byId.get(it.masterProductId) : undefined) ?? matchByName(index, it);
    if (product) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      out.push({ kind: "catalog", key: `c:${product.id}`, product, category: product.category || OTHERS_CATEGORY });
    } else {
      out.push({ kind: "legacy", key: it.key, name: it.name, unit: it.unit, image: it.image, category: OTHERS_CATEGORY });
    }
  }
  return out;
}

/** "All" + one chip per category present, ordered by category group, each with its first image as the thumb. */
function buildChips(items: DisplayItem[]): ChipDef[] {
  const chips: ChipDef[] = [{ key: "all", name: null, label: "All" }];
  if (items.length === 0) return chips;

  const firstImage = new Map<string, string | undefined>();
  const categoriesByGroup = new Map<string, string[]>();
  for (const it of items) {
    if (!firstImage.has(it.category)) {
      firstImage.set(it.category, it.kind === "catalog" ? it.product.image_url : it.image);
      const group = getGroupForCategoryName(it.category);
      const list = categoriesByGroup.get(group.id);
      if (list) list.push(it.category);
      else categoriesByGroup.set(group.id, [it.category]);
    } else if (!firstImage.get(it.category)) {
      firstImage.set(it.category, it.kind === "catalog" ? it.product.image_url : it.image);
    }
  }
  for (const group of [...CATEGORY_GROUPS, DEFAULT_GROUP]) {
    const names = categoriesByGroup.get(group.id);
    if (!names) continue;
    for (const name of names) {
      chips.push({ key: `cat:${name}`, name, label: name, thumbUri: cdnImage(firstImage.get(name), IMAGE_WIDTH.chip) });
    }
  }
  return chips;
}

function pickLatestOrder(orders: Order[] | null): Order | null {
  if (!orders || orders.length === 0) return null;
  let latest = orders[0];
  for (const o of orders) if (createdAtMs(o) > createdAtMs(latest)) latest = o;
  return latest;
}

function buildLastOrderItem(order: Order, index: CatalogIndex, now: number): LastOrderItem {
  const lines = order.items ?? [];
  const thumbs: string[] = [];
  for (const line of lines) {
    if (thumbs.length >= LAST_ORDER_THUMBS) break;
    const fromCatalog = line.master_product_id ? index.byId.get(line.master_product_id)?.image_url : undefined;
    const uri = cdnImage(line.image || fromCatalog, IMAGE_WIDTH.thumb);
    if (uri) thumbs.push(uri);
  }
  const itemCount = lines.length > 0 ? lines.length : (order.items_count ?? 0);
  return {
    kind: "lastOrder",
    key: "last-order",
    order,
    thumbs,
    itemCount,
    totalLabel: formatMoney(Number(order.order_total) || 0),
    whenLabel: describeWhen(order.created_at, now),
    orderNumber: order.order_number ? `Order ${order.order_number}` : null,
  };
}

/** Undo for "Add all": lines that existed before go back to their old quantity; new lines are removed. All silent. */
function undoReorder(items: ReorderItem[], before: Map<string, number>): void {
  for (const item of items) {
    const prev = before.get(item.product_id);
    if (prev == null) cartActions.removeItem(item.product_id, { silent: true });
    else cartActions.updateQty(item.product_id, prev, { silent: true });
  }
}

// ─── Cells ────────────────────────────────────────────────────────────────────

function ThumbStack({ uris }: { uris: string[] }) {
  if (uris.length === 0) {
    return (
      <View style={styles.thumbStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.thumb}>
          <MaterialCommunityIcons name="basket-outline" size={18} color={C.primary} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.thumbStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uris.map((uri, i) => (
        <View key={uri} style={[styles.thumb, i > 0 && styles.thumbOverlap]}>
          <Image
            source={{ uri }}
            style={styles.thumbImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
            priority="low"
            accessibilityIgnoresInvertColors
          />
        </View>
      ))}
    </View>
  );
}

const LastOrderCard = React.memo(function LastOrderCard({
  item,
  onAddAll,
}: {
  item: LastOrderItem;
  onAddAll: (order: Order) => void;
}) {
  const handleAdd = useCallback(() => onAddAll(item.order), [item.order, onAddAll]);
  const meta = `${plural(item.itemCount, "item")} · ${item.totalLabel}${item.whenLabel ? ` · ${item.whenLabel}` : ""}`;
  return (
    <View style={styles.lastOrderWrap}>
      <View style={styles.lastOrderCard}>
        <View
          style={styles.lastOrderTop}
          accessible
          accessibilityLabel={`Your last order, ${plural(item.itemCount, "item")}, ${item.totalLabel}${item.whenLabel ? `, ${item.whenLabel}` : ""}`}
        >
          <ThumbStack uris={item.thumbs} />
          <View style={styles.lastOrderText}>
            <Text style={styles.lastOrderTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              Your last order
            </Text>
            <Text style={styles.lastOrderMeta} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {meta}
            </Text>
          </View>
        </View>
        <View style={styles.lastOrderActions}>
          {item.orderNumber ? (
            <Text style={styles.lastOrderNumber} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {item.orderNumber}
            </Text>
          ) : (
            <View />
          )}
          <PrimaryButton
            size="sm"
            label="Add all"
            icon="cart-plus"
            onPress={handleAdd}
            accessibilityLabel="Add all items from your last order"
            testID="order-again-add-all"
          />
        </View>
      </View>
    </View>
  );
});

const FilterChip = React.memo(function FilterChip({
  name,
  label,
  thumbUri,
  selected,
  onSelect,
}: {
  name: string | null;
  label: string;
  thumbUri?: string;
  selected: boolean;
  onSelect: (name: string | null) => void;
}) {
  const handlePress = useCallback(() => {
    if (!selected) onSelect(name);
  }, [name, onSelect, selected]);
  // Re-pressing the active chip changes nothing, so it stays silent (one gesture → one haptic only on a real change).
  return (
    <Chip
      label={label}
      thumbUri={thumbUri}
      selected={selected}
      accessibilityRole="tab"
      haptic={selected ? false : "select"}
      onPress={handlePress}
      testID={`order-again-chip-${name ?? "all"}`}
    />
  );
});

const ChipStrip = React.memo(function ChipStrip({
  item,
  onSelect,
}: {
  item: ChipsItem;
  onSelect: (name: string | null) => void;
}) {
  const renderChip = useCallback(
    ({ item: chip }: RailRenderItemInfo<ChipDef>) => (
      <FilterChip
        name={chip.name}
        label={chip.label}
        thumbUri={chip.thumbUri}
        selected={item.active === chip.name}
        onSelect={onSelect}
      />
    ),
    [item.active, onSelect],
  );
  return (
    <View style={styles.chipBand}>
      <FlatList
        data={item.chips}
        keyExtractor={chipKeyExtractor}
        renderItem={renderChip}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRail}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={3}
        accessibilityRole="tablist"
        accessibilityLabel="Filter by category"
        testID="order-again-chips"
      />
    </View>
  );
});

const GroupHeader = React.memo(function GroupHeader({ item }: { item: GroupItem }) {
  const slug = item.seeAllSlug;
  const handleSeeAll = useCallback(() => {
    if (slug) router.push(`/category/${slug}`);
  }, [slug]);
  return (
    <View style={styles.groupHeader}>
      <View style={styles.groupText}>
        <Text style={styles.groupTitle} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {item.title}
        </Text>
        <Text style={styles.groupCount} maxFontSizeMultiplier={1.3}>
          {plural(item.count, "item")}
        </Text>
      </View>
      {slug ? (
        <PressableScale
          scale={motion.scale.row}
          onPress={handleSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all in ${item.seeAllName ?? item.title}`}
          hitSlop={HIT_SLOP}
          innerStyle={styles.seeAll}
          pressedStyle={styles.seeAllPressed}
          testID="order-again-see-all"
        >
          <Text style={styles.seeAllText} maxFontSizeMultiplier={1.3}>
            See all
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={C.link} />
        </PressableScale>
      ) : null}
    </View>
  );
});

/** Two grid cards per row at (W − 32 − 8) / 2 each; a lone last card keeps its half width via the spacer. */
const GridRow = React.memo(function GridRow({ item }: { item: GridRowItem }) {
  return (
    <View style={styles.gridRow}>
      <ProductCard variant="grid" product={item.left} style={styles.gridCard} recycled />
      {item.right ? (
        <ProductCard variant="grid" product={item.right} style={styles.gridCard} recycled />
      ) : (
        <View style={styles.gridCard} />
      )}
    </View>
  );
});

/** An item that left the catalog: never purchasable-looking — name, unit and a quiet "Find similar" chip. */
const LegacyRow = React.memo(function LegacyRow({ item }: { item: LegacyItem }) {
  const name = item.name;
  const handleFind = useCallback(() => {
    router.push({ pathname: "/support/search", params: { q: name } });
  }, [name]);
  const uri = cdnImage(item.image, IMAGE_WIDTH.thumb);
  return (
    <View style={styles.legacyRow}>
      <View style={styles.legacyThumb} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.legacyImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
            recyclingKey={item.key}
            priority="low"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <MaterialCommunityIcons name="image-off-outline" size={20} color={C.textLight} />
        )}
      </View>
      <View style={styles.legacyText}>
        <Text style={styles.legacyName} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
        <Text style={styles.legacyMeta} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {item.unit ? `${item.unit} · ` : ""}Not available right now
        </Text>
      </View>
      <Chip
        label="Find similar"
        icon="magnify"
        size="sm"
        haptic={false}
        onPress={handleFind}
        accessibilityLabel={`Find similar to ${name}`}
        testID="order-again-find-similar"
      />
    </View>
  );
});

const EndCell = React.memo(function EndCell({ item, onShowMore }: { item: EndItem; onShowMore: () => void }) {
  if (item.remaining > 0) {
    return (
      <View style={styles.endMore}>
        <PrimaryButton
          variant="outline"
          size="sm"
          label="Show more"
          onPress={onShowMore}
          accessibilityLabel={`Show more, ${plural(item.remaining, "item")} remaining`}
          testID="order-again-show-more"
        />
        <Text style={styles.endCaption} maxFontSizeMultiplier={1.3}>
          {plural(item.remaining, "more item")}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.endRow}>
      <MaterialCommunityIcons name="history" size={14} color={C.textSub} />
      <Text style={styles.endText} maxFontSizeMultiplier={1.3}>
        That&apos;s everything you&apos;ve ordered
      </Text>
    </View>
  );
});

const EmptyCell = React.memo(function EmptyCell({ item, onRetry }: { item: EmptyItem; onRetry: () => void }) {
  const { height } = useWindowDimensions();
  // A definite height lets `EmptyState fill` centre itself under the band (the cell has no flex parent).
  const cellHeight = Math.max(360, Math.round(height * 0.6));
  if (item.variant === "error") {
    return (
      <View style={{ height: cellHeight }}>
        <EmptyState
          fill
          iconWrap
          icon="cloud-off-outline"
          title="Couldn't load your orders"
          text={item.message ?? "Check your connection and try again."}
          action={{ label: "Retry", onPress: onRetry }}
          testID="order-again-error"
        />
      </View>
    );
  }
  return (
    <View style={{ height: cellHeight }}>
      <EmptyState
        fill
        iconWrap
        icon="history"
        title="Nothing to reorder yet"
        text="Your past orders will show up here"
        action={{ label: "Start shopping", onPress: goToHome }}
        testID="order-again-empty"
      />
    </View>
  );
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function OrderAgainSkeleton({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  return (
    <View style={styles.skeletonRoot}>
      <SkeletonScreen label="Loading your order history…">
        {/* Last-order card */}
        <View style={styles.lastOrderWrap}>
          <View style={styles.lastOrderCard}>
            <View style={styles.lastOrderTop}>
              <View style={styles.thumbStack}>
                {SKELETON_THUMBS.map((k) => (
                  <Skeleton
                    key={k}
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                    radius={radius.lg}
                    style={k > 0 ? styles.thumbOverlap : undefined}
                  />
                ))}
              </View>
              <View style={styles.lastOrderText}>
                <Skeleton width={120} height={14} />
                <Skeleton width={180} height={12} style={styles.mt6} />
              </View>
            </View>
            <View style={styles.lastOrderActions}>
              <Skeleton width={90} height={11} />
              <Skeleton width={104} height={40} radius={radius.xl} />
            </View>
          </View>
        </View>
        {/* Chip strip */}
        <View style={styles.skeletonChips}>
          {SKELETON_CHIPS.map((k) => (
            <Skeleton key={k} width={k === 0 ? 56 : 96} height={32} radius={radius.pill} />
          ))}
        </View>
        {/* Scope header */}
        <View style={styles.groupHeader}>
          <View style={styles.groupText}>
            <Skeleton width={180} height={17} />
            <Skeleton width={60} height={12} style={styles.mt6} />
          </View>
        </View>
        {/* Four grid twins */}
        <View style={styles.gridRow}>
          <SkeletonProductCard variant="grid" style={styles.gridCard} />
          <SkeletonProductCard variant="grid" style={styles.gridCard} />
        </View>
        <View style={styles.gridRow}>
          <SkeletonProductCard variant="grid" style={styles.gridCard} />
          <SkeletonProductCard variant="grid" style={styles.gridCard} />
        </View>
      </SkeletonScreen>
      {slow ? (
        <View style={styles.slowWrap}>
          <Text style={styles.slowText} maxFontSizeMultiplier={1.3}>
            Still loading… check your connection
          </Text>
          <PrimaryButton variant="ghost" size="xs" label="Retry" onPress={onRetry} testID="order-again-slow-retry" />
        </View>
      ) : null}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrderAgainScreen() {
  const { userId, user } = useAuth();
  const { location } = useLocation();
  const { open, unreadCount } = useProfileMenu();
  const inhibitAtlas = useDevFlag("Dev_Atlas_inhibit_Feature");
  const inhibitVega = useDevFlag("Dev_Vega_inhibit_Feature");
  const inhibitReorder = useDevFlag("Dev_Vega_inhibit_Reorder");
  const cartFootprint = useCartBarFootprint();

  // ── Orders: memory mirror → disk cache → network (after interactions) ──────
  const [orders, setOrders] = useState<Order[] | null>(() => (userId ? getMemoryOrders() : null));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seqRef = useRef(0);

  const fetchOrders = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!userId) return;
      const seq = ++seqRef.current;
      try {
        const data = await getUserOrders(userId, opts);
        if (seq !== seqRef.current) return;
        setOrders(data);
        setError(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        logSilentFailure("Order again: fetch orders", err);
        setError(err instanceof Error ? err.message : "Could not load your orders.");
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    // The disk row is only worth reading while the memory mirror is empty (orders.tsx does the same — W3 R1-19).
    if (getMemoryOrders() === null) {
      readUserOrdersCache(userId)
        .then((cached) => {
          // The memory seed (if any) is at least as fresh as the disk row; never replace it with the disk copy.
          if (!cancelled && cached && cached.length > 0) setOrders((prev) => prev ?? cached);
        })
        .catch((err) => logSilentFailure("Order again: read orders cache", err));
    }
    // The first network fetch waits for the tab transition to settle so the cached paint is never janked.
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void fetchOrders();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [fetchOrders, userId]);

  // ── Catalog: Home's memory cache, then its disk row (null under Dev_Cache_inhibit_HomeCatalog → legacy rows) ──
  const [catalogState, setCatalogState] = useState<CatalogState>(() => {
    const mem = getMemoryHomeCache();
    return { cache: mem, resolved: mem !== null };
  });
  useEffect(() => {
    if (catalogState.resolved) return undefined;
    let cancelled = false;
    readHomeCatalogCache()
      .then((cache) => {
        if (!cancelled) setCatalogState({ cache, resolved: true });
      })
      .catch((err) => {
        logSilentFailure("Order again: read home catalog cache", err);
        if (!cancelled) setCatalogState({ cache: null, resolved: true });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogState.resolved]);

  // ── Categories for slug resolution (C15): queryCache peek → fetch; the home cache's list is the fallback ──
  const [categories, setCategories] = useState<Category[] | null>(() => peekCategories() ?? null);
  useEffect(() => {
    if (categories) return undefined;
    let cancelled = false;
    getAllCategories()
      .then((list) => {
        if (!cancelled && list.length > 0) setCategories(list);
      })
      .catch((err) => logSilentFailure("Order again: fetch categories", err));
    return () => {
      cancelled = true;
    };
  }, [categories]);

  // ── Revalidate on later focuses (skipped under the vega master flag: mount-only fetch) and on reconnect ──
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // Home may have loaded the catalog since this tab last painted; pick it up without a remount.
      const mem = getMemoryHomeCache();
      if (mem) setCatalogState((prev) => (prev.cache === mem ? prev : { cache: mem, resolved: true }));
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      if (!userId || getDevFlag("Dev_Vega_inhibit_Feature")) return;
      void fetchOrders();
    }, [fetchOrders, userId]),
  );
  useRefetchOnReconnect(() => {
    void fetchOrders();
  }, !!userId);

  // A failed refresh over cached data is a toast, not a replaced screen.
  useEffect(() => {
    if (error && orders && orders.length > 0) {
      notify({ id: REFRESH_ERROR_TOAST_ID, title: "Couldn't refresh your orders", message: error, tone: "error" });
    }
  }, [error, orders]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const catalogIndex = useMemo(() => buildCatalogIndex(catalogState.cache), [catalogState.cache]);
  const displayItems = useMemo(() => buildDisplayItems(orders, catalogIndex), [orders, catalogIndex]);
  const chips = useMemo(() => buildChips(displayItems), [displayItems]);

  const [activeChip, setActiveChip] = useState<string | null>(null);
  // A chip that vanished with a refresh falls back to "All" without touching state.
  const activeName = activeChip && chips.some((c) => c.name === activeChip) ? activeChip : null;

  // Catalog items first (grid), legacy rows after, so "Show more" never interleaves the two.
  const filtered = useMemo(() => {
    const scoped = activeName ? displayItems.filter((it) => it.category === activeName) : displayItems;
    const catalog: DisplayItem[] = [];
    const legacy: DisplayItem[] = [];
    for (const it of scoped) (it.kind === "catalog" ? catalog : legacy).push(it);
    return legacy.length === 0 ? catalog : [...catalog, ...legacy];
  }, [displayItems, activeName]);

  // Paging is keyed on the item signature, not array identity: a refresh that returns the same items keeps the window.
  const signature = useMemo(() => filtered.map((it) => it.key).join(","), [filtered]);
  const [pagedSignature, setPagedSignature] = useState(signature);
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);
  if (pagedSignature !== signature) {
    setPagedSignature(signature);
    setVisibleCount(GRID_PAGE_SIZE);
  }

  const categoryList = categories ?? catalogState.cache?.categories ?? EMPTY_CATEGORIES;
  const seeAllSlug = activeName ? resolveCategorySlug(activeName, categoryList) : null;

  const lastOrder = useMemo(() => pickLatestOrder(orders), [orders]);
  const lastOrderItem = useMemo(
    () => (lastOrder ? buildLastOrderItem(lastOrder, catalogIndex, Date.now()) : null),
    [lastOrder, catalogIndex],
  );

  const addressLabel = location?.label ?? null;
  const addressLine = location?.address ?? null;
  const avatarInitial = user?.name;
  const unread = unreadCount > 0;
  const heroItem = useMemo<HeroItem>(
    () => ({ kind: "hero", key: "hero", showAvatar: !inhibitAtlas, unread, addressLabel, addressLine, avatarInitial }),
    [inhibitAtlas, unread, addressLabel, addressLine, avatarInitial],
  );

  const showLastOrder = !!lastOrderItem && !inhibitVega && !inhibitReorder;
  const hasData = !!orders && orders.length > 0;

  const { listData, stickyIndices } = useMemo(() => {
    const items: OrderAgainListItem[] = [heroItem];
    if (error && !hasData) {
      items.push({ kind: "empty", key: "empty", variant: "error", message: error });
      return { listData: items, stickyIndices: NO_STICKY };
    }
    if (displayItems.length === 0) {
      items.push({ kind: "empty", key: "empty", variant: "none" });
      return { listData: items, stickyIndices: NO_STICKY };
    }
    if (showLastOrder && lastOrderItem) items.push(lastOrderItem);
    const chipsIndex = items.length;
    items.push({ kind: "chips", key: "chips", chips, active: activeName });
    items.push({
      kind: "group",
      key: `group:${activeName ?? "all"}`,
      title: activeName ?? "Everything you've bought",
      count: filtered.length,
      seeAllSlug,
      seeAllName: activeName,
    });
    const page = filtered.slice(0, visibleCount);
    let pending: Product | null = null;
    for (const it of page) {
      if (it.kind === "catalog") {
        if (pending) {
          items.push({ kind: "gridRow", key: `row:${pending.id}:${it.product.id}`, left: pending, right: it.product });
          pending = null;
        } else {
          pending = it.product;
        }
      } else {
        if (pending) {
          items.push({ kind: "gridRow", key: `row:${pending.id}`, left: pending, right: null });
          pending = null;
        }
        items.push({ kind: "legacy", key: it.key, name: it.name, unit: it.unit, image: it.image });
      }
    }
    if (pending) items.push({ kind: "gridRow", key: `row:${pending.id}`, left: pending, right: null });
    items.push({ kind: "end", key: "end", remaining: Math.max(0, filtered.length - visibleCount) });
    return { listData: items, stickyIndices: [chipsIndex] };
  }, [heroItem, error, hasData, displayItems.length, showLastOrder, lastOrderItem, chips, activeName, filtered, seeAllSlug, visibleCount]);

  // ── Handlers (all identity-stable so `renderItem` never churns) ────────────
  const handleAddAll = useCallback((order: Order) => {
    const { items, unavailable } = buildReorderItems(order, getCachedProduct);
    if (items.length === 0) {
      feedback.error();
      notify({
        id: REORDER_TOAST_ID,
        title: "Nothing to add",
        message: unavailable.length > 0 ? `${plural(unavailable.length, "item")} no longer available` : undefined,
        tone: "warning",
      });
      return;
    }
    const before = new Map(getCartSnapshot().items.map((line) => [line.product_id, line.quantity] as const));
    const { added } = cartActions.addMany(items, { silent: true });
    if (added === 0) {
      feedback.error();
      notify({ id: REORDER_TOAST_ID, title: "Already at the maximum", message: "These items are at 99 in your cart", tone: "warning" });
      return;
    }
    // One commit, ONE `add` for the whole batch — never a sound per line (addMany is silent; the toast is silent by design).
    // `success` is reserved for order placement (W3 F7 / R2-24).
    feedback.add();
    const priceChanged = items.filter((it) => it.priceChanged).length;
    notify({
      id: REORDER_TOAST_ID,
      title: `Added ${plural(added, "item")}${unavailable.length > 0 ? ` · ${unavailable.length} unavailable` : ""}`,
      message: priceChanged > 0 ? `Prices updated for ${plural(priceChanged, "item")}` : undefined,
      tone: "success",
      action: { label: "Undo", onPress: () => undoReorder(items, before) },
    });
  }, []);

  const handleSelectChip = useCallback((name: string | null) => {
    setActiveChip(name);
  }, []);

  const handleShowMore = useCallback(() => {
    setVisibleCount((count) => count + GRID_PAGE_SIZE);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    void fetchOrders({ force: true });
  }, [fetchOrders]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    feedback.tapSound();
    setRefreshing(true);
    await fetchOrders({ force: true });
    setRefreshing(false);
  }, [fetchOrders, userId]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<OrderAgainListItem>) => {
      switch (item.kind) {
        case "hero":
          return (
            <TabHeader
              variant="tab"
              title="Order again"
              addressLabel={item.addressLabel}
              addressLine={item.addressLine}
              onAddressPress={goToSelectLocation}
              avatarInitial={item.avatarInitial}
              onAvatarPress={open}
              showAvatar={item.showAvatar}
              unread={item.unread}
              testID="order-again-header"
            />
          );
        case "lastOrder":
          return <LastOrderCard item={item} onAddAll={handleAddAll} />;
        case "chips":
          return <ChipStrip item={item} onSelect={handleSelectChip} />;
        case "group":
          return <GroupHeader item={item} />;
        case "gridRow":
          return <GridRow item={item} />;
        case "legacy":
          return <LegacyRow item={item} />;
        case "end":
          return <EndCell item={item} onShowMore={handleShowMore} />;
        case "empty":
          return <EmptyCell item={item} onRetry={handleRetry} />;
        default:
          return null;
      }
    },
    [open, handleAddAll, handleSelectChip, handleShowMore, handleRetry],
  );

  const contentContainerStyle = useMemo(
    () => ({ paddingBottom: layout.scrollBottomTab + cartFootprint }),
    [cartFootprint],
  );

  const loading = useForceSkeleton(!!userId && !error && (orders === null || !catalogState.resolved));
  const slow = useSlowLoad(loading);

  // ── Guest gate (S3 excluded: kept as the sign-in EmptyState) ───────────────
  if (!userId) {
    return (
      <Screen bg={C.bg} edges={["top"]}>
        <TabHeader
          variant="tab"
          title="Order again"
          addressLabel={addressLabel}
          addressLine={addressLine}
          onAddressPress={goToSelectLocation}
          onAvatarPress={open}
          showAvatar={!inhibitAtlas}
          unread={unread}
          testID="order-again-header"
        />
        <EmptyState
          fill
          iconWrap
          icon="account-outline"
          title="Sign in first"
          text="Reorder your favourites in one tap once you're signed in."
          action={{ label: "Sign in", onPress: goToSignIn }}
          testID="order-again-guest"
        />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen bg={C.bg} edges={["top"]}>
        <TabHeader
          variant="tab"
          title="Order again"
          addressLabel={addressLabel}
          addressLine={addressLine}
          onAddressPress={goToSelectLocation}
          avatarInitial={avatarInitial}
          onAvatarPress={open}
          showAvatar={!inhibitAtlas}
          unread={unread}
          testID="order-again-header"
        />
        <OrderAgainSkeleton slow={slow} onRetry={handleRetry} />
      </Screen>
    );
  }

  return (
    <Screen bg={C.bg} edges={["top"]}>
      <FlashList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        stickyHeaderIndices={stickyIndices}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
        testID="order-again-list"
      />
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Last-order card (vega): flat white card on cream, hairline border, no shadow.
  lastOrderWrap: { paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 4 },
  lastOrderCard: {
    backgroundColor: C.card,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: C.hairline,
    padding: layout.cardPadding,
    gap: 12,
  },
  lastOrderTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  lastOrderText: { flex: 1, minWidth: 0, gap: 2 },
  lastOrderTitle: { ...text.rowTitle },
  lastOrderMeta: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.textSub },
  lastOrderActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  lastOrderNumber: { ...text.caption, flexShrink: 1 },
  thumbStack: { flexDirection: "row", alignItems: "center" },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: C.card,
    backgroundColor: C.bgSoft,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOverlap: { marginLeft: -THUMB_OVERLAP },
  thumbImage: { position: "absolute", top: 3, right: 3, bottom: 3, left: 3 },

  // Chip strip (sticky while the grid scrolls, so it needs an opaque ground).
  chipBand: { backgroundColor: C.bg },
  chipRail: { paddingHorizontal: layout.gutter, paddingVertical: 8, gap: layout.gridGap },

  // Scope header
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: layout.gutter,
    paddingTop: 8,
    paddingBottom: 10,
  },
  groupText: { flex: 1, minWidth: 0, gap: 2 },
  groupTitle: { ...text.h3 },
  groupCount: { ...text.rowSubtitle },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: radius.md,
  },
  seeAllPressed: { backgroundColor: C.primaryXLight },
  seeAllText: { ...text.link },

  // Grid: two cards per row, each (W − 32 − 8) / 2 via flex.
  gridRow: { flexDirection: "row", gap: layout.gridGap, paddingHorizontal: layout.gutter, paddingBottom: layout.gridGap },
  gridCard: { flex: 1, minWidth: 0 },

  // Legacy row: quiet, not a product card.
  legacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: layout.gutter,
    marginBottom: layout.gridGap,
    padding: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.card,
  },
  legacyThumb: {
    width: LEGACY_THUMB_SIZE,
    height: LEGACY_THUMB_SIZE,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  legacyImage: { position: "absolute", top: 4, right: 4, bottom: 4, left: 4 },
  legacyText: { flex: 1, minWidth: 0, gap: 2 },
  legacyName: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 17, color: C.text },
  legacyMeta: { ...text.caption },

  // End: paging button or the stamp.
  endMore: { alignItems: "center", gap: 8, paddingTop: 12, paddingBottom: 20 },
  endCaption: { ...text.caption },
  endRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 24 },
  endText: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub },

  // Skeleton
  skeletonRoot: { flex: 1 },
  skeletonChips: { flexDirection: "row", gap: layout.gridGap, paddingHorizontal: layout.gutter, paddingVertical: 8 },
  slowWrap: { alignItems: "center", gap: 4, paddingTop: 8 },
  slowText: { ...text.caption, textAlign: "center" },
  mt6: { marginTop: 6 },
});
