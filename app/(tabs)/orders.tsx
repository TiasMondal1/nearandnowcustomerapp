import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { getUserOrders, type Order } from "../../lib/orderService";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_at_store:   { label: "Pending",        color: C.warning, bg: C.warningLight },
  accepted_by_store:  { label: "Accepted",        color: C.primary, bg: C.primaryXLight },
  awaiting_rider:     { label: "Finding rider",   color: C.warning, bg: C.warningLight },
  rider_assigned:     { label: "Rider assigned",  color: C.info,    bg: C.infoLight },
  out_for_delivery:   { label: "On the way",      color: C.info,    bg: C.infoLight },
  delivered:          { label: "Delivered",       color: C.success, bg: C.successLight },
  cancelled:          { label: "Cancelled",       color: C.danger,  bg: C.dangerLight },
  rejected_by_store:  { label: "Rejected",        color: C.danger,  bg: C.dangerLight },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function OrdersScreen() {
  const { userId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!userId) { setLoading(false); return; }
    const task = InteractionManager.runAfterInteractions(() => {
      fetchOrders();
    });
    return () => task.cancel();
  }, [fetchOrders, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders(true);
    setRefreshing(false);
  }, [fetchOrders]);

  const renderOrder = ({ item }: { item: Order }) => {
    const status = item.order_status ?? "";
    const meta = STATUS_META[status] || {
      label: status,
      color: C.textSub,
      bg: C.bgSoft,
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNum}>#{item.order_number || item.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
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
            <Text style={styles.totalLabel}>Total paid</Text>
            <Text style={styles.total}>₹{Number(item.order_total).toFixed(2)}</Text>
          </View>
          {status === "delivered" ? (
            <TouchableOpacity
              style={[styles.trackBtn, styles.invoiceBtn]}
              onPress={() => router.push(`/order/${item.id}` as any)}
            >
              <MaterialCommunityIcons name="file-document-outline" size={14} color="#fff" />
              <Text style={styles.trackText}>View Invoice</Text>
            </TouchableOpacity>
          ) : ["cancelled", "rejected_by_store"].includes(status) ? (
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
              onPress={() => router.push(`/order/${item.id}` as any)}
            >
              <MaterialCommunityIcons name="map-marker-path" size={14} color="#fff" />
              <Text style={styles.trackText}>Track Order</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Orders</Text>
        </View>
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
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Orders</Text>
        </View>
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Orders</Text>
        {orders.length > 0 && (
          <Text style={styles.orderCount}>{orders.length} order{orders.length !== 1 ? "s" : ""}</Text>
        )}
      </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  orderCount: { color: C.textSub, fontSize: 13, fontWeight: "600" },

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

  list: { paddingTop: 14, paddingBottom: 110 },

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
  trackText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  empty: { marginTop: 80, alignItems: "center", gap: 10, padding: 32 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  emptyText: { color: C.textSub, fontSize: 14, textAlign: "center" },
});
