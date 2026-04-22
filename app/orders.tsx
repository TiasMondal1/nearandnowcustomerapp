import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PaymentProcessingOverlay } from "../components/PaymentProcessingOverlay";
import { C } from "../constants/colors";
import { CANCELLED_STATUSES, getStatusMeta } from "../constants/orderStatus";
import { useAuth } from "../context/AuthContext";
import { usePaymentFlow } from "../hooks/usePaymentFlow";
import {
    getUserOrders,
    readUserOrdersCache,
    type Order,
} from "../lib/orderService";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function OrdersScreen() {
  const { userId, user, customer } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();

  const fetchOrders = useCallback(async (isRefresh = false) => {
    try {
      if (!userId) {
        setOrders([]);
        setLoading(false);
        return;
      }
      if (!isRefresh) setLoading(true);
      const data = await getUserOrders(userId);
      setOrders(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch orders:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load orders. Please try again.";
      setError(message);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
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
    await fetchOrders(true);
    setRefreshing(false);
  }, [fetchOrders]);

  const handleRetryPayment = useCallback(
    async (order: Order) => {
      const result = await payForOrder({
        internalOrderId: order.id,
        amount: order.order_total,
        customer: {
          name: user?.name || "Customer",
          email: user?.email || undefined,
          phone: user?.phone || customer?.phone || undefined,
        },
        description: `Payment for order #${order.order_number || order.id.slice(0, 8).toUpperCase()}`,
      });

      if (result.status === "paid") {
        Alert.alert("Payment successful", "Your order has been paid.");
        fetchOrders(true);
        return;
      }
      if (result.status === "error") {
        Alert.alert("Payment unavailable", result.message);
        return;
      }
      fetchOrders(true);
      if (result.reason === "cancelled") return;
      Alert.alert("Payment not completed", result.message ?? "Please try again.");
    },
    [payForOrder, user, customer, fetchOrders],
  );

  const renderOrder = ({ item }: { item: Order }) => {
    const status = item.order_status ?? "";
    const meta = getStatusMeta(status);

    const paymentMethod = (item.payment_method ?? "").toLowerCase();
    const isOnline = paymentMethod !== "cod" && paymentMethod !== "cash_on_delivery";
    const isCancelled = CANCELLED_STATUSES.includes(status as any);
    const isDelivered = status === "order_delivered";
    const needsPayment =
      isOnline && item.payment_status === "pending" && !isCancelled;

    const totalLabel = item.payment_status === "paid" ? "Total paid" : "Total payable";

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNum}>#{item.order_number || item.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {needsPayment && (
              <View style={[styles.statusBadge, { backgroundColor: C.warningLight }]}>
                <Text style={[styles.statusText, { color: C.warning }]}>Payment pending</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.itemsWrap}>
          {item.items?.slice(0, 3).map((it, idx) => (
            <Text key={idx} style={styles.itemLine} numberOfLines={1}>
              • {it.name} ×{it.quantity}
            </Text>
          ))}
          {(item.items?.length ?? 0) > 3 && (
            <Text style={styles.moreItems}>+{item.items!.length - 3} more items</Text>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.totalLabel}>{totalLabel}</Text>
            <Text style={styles.total}>₹{Number(item.order_total).toFixed(2)}</Text>
          </View>
          {needsPayment ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={[styles.trackBtn, styles.secondaryBtn]}
                onPress={() => router.push(`/order/${item.id}` as any)}
              >
                <Text style={[styles.trackText, { color: C.text }]}>Details</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.trackBtn, styles.payNowBtn]}
                onPress={() => handleRetryPayment(item)}
                disabled={paymentPhase !== "idle"}
              >
                <MaterialCommunityIcons name="credit-card-fast-outline" size={14} color="#fff" />
                <Text style={styles.trackText}>Pay now</Text>
              </TouchableOpacity>
            </View>
          ) : isDelivered ? (
            <TouchableOpacity
              style={[styles.trackBtn, styles.invoiceBtn]}
              onPress={() => router.push(`/order/${item.id}` as any)}
            >
              <MaterialCommunityIcons name="file-document-outline" size={14} color="#fff" />
              <Text style={styles.trackText}>View Invoice</Text>
            </TouchableOpacity>
          ) : isCancelled ? (
            <TouchableOpacity
              style={[styles.trackBtn, styles.detailsBtn]}
              onPress={() => router.push(`/order/${item.id}` as any)}
            >
              <MaterialCommunityIcons name="information-outline" size={14} color="#fff" />
              <Text style={styles.trackText}>View Details</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => router.push(`/order/track/${item.id}` as any)}
            >
              <MaterialCommunityIcons name="map-marker-path" size={14} color="#fff" />
              <Text style={styles.trackText}>Track Order</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const Header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>Previous Orders</Text>
        {orders.length > 0 && (
          <Text style={styles.orderCount}>
            {orders.length} order{orders.length !== 1 ? "s" : ""}
          </Text>
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        {Header}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading your orders...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && orders.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        {Header}
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons name="alert-circle-outline" size={64} color={C.danger} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchOrders()}>
            <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {Header}

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="package-variant-closed" size={56} color={C.textLight} />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptyText}>Your order history will appear here</Text>
          </View>
        }
        renderItem={renderOrder}
      />
      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bgSoft,
  },
  headerTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  orderCount: { color: C.textSub, fontSize: 12, fontWeight: "600", marginTop: 2 },

  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 32,
  },

  loadingText: {
    color: C.textSub,
    fontSize: 14,
  },

  errorTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 12,
  },

  errorText: {
    color: C.textSub,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },

  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },

  retryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  list: { paddingTop: 14, paddingBottom: 40 },

  card: {
    backgroundColor: C.card,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 10,
  },
  orderNum: { color: C.text, fontWeight: "800", fontSize: 15 },
  orderDate: { color: C.textSub, fontSize: 12, marginTop: 3 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: { fontSize: 12, fontWeight: "700" },

  itemsWrap: { gap: 4, marginBottom: 14 },
  itemLine: { color: C.textSub, fontSize: 13 },
  moreItems: { color: C.textLight, fontSize: 12, fontStyle: "italic" },

  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalLabel: { color: C.textSub, fontSize: 11, fontWeight: "600", marginBottom: 2 },
  total: { color: C.text, fontSize: 18, fontWeight: "900" },
  trackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  invoiceBtn: {
    backgroundColor: C.success,
  },
  detailsBtn: {
    backgroundColor: C.textSub,
  },
  payNowBtn: {
    backgroundColor: C.warning,
    shadowColor: C.warning,
  },
  secondaryBtn: {
    backgroundColor: C.bgSoft,
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 1,
    borderColor: C.border,
  },
  trackText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  empty: { marginTop: 80, alignItems: "center", gap: 10, padding: 32 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  emptyText: { color: C.textSub, fontSize: 14, textAlign: "center" },
});
