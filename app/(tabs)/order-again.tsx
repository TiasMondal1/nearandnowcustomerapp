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
    LayoutAnimation,
    Platform,
    UIManager,
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

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Design tokens ─────────────────────────────────────────────────────────────
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
  orderCard: "#FFFFFF",
  orderBorder: "rgba(60,47,30,0.10)",
  statusDelivered: "#2D7A4F",
  statusPending: "#C97B1A",
  statusCancelled: "#C0392B",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a date string or ISO timestamp to a human-readable date. */
function formatOrderDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Unknown date";
  }
}

/** Format a time from ISO string. */
function formatOrderTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

/** Derive a display status from the order object. Adjust field names to match your schema. */
function getOrderStatus(order: Order): { label: string; color: string; icon: string } {
  const status = (order as any).status ?? (order as any).order_status ?? "";
  switch (status.toLowerCase()) {
    case "delivered":
      return { label: "Delivered", color: T.statusDelivered, icon: "check-circle-outline" };
    case "cancelled":
    case "canceled":
      return { label: "Cancelled", color: T.statusCancelled, icon: "close-circle-outline" };
    case "processing":
    case "confirmed":
      return { label: "Processing", color: T.statusPending, icon: "clock-outline" };
    case "out_for_delivery":
    case "out for delivery":
      return { label: "Out for delivery", color: T.statusPending, icon: "truck-delivery-outline" };
    default:
      return { label: "Completed", color: T.statusDelivered, icon: "check-circle-outline" };
  }
}

/** Compute total from order items. Adjust field names to your schema. */
function getOrderTotal(order: Order): number {
  const total = (order as any).total_amount ?? (order as any).total ?? (order as any).amount;
  if (total != null) return Number(total);
  // Fallback: sum items
  const items: any[] = (order as any).order_items ?? (order as any).items ?? [];
  return items.reduce((sum, it) => sum + (Number(it.price ?? 0) * Number(it.quantity ?? 1)), 0);
}

/** Get items array from an order. */
function getOrderItems(order: Order): any[] {
  return (order as any).order_items ?? (order as any).items ?? [];
}

/** Unique stable id for an order. */
function getOrderId(order: Order): string {
  return String((order as any).id ?? (order as any).order_id ?? Math.random());
}

