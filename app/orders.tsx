import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { PaymentProcessingOverlay } from "../components/PaymentProcessingOverlay";
import {
    Badge,
    Card,
    EmptyState,
    PrimaryButton,
    Screen,
    ScreenHeader,
    Skeleton,
} from "../components/ui";
import { C } from "../constants/colors";
import { CANCELLED_STATUSES, getStatusMeta } from "../constants/orderStatus";
import { text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { usePaymentFlow } from "../hooks/usePaymentFlow";
import {
    getUserOrders,
    readUserOrdersCache,
    type Order,
} from "../lib/orderService";
import { logError } from "../lib/logError";
import { formatQuantityDisplay } from "../lib/quantityFormat";
import { payOrderWithWallet } from "../lib/walletService";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

const OrderCard = React.memo(function OrderCard({
  item,
  paymentPhase,
  walletPayingOrderId,
  onRetryPayment,
}: {
  item: Order;
  paymentPhase: string;
  walletPayingOrderId: string | null;
  onRetryPayment: (order: Order) => void;
}) {
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
    <Card shadow="card" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerText}>
          <Text style={styles.orderNum} numberOfLines={1}>
            #{item.order_number || item.id.slice(0, 8).toUpperCase()}
          </Text>
          <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
        </View>
        <View style={styles.badgeCol}>
          <Badge
            label={meta.label}
            bg={meta.bg}
            color={meta.color}
            pill
            style={styles.statusBadge}
            textStyle={styles.statusText}
          />
          {needsPayment && (
            <Badge
              label="Payment pending"
              bg={C.warningLight}
              color={C.warning}
              pill
              style={styles.statusBadge}
              textStyle={styles.statusText}
            />
          )}
        </View>
      </View>

      <View style={styles.itemsWrap}>
        {item.items?.slice(0, 3).map((it, idx) => (
          <Text key={idx} style={styles.itemLine} numberOfLines={1}>
            • {it.name} ×{formatQuantityDisplay(it.quantity)}
          </Text>
        ))}
        {(item.items?.length ?? 0) > 3 && (
          <Text style={styles.moreItems}>+{item.items!.length - 3} more items</Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.totalCol}>
          <Text style={styles.totalLabel}>{totalLabel}</Text>
          <Text style={styles.total} numberOfLines={1}>
            ₹{Number(item.order_total).toFixed(2)}
          </Text>
        </View>
        {needsPayment ? (
          <View style={styles.actionRow}>
            <PrimaryButton
              size="xs"
              variant="secondary"
              label="Details"
              onPress={() => router.push(`/order/${item.id}` as any)}
              style={styles.actionBtn}
            />
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.actionBtnShadow,
                styles.payNowBtn,
                (paymentPhase !== "idle" || walletPayingOrderId === item.id) && styles.btnDisabled,
              ]}
              onPress={() => onRetryPayment(item)}
              disabled={paymentPhase !== "idle" || walletPayingOrderId === item.id}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{
                disabled: paymentPhase !== "idle" || walletPayingOrderId === item.id,
                busy: walletPayingOrderId === item.id,
              }}
            >
              {walletPayingOrderId === item.id ? (
                <ActivityIndicator size="small" color={C.card} />
              ) : (
                <MaterialCommunityIcons name="credit-card-fast-outline" size={16} color={C.card} />
              )}
              <Text style={styles.payNowText}>{walletPayingOrderId === item.id ? "Paying…" : "Pay now"}</Text>
            </TouchableOpacity>
          </View>
        ) : isDelivered ? (
          <PrimaryButton
            size="xs"
            variant="success"
            icon="file-document-outline"
            iconSize={16}
            label="View Invoice"
            onPress={() => router.push(`/order/invoice/${item.id}` as any)}
            style={[styles.actionBtn, styles.actionBtnShadow]}
          />
        ) : isCancelled ? (
          <PrimaryButton
            size="xs"
            icon="information-outline"
            iconSize={16}
            label="View Details"
            onPress={() => router.push(`/order/${item.id}` as any)}
            style={[styles.actionBtn, styles.actionBtnShadow, styles.detailsBtn]}
          />
        ) : (
          <PrimaryButton
            size="xs"
            icon="map-marker-path"
            iconSize={16}
            label="Track Order"
            onPress={() => router.push(`/order/track/${item.id}` as any)}
            style={[styles.actionBtn, styles.actionBtnShadow]}
          />
        )}
      </View>
    </Card>
  );
});

