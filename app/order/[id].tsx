import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { getUserOrders, type Order } from "../../lib/orderService";

const TIMELINE: { key: string; label: string; icon: string }[] = [
  { key: "pending_at_store",  label: "Order Placed",       icon: "receipt" },
  { key: "accepted_by_store", label: "Store Accepted",     icon: "store-check-outline" },
  { key: "awaiting_rider",    label: "Finding Rider",      icon: "account-search-outline" },
  { key: "rider_assigned",    label: "Rider Assigned",     icon: "bike" },
  { key: "out_for_delivery",  label: "Out for Delivery",   icon: "map-marker-path" },
  { key: "delivered",         label: "Delivered",          icon: "check-circle" },
];

const CANCELLED_KEYS = ["cancelled", "rejected_by_store"];

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  pending_at_store:   { color: C.warning,  bg: C.warningLight },
  accepted_by_store:  { color: C.primary,  bg: C.primaryXLight },
  awaiting_rider:     { color: C.warning,  bg: C.warningLight },
  rider_assigned:     { color: C.info,     bg: C.infoLight },
  out_for_delivery:   { color: C.info,     bg: C.infoLight },
  delivered:          { color: C.success,  bg: C.successLight },
  cancelled:          { color: C.danger,   bg: C.dangerLight },
  rejected_by_store:  { color: C.danger,   bg: C.dangerLight },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);

  useEffect(() => {
    if (userId) loadOrder();
  }, [id, userId]);

  // Auto-refresh order status every 10 seconds if order is not in final state
  useEffect(() => {
    if (!order || !userId) return;

    const finalStates = ['delivered', 'cancelled', 'rejected_by_store'];
    const isFinalState = finalStates.includes(order.order_status ?? '');

    if (isFinalState) return;

    const interval = setInterval(async () => {
      setAutoRefreshing(true);
      await loadOrder(true);
      setAutoRefreshing(false);
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [order?.order_status, userId]);

  const loadOrder = async (isRefresh = false) => {
    if (!userId) return;
    if (!isRefresh) setLoading(true);
    try {
      const orders = await getUserOrders(userId);
      const found = orders.find((o) => o.id === id);
      setOrder(found ?? null);
    } catch (err) {
      console.error('Failed to load order:', err);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrder(true);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={{ width: 38 }} />
        </View>
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.centerState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Order not found</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back to orders</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isCancelled = CANCELLED_KEYS.includes(order.order_status ?? "");
  const currentStatusIndex = TIMELINE.findIndex((s) => s.key === order.order_status);
  const statusStyle = STATUS_COLORS[order.order_status ?? ""] ?? { color: C.textSub, bg: C.bgSoft };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {order.order_status === 'delivered' ? 'Invoice' : 'Order Details'}
        </Text>
        {autoRefreshing && order.order_status !== 'delivered' ? (
          <View style={styles.autoRefreshIndicator}>
            <ActivityIndicator size="small" color={C.primary} />
          </View>
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* Order meta */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNum}>
                #{order.order_number || order.id.slice(0, 8).toUpperCase()}
              </Text>
              <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.statusText, { color: statusStyle.color }]}>
                {order.order_status?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={15} color={C.textSub} />
            <Text style={styles.infoText} numberOfLines={2}>
              {order.delivery_address || "—"}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="credit-card-outline" size={15} color={C.textSub} />
            <Text style={styles.infoText}>
              {order.payment_method === "cod" ? "Cash on Delivery" : "UPI"} ·{" "}
              <Text style={[
                order.payment_status === "paid"
                  ? { color: C.success }
                  : { color: C.warning }
              ]}>
                {order.payment_status === "paid" ? "Paid" : "Pending"}
              </Text>
            </Text>
          </View>
        </View>

        {/* Status timeline or Invoice */}
        {order.order_status === 'delivered' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Invoice Details</Text>
            <View style={styles.invoiceCard}>
              <View style={styles.invoiceHeader}>
                <MaterialCommunityIcons name="file-document-check" size={32} color={C.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceTitle}>Order Delivered Successfully</Text>
                  <Text style={styles.invoiceDate}>{formatDate(order.created_at)}</Text>
                </View>
              </View>
              <View style={styles.invoiceDivider} />
              <View style={styles.invoiceRow}>
                <Text style={styles.invoiceLabel}>Invoice Number</Text>
                <Text style={styles.invoiceValue}>{order.order_number || order.id.slice(0, 8).toUpperCase()}</Text>
              </View>
              <View style={styles.invoiceRow}>
                <Text style={styles.invoiceLabel}>Payment Method</Text>
                <Text style={styles.invoiceValue}>{order.payment_method === "cod" ? "Cash on Delivery" : "UPI"}</Text>
              </View>
              <View style={styles.invoiceRow}>
                <Text style={styles.invoiceLabel}>Payment Status</Text>
                <Text style={[styles.invoiceValue, { color: order.payment_status === "paid" ? C.success : C.warning }]}>
                  {order.payment_status === "paid" ? "Paid" : "Pending"}
                </Text>
              </View>
            </View>
          </View>
        ) : !isCancelled ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order Status</Text>
            <View style={styles.timeline}>
              {TIMELINE.map((step, index) => {
                const isDone = currentStatusIndex >= index;
                const isActive = currentStatusIndex === index;
                const isLast = index === TIMELINE.length - 1;

                return (
                  <View key={step.key} style={styles.timelineRow}>
                    <View style={styles.timelineLeft}>
                      <View
                        style={[
                          styles.timelineDot,
                          isDone && styles.timelineDotDone,
                          isActive && styles.timelineDotActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={step.icon as any}
                          size={14}
                          color={isDone ? "#fff" : C.textLight}
                        />
                      </View>
                      {!isLast && (
                        <View style={[styles.timelineLine, isDone && index < currentStatusIndex && styles.timelineLineDone]} />
                      )}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text
                        style={[
                          styles.timelineLabel,
                          isDone && { color: C.text, fontWeight: "700" },
                          isActive && { color: C.primary },
                        ]}
                      >
                        {step.label}
                      </Text>
                      {isActive && (
                        <Text style={styles.timelineActiveHint}>Current status</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <View style={styles.cancelledBanner}>
            <MaterialCommunityIcons name="close-circle-outline" size={24} color={C.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cancelledTitle}>Order Cancelled</Text>
              <Text style={styles.cancelledSub}>This order was not fulfilled.</Text>
            </View>
          </View>
        )}

        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items Ordered</Text>
          <View style={styles.itemsCard}>
            {order.items?.map((item, i) => (
              <View
                key={i}
                style={[styles.itemRow, i < order.items!.length - 1 && styles.itemRowBorder]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemUnit}>₹{item.price} / {item.unit}</Text>
                </View>
                <View style={styles.itemRight}>
                  <Text style={styles.itemQty}>×{item.quantity}</Text>
                  <Text style={styles.itemTotal}>
                    ₹{(item.price * item.quantity).toFixed(2)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Bill */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill Summary</Text>
          <View style={styles.billCard}>
            <BillLine label="Subtotal" value={`₹${(order.subtotal ?? 0).toFixed(2)}`} />
            <BillLine label="Delivery fee" value={`₹${(order.delivery_fee ?? 0).toFixed(2)}`} />
            <View style={styles.billDivider} />
            <BillLine
              label="Total Paid"
              value={`₹${order.order_total.toFixed(2)}`}
              bold
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BillLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billLabelBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  autoRefreshIndicator: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollContent: { paddingBottom: 40 },

  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  notFoundText: { color: C.text, fontSize: 16, fontWeight: "700" },
  backLink: { color: C.primary, fontSize: 14, fontWeight: "600" },

  metaCard: {
    backgroundColor: C.card,
    margin: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  orderNum: { color: C.text, fontSize: 17, fontWeight: "800" },
  orderDate: { color: C.textSub, fontSize: 12, marginTop: 3 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusText: { fontSize: 12, fontWeight: "700" },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  infoText: { color: C.textSub, fontSize: 13, flex: 1, lineHeight: 19 },

  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 12,
  },

  timeline: { gap: 0 },
  timelineRow: { flexDirection: "row", gap: 14 },
  timelineLeft: { alignItems: "center", width: 32 },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineDotDone: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  timelineDotActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: C.border,
    marginVertical: 2,
    minHeight: 28,
  },
  timelineLineDone: { backgroundColor: C.primary },
  timelineContent: {
    flex: 1,
    paddingBottom: 28,
    justifyContent: "center",
  },
  timelineLabel: { color: C.textLight, fontSize: 14 },
  timelineActiveHint: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },

  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: C.dangerLight,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  cancelledTitle: { color: C.danger, fontSize: 15, fontWeight: "800" },
  cancelledSub: { color: C.danger, fontSize: 13, marginTop: 2, opacity: 0.8 },

  invoiceCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.successLight,
    padding: 18,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  invoiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  invoiceTitle: {
    color: C.success,
    fontSize: 16,
    fontWeight: "800",
  },
  invoiceDate: {
    color: C.textSub,
    fontSize: 12,
    marginTop: 3,
  },
  invoiceDivider: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 14,
  },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  invoiceLabel: {
    color: C.textSub,
    fontSize: 14,
    fontWeight: "600",
  },
  invoiceValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },

  itemsCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { color: C.text, fontSize: 14, fontWeight: "600" },
  itemUnit: { color: C.textSub, fontSize: 12, marginTop: 2 },
  itemRight: { alignItems: "flex-end", gap: 2 },
  itemQty: { color: C.textSub, fontSize: 12 },
  itemTotal: { color: C.primary, fontSize: 14, fontWeight: "800" },

  billCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  billLabel: { color: C.textSub, fontSize: 14 },
  billLabelBold: { color: C.text, fontWeight: "800", fontSize: 15 },
  billValue: { color: C.text, fontSize: 14, fontWeight: "500" },
  billValueBold: { color: C.primary, fontWeight: "900", fontSize: 16 },
  billDivider: { height: 1, backgroundColor: C.border, marginVertical: 4 },
});