// ─── Previous Order Card ──────────────────────────────────────────────────────
const PreviousOrderCard = React.memo(function PreviousOrderCard({
  order,
  onReorderAll,
  allProducts,
}: {
  order: Order;
  onReorderAll: (order: Order) => void;
  allProducts: Product[] | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = getOrderItems(order);
  const total = getOrderTotal(order);
  const orderId = getOrderId(order);
  const createdAt = (order as any).created_at ?? (order as any).ordered_at ?? (order as any).date;
  const status = getOrderStatus(order);

  // Build enriched item list
  const enrichedItems = useMemo(() => {
    const byId = new Map<string, Product>();
    if (allProducts) for (const p of allProducts) byId.set(p.id, p);

    return items.map((it: any) => {
      const productId = it.master_product_id ?? it.product_id ?? it.id;
      const catalog = productId ? byId.get(String(productId)) : undefined;
      return {
        id: String(it.id ?? Math.random()),
        name: catalog?.name ?? it.name ?? it.product_name ?? "Item",
        image: catalog?.image_url ?? it.image_url ?? it.image,
        price: catalog?.price ?? Number(it.price ?? 0),
        qty: Number(it.quantity ?? 1),
        unit: catalog?.unit ?? it.unit ?? "",
      };
    });
  }, [items, allProducts]);

  const previewItems = enrichedItems.slice(0, 3);
  const moreCount = enrichedItems.length - previewItems.length;

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }, []);

  const handleReorder = useCallback(() => onReorderAll(order), [onReorderAll, order]);

  return (
    <View style={orderStyles.card}>
      {/* Order header */}
      <View style={orderStyles.cardHeader}>
        <View style={orderStyles.headerLeft}>
          <View style={orderStyles.orderIdRow}>
            <MaterialCommunityIcons name="receipt" size={14} color={T.green} />
            <Text style={orderStyles.orderId} numberOfLines={1}>
              Order #{orderId.slice(-8).toUpperCase()}
            </Text>
          </View>
          <View style={orderStyles.dateRow}>
            <MaterialCommunityIcons name="calendar-outline" size={12} color={T.barkLight} />
            <Text style={orderStyles.dateText}>
              {formatOrderDate(createdAt)}
              {formatOrderTime(createdAt) ? `  ·  ${formatOrderTime(createdAt)}` : ""}
            </Text>
          </View>
        </View>
        <View style={orderStyles.headerRight}>
          <View style={[orderStyles.statusBadge, { borderColor: status.color + "30", backgroundColor: status.color + "12" }]}>
            <MaterialCommunityIcons name={status.icon as any} size={11} color={status.color} />
            <Text style={[orderStyles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={orderStyles.totalText}>₹{total.toFixed(0)}</Text>
        </View>
      </View>

      {/* Item preview strip */}
      <View style={orderStyles.itemStrip}>
        {previewItems.map((it) => (
          <View key={it.id} style={orderStyles.previewItem}>
            <View style={orderStyles.previewImageWrap}>
              {it.image ? (
                <Image
                  source={{ uri: cdnImage(it.image, 80) }}
                  style={orderStyles.previewImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={80}
                />
              ) : (
                <MaterialCommunityIcons name="package-variant-closed" size={18} color={T.barkLight} />
              )}
            </View>
          </View>
        ))}
        {moreCount > 0 && (
          <View style={orderStyles.moreCountBubble}>
            <Text style={orderStyles.moreCountText}>+{moreCount}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={orderStyles.itemCountText}>
          {enrichedItems.length} item{enrichedItems.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Expanded item list */}
      {expanded && (
        <View style={orderStyles.expandedList}>
          {enrichedItems.map((it) => (
            <View key={it.id} style={orderStyles.expandedItem}>
              <View style={orderStyles.expandedImageWrap}>
                {it.image ? (
                  <Image
                    source={{ uri: cdnImage(it.image, 80) }}
                    style={orderStyles.expandedImage}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <MaterialCommunityIcons name="package-variant-closed" size={16} color={T.barkLight} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={orderStyles.expandedItemName} numberOfLines={1}>{it.name}</Text>
                {it.unit ? <Text style={orderStyles.expandedItemUnit}>{it.unit}</Text> : null}
              </View>
              <View style={orderStyles.expandedItemRight}>
                <Text style={orderStyles.expandedItemQty}>×{it.qty}</Text>
                <Text style={orderStyles.expandedItemPrice}>₹{(it.price * it.qty).toFixed(0)}</Text>
              </View>
            </View>
          ))}
          <View style={orderStyles.expandedTotal}>
            <Text style={orderStyles.expandedTotalLabel}>Order total</Text>
            <Text style={orderStyles.expandedTotalValue}>₹{total.toFixed(0)}</Text>
          </View>
        </View>
      )}

      {/* Footer actions */}
      <View style={orderStyles.cardFooter}>
        <TouchableOpacity style={orderStyles.expandBtn} onPress={toggleExpand} hitSlop={8}>
          <Text style={orderStyles.expandBtnText}>{expanded ? "Hide details" : "View details"}</Text>
          <MaterialCommunityIcons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={T.green}
          />
        </TouchableOpacity>
        <TouchableOpacity style={orderStyles.reorderBtn} onPress={handleReorder} activeOpacity={0.85}>
          <MaterialCommunityIcons name="refresh" size={14} color={T.white} />
          <Text style={orderStyles.reorderBtnText}>Reorder All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Previous Orders Section ──────────────────────────────────────────────────
const PreviousOrdersSection = React.memo(function PreviousOrdersSection({
  orders,
  onReorderAll,
  allProducts,
}: {
  orders: Order[];
  onReorderAll: (order: Order) => void;
  allProducts: Product[] | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? orders : orders.slice(0, 3);

  return (
    <View style={[styles.section, { borderTopWidth: 0, paddingHorizontal: 16 }]}>
      <View style={orderStyles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { paddingHorizontal: 0 }]}>Previous Orders</Text>
          <Text style={orderStyles.sectionSubtitle}>{orders.length} order{orders.length !== 1 ? "s" : ""} placed</Text>
        </View>
        <View style={orderStyles.historyBadge}>
          <MaterialCommunityIcons name="history" size={14} color={T.green} />
        </View>
      </View>

      {visible.map((order) => (
        <PreviousOrderCard
          key={getOrderId(order)}
          order={order}
          onReorderAll={onReorderAll}
          allProducts={allProducts}
        />
      ))}

      {orders.length > 3 && (
        <TouchableOpacity
          style={orderStyles.showMoreBtn}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowAll((v) => !v);
          }}
          activeOpacity={0.8}
        >
          <Text style={orderStyles.showMoreText}>
            {showAll ? "Show less" : `Show ${orders.length - 3} more orders`}
          </Text>
          <MaterialCommunityIcons
            name={showAll ? "chevron-up" : "chevron-down"}
            size={15}
            color={T.green}
          />
        </TouchableOpacity>
      )}
    </View>
  );
});

// ─── Order card styles ────────────────────────────────────────────────────────
const orderStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "600",
    marginTop: 2,
  },
  historyBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: T.orderCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.orderBorder,
    marginBottom: 10,
    overflow: "hidden",
    // subtle shadow
    shadowColor: T.bark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(60,47,30,0.06)",
  },
  headerLeft: { flex: 1, gap: 4 },
  headerRight: { alignItems: "flex-end", gap: 5, marginLeft: 8 },
  orderIdRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  orderId: {
    fontSize: 13,
    color: T.bark,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dateText: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  totalText: {
    fontSize: 15,
    color: T.bark,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  itemStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  previewItem: {},
  previewImageWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: T.tile,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  previewImage: { width: "100%", height: "100%" },
  moreCountBubble: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: T.green + "30",
  },
  moreCountText: { fontSize: 11, color: T.green, fontWeight: "900" },
  itemCountText: {
    fontSize: 12,
    color: T.barkLight,
    fontWeight: "600",
    marginRight: 2,
  },
  expandedList: {
    borderTopWidth: 1,
    borderTopColor: "rgba(60,47,30,0.06)",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  expandedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  expandedImageWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: T.tile,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  expandedImage: { width: "100%", height: "100%" },
  expandedItemName: {
    fontSize: 12,
    color: T.bark,
    fontWeight: "700",
    lineHeight: 15,
  },
  expandedItemUnit: {
    fontSize: 10,
    color: T.barkLight,
    fontWeight: "500",
    marginTop: 1,
  },
  expandedItemRight: { alignItems: "flex-end", gap: 2 },
  expandedItemQty: { fontSize: 11, color: T.barkLight, fontWeight: "600" },
  expandedItemPrice: { fontSize: 12, color: T.bark, fontWeight: "800" },
  expandedTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(60,47,30,0.06)",
    paddingTop: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  expandedTotalLabel: { fontSize: 12, color: T.barkLight, fontWeight: "700" },
  expandedTotalValue: { fontSize: 13, color: T.bark, fontWeight: "900" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(60,47,30,0.06)",
    backgroundColor: T.bg,
  },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  expandBtnText: {
    fontSize: 12,
    color: T.green,
    fontWeight: "700",
  },
  reorderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: T.green,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  reorderBtnText: {
    fontSize: 12,
    color: T.white,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  showMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    marginTop: 2,
  },
  showMoreText: {
    fontSize: 13,
    color: T.green,
    fontWeight: "700",
  },
});

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

// ─── Product card ─────────────────────────────────────────────────────────────
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
              <MaterialCommunityIcons name="image-off-outline" size={28} color={T.barkLight} />
            )}
            {hasDiscount && (
              <View style={styles.discountFlag}>
                <Text style={styles.discountFlagText}>{discountPct}%</Text>
                <Text style={styles.discountFlagOff}>OFF</Text>
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.unit} numberOfLines={1}>{p.unit || ""}</Text>
            <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
            <View style={styles.priceRow}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.price}>₹{p.price}</Text>
                {hasDiscount && (
                  <Text style={styles.oldPrice}>₹{p.original_price}</Text>
                )}
              </View>
              {cartItem ? (
                <View style={styles.qtyBox}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={handleMinus} hitSlop={6}>
                    <MaterialCommunityIcons name="minus" size={12} color={T.white} />
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={handlePlus} hitSlop={6}>
                    <MaterialCommunityIcons name="plus" size={12} color={T.white} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addBtn} activeOpacity={0.85} onPress={handleAdd}>
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

const LegacyItemCard = React.memo(function LegacyItemCard({ item }: { item: DisplayItem }) {
  const onPress = useCallback(() => {
    router.push({ pathname: "/support/search" as any, params: { q: item.name } });
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
          <MaterialCommunityIcons name="image-off-outline" size={28} color={T.barkLight} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.unit} numberOfLines={1}>{item.unit || ""}</Text>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{item.price}</Text>
          <View style={styles.findBtn}>
            <MaterialCommunityIcons name="magnify" size={13} color={T.green} />
            <Text style={styles.findText}>FIND</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

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
                <MaterialCommunityIcons name="basket-outline" size={18} color={T.green} />
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
      <Text style={styles.chipLabel} numberOfLines={2}>{title}</Text>
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

  // ── Orders (SWR pattern) ────────────────────────────────────────────────
  const fetchOrders = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      if (!userId) { setOrders([]); setLoading(false); return; }
      if (!opts?.isRefresh) setLoading(true);
      try {
        const data = await getUserOrders(userId);
        setOrders(data);
        setError(null);
      } catch (err) {
        console.warn("[OrderAgain] fetch failed", err);
        setError(err instanceof Error ? err.message : "Could not load your orders. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

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

  // ── Reorder all items from a previous order ─────────────────────────────
  const handleReorderAll = useCallback(
    (order: Order) => {
      const items = getOrderItems(order);
      const byId = new Map<string, Product>();
      if (allProducts) for (const p of allProducts) byId.set(p.id, p);

      let addedCount = 0;
      for (const it of items) {
        const productId = it.master_product_id ?? it.product_id ?? it.id;
        const catalog = productId ? byId.get(String(productId)) : undefined;
        if (catalog) {
          addItem({
            product_id: catalog.id,
            name: catalog.name,
            price: catalog.price,
            unit: catalog.unit,
            image_url: catalog.image_url,
          });
          addedCount++;
        }
      }
      if (addedCount > 0) {
        router.push("/(tabs)/cart" as any);
      }
    },
    [addItem, allProducts],
  );

  // ── Build DisplayItems ─────────────────────────────────────────────────
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

    const out: DisplayItem[] = [];
    for (const it of orderItems) {
      const catalog = (it.masterProductId && byMasterId.get(it.masterProductId)) || matchByName(it);
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
          category: "Others",
          purchasable: false,
          totalQty: it.totalQty,
        });
      }
    }
    return out;
  }, [orders, allProducts]);

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

  const primaryChips = chips.slice(0, 6);
  const secondaryChips = chips.slice(6);

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
  const renderDisplayItem = useCallback(
    ({ item }: { item: DisplayItem }) => (
      <View style={{ width: 148 }}>
        {item.product ? (
          <ProductCard
            p={item.product}
            cartItem={cartItemsByProductId.get(item.product.id)}
            onAdd={handleAdd}
            onUpdateQty={handleUpdateQty}
          />
        ) : (
          <LegacyItemCard item={item} />
        )}
      </View>
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
          <MaterialCommunityIcons name="account-outline" size={64} color={T.barkLight} />
          <Text style={styles.emptyTitle}>Sign in to see your orders</Text>
          <Text style={styles.emptyText}>
            Reorder your favourites in one tap once you&apos;re signed in.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/phone" as any)}>
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
          <MaterialCommunityIcons name="basket-outline" size={64} color={T.barkLight} />
          <Text style={styles.emptyTitle}>No past orders yet</Text>
          <Text style={styles.emptyText}>
            Once you place your first order, come back here to reorder in a tap.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)/home" as any)}>
            <Text style={styles.primaryBtnText}>Start shopping</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Full screen ─────────────────────────────────────────────────────────
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
            <MaterialCommunityIcons name="alert-circle-outline" size={24} color={C.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Previous Orders — user's full order history with dates ────── */}
        {orders && orders.length > 0 && (
          <PreviousOrdersSection
            orders={orders}
            onReorderAll={handleReorderAll}
            allProducts={allProducts}
          />
        )}

        {/* ── Frequently bought category chips ─────────────────────────── */}
        {primaryChips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently bought</Text>
            <View style={styles.chipGrid}>
              {primaryChips.map((chip) => {
                const items = itemsByCategory[chip.name] || [];
                return (
                  <GroupChip
                    key={chip.name}
                    title={chip.name}
                    count={chip.count}
                    sampleImages={items.map((p) => p.image)}
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
                return (
                  <GroupChip
                    key={chip.name}
                    title={chip.name}
                    count={chip.count}
                    sampleImages={items.map((p) => p.image)}
                    onPress={() => handleChipPress(chip)}
                  />
                );
              })}
            </View>
          </View>
        )}

        {/* ── Per-group horizontal carousels ───────────────────────────── */}
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

        {/* ── Previously Bought full grid ───────────────────────────────── */}
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

// ─── Header ──────────────────────────────────────────────────────────────────
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

  scrollContent: { paddingBottom: 130, paddingTop: 0 },

  centerEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  emptyTitle: { color: T.bark, fontSize: 17, fontWeight: "800", marginTop: 6 },
  emptyText: { color: T.barkLight, fontSize: 14, textAlign: "center", lineHeight: 20 },
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

  // ── Section wrapper ────────────────────────────────────────────────────────
  // Each section sits inside a white card-like band separated by a thin
  // divider, so the eye moves cleanly from one group to the next.
  section: {
    marginTop: 0,
    paddingHorizontal: 0,
    // Separator line above every section (except the very first which has the
    // order cards above it — handled by marginTop on the scroll content).
    borderTopWidth: 8,
    borderTopColor: T.bg,
    backgroundColor: T.white,
    paddingTop: 18,
    paddingBottom: 18,
  },
  sectionTitle: {
    fontSize: 17,
    color: T.bark,
    fontWeight: "900",
    letterSpacing: -0.2,
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  // ── Category chip grid (Frequently bought / More that you ordered) ─────────
  // 3-column grid that fills full width; each chip is self-contained.
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
  },
  chipOuter: {
    width: "33.33%",
    padding: 6,
    alignItems: "center",
  },
  chipImageWrap: {
    width: "100%",
    aspectRatio: 1.05,
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
    width: 42,
    height: 42,
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
    fontSize: 11.5,
    color: T.bark,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 15,
  },

  // ── Horizontal carousel (per-group) ────────────────────────────────────────
  // Cards in the carousel keep a fixed width (140) because they scroll
  // horizontally — that's intentional and correct here.
  hListContent: {
    paddingHorizontal: 16,
    gap: 10,
    paddingVertical: 2,
  },

  // ── Previously Bought — responsive 2-column grid ───────────────────────────
  // Using 2 columns (50% each) instead of 3 × fixed-140px cards so nothing
  // overflows. Cards fill their cell width via flex: 1.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
  },
  gridCell: {
    width: "50%",
    padding: 6,
  },

  // ── Product / legacy card ──────────────────────────────────────────────────
  // Remove the fixed `width: 140` — cards in the grid should be fluid.
  // The horizontal carousel wraps cards in its own fixed-width container, so
  // fluid width is fine there too (FlatList gives each item natural size).
  card: {
    flex: 1,                 // fills the gridCell width
    minWidth: 130,           // guard for very narrow cells
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: "hidden",
  },
  // Cards inside the horizontal FlatList need an explicit width because flex
  // has no parent constraint in a horizontal scroll. We apply this via an
  // inline style on the FlatList renderItem wrapper (see renderDisplayItem).
  imageWrap: {
    width: "100%",
    height: 110,
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
  discountFlagText: { color: T.white, fontSize: 10, fontWeight: "900", lineHeight: 11 },
  discountFlagOff: { color: T.white, fontSize: 7.5, fontWeight: "800", lineHeight: 9 },
  cardBody: { padding: 8 },
  unit: { fontSize: 10, color: T.barkLight, fontWeight: "700", marginBottom: 3 },
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
  price: { color: T.bark, fontSize: 13, fontWeight: "900", letterSpacing: -0.3 },
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
  addText: { fontSize: 11.5, color: T.green, fontWeight: "900", letterSpacing: 0.8 },
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
  findText: { fontSize: 11, color: T.green, fontWeight: "900", letterSpacing: 0.5 },
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