/** Placeholder with the exact OrderCard geometry, shown while the first fetch is in flight. */
function SkeletonOrderCard() {
  return (
    <Card shadow="card" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerText}>
          <Skeleton width={110} height={14} />
          <Skeleton width={150} height={10} style={styles.skelGap} />
        </View>
        <Skeleton width={84} height={22} radius={999} />
      </View>
      <View style={styles.itemsWrap}>
        <Skeleton width="70%" height={13} />
        <Skeleton width="55%" height={13} />
        <Skeleton width="62%" height={13} />
      </View>
      <View style={styles.cardFooter}>
        <View>
          <Skeleton width={56} height={10} />
          <Skeleton width={88} height={18} style={styles.skelGap} />
        </View>
        <Skeleton width={110} height={44} radius={12} />
      </View>
    </Card>
  );
}

export default function OrdersScreen() {
  const { userId, user, customer } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();
  // Wallet retry bypasses usePaymentFlow entirely (it has no "wallet" phase),
  // so paymentPhase never reflects it and the Pay-now button never actually
  // disables — mirrors usePaymentFlow's own inFlight ref to guard against a
  // fast double-tap firing two concurrent wallet debits. walletPayingId is
  // the state twin of the same guard, used only to drive the button's
  // loading/disabled UI (the ref remains the actual synchronous guard —
  // state updates aren't guaranteed to have committed before a second tap).
  const walletPaymentInFlight = useRef(false);
  const [walletPayingId, setWalletPayingId] = useState<string | null>(null);

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
      logError("Fetch orders", err);
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
      const paymentMethod = (order.payment_method ?? "").toLowerCase();
      if (paymentMethod === "wallet") {
        if (walletPaymentInFlight.current) return;
        walletPaymentInFlight.current = true;
        setWalletPayingId(order.id);
        try {
          await payOrderWithWallet(order.id);
          Alert.alert("Payment successful", "Your order has been paid from your wallet.");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Please try again.";
          Alert.alert("Payment failed", message);
        } finally {
          walletPaymentInFlight.current = false;
          setWalletPayingId(null);
          fetchOrders(true);
        }
        return;
      }

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

  const renderOrder = useCallback(({ item }: { item: Order }) => (
    <OrderCard item={item} paymentPhase={paymentPhase} walletPayingOrderId={walletPayingId} onRetryPayment={handleRetryPayment} />
  ), [paymentPhase, walletPayingId, handleRetryPayment]);

  const Header = (
    <ScreenHeader
      title="Previous Orders"
      subtitle={orders.length > 0 ? `${orders.length} order${orders.length !== 1 ? "s" : ""}` : undefined}
      align="left"
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
    />
  );

  if (loading) {
    return (
      <Screen>
        {Header}
        <View style={styles.list} accessible accessibilityLabel="Loading your orders">
          <SkeletonOrderCard />
          <SkeletonOrderCard />
          <SkeletonOrderCard />
        </View>
      </Screen>
    );
  }

  if (error && orders.length === 0) {
    return (
      <Screen>
        {Header}
        <EmptyState
          fill
          icon="alert-circle-outline"
          iconSize={64}
          iconColor={C.danger}
          title="Connection Error"
          text={error}
          action={{ label: "Retry", icon: "refresh", onPress: () => fetchOrders() }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {Header}

      <FlashList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="package-variant-closed"
            title="No orders yet"
            text="Your order history will appear here"
          />
        }
        renderItem={renderOrder}
      />
      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 16, paddingBottom: 40 },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 10,
  },
  headerText: { flex: 1 },
  orderNum: { color: C.text, fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16 },
  orderDate: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 12, marginTop: 4 },
  badgeCol: { alignItems: "flex-end", gap: 6, flexShrink: 1, maxWidth: "55%" },
  statusBadge: { alignSelf: "flex-end", paddingVertical: 4 },
  statusText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11 },

  itemsWrap: { gap: 4, marginBottom: 12 },
  itemLine: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textSub, fontSize: 13 },
  moreItems: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textLight, fontSize: 12 },

  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalCol: { flexShrink: 1, marginRight: 12 },
  totalLabel: { fontFamily: "PlusJakartaSans_600SemiBold",
    color: C.textSub,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  total: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 18 },
  actionRow: { flexDirection: "row", gap: 8, flexShrink: 0 },
  // Overrides on PrimaryButton size="xs" (r10 pv10) so every footer action clears a 44pt target.
  actionBtn: { paddingVertical: 12, minHeight: 44, borderRadius: 12 },
  actionBtnShadow: { shadowOpacity: 0.15, shadowRadius: 4, elevation: 2 },
  detailsBtn: { backgroundColor: C.textSub },
  // Pay now stays a local touchable: it swaps the icon for a spinner while keeping the
  // "Paying…" label visible, which PrimaryButton's `loading` mode does not do.
  payNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    backgroundColor: C.warning,
    shadowColor: C.warning,
    shadowOffset: { width: 0, height: 2 },
  },
  payNowText: { ...text.buttonXs },
  btnDisabled: { opacity: 0.6 },

  skelGap: { marginTop: 6 },
});
