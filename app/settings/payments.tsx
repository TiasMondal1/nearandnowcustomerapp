// Payments history: one row per order with the real method label (C22), status badge and amount. Reads the
// memory mirror first (`getMemoryOrders()`), otherwise one `getUserOrders` call; pull-to-refresh forces the network.
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { orderDateLabel } from "../../components/orders/OrderRow";
import {
  Badge,
  EmptyState,
  IconWrap,
  ListRow,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  type BadgeTone,
  type IconName,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { paymentMethodLabel } from "../../constants/orderStatus";
import { fontFamily, layout, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { logError } from "../../lib/logError";
import { getMemoryOrders, getUserOrders, type Order } from "../../lib/orderService";

type Payment = {
  id: string;
  orderCode: string;
  amount: string;
  method: string;
  icon: IconName;
  dateLabel: string;
  badge: { label: string; tone: BadgeTone };
};

const SKELETON_ROWS = [0, 1, 2, 3] as const;

const METHOD_ICON: Record<string, IconName> = {
  cod: "cash",
  upi: "qrcode-scan",
  card: "credit-card-outline",
  netbanking: "bank-outline",
  wallet: "wallet-outline",
};

/**
 * COD orders stay `payment_status: pending` by design (lib/invoiceEligibility.ts), so the badge reads the order
 * status for them; online methods read `payment_status`.
 */
function paymentBadge(order: Order): Payment["badge"] {
  const method = (order.payment_method ?? "").toLowerCase();
  const status = (order.payment_status ?? "").toLowerCase();
  if (order.order_status === "order_cancelled") return { label: "Cancelled", tone: "neutral" };
  if (method === "cod" || method === "cash_on_delivery") {
    if (status === "paid" || order.order_status === "order_delivered") return { label: "Paid on delivery", tone: "success" };
    return { label: "Due on delivery", tone: "neutral" };
  }
  if (status === "paid") return { label: "Paid", tone: "success" };
  if (status === "refunded" || status === "partially_refunded") return { label: "Refunded", tone: "info" };
  if (status === "failed") return { label: "Failed", tone: "danger" };
  return { label: "Pending", tone: "warning" };
}

function toPayment(order: Order): Payment {
  const method = (order.payment_method ?? "").toLowerCase();
  return {
    id: order.id,
    orderCode: order.order_number || order.id.slice(0, 8).toUpperCase(),
    amount: formatMoney(order.order_total),
    method: paymentMethodLabel(order.payment_method),
    icon: METHOD_ICON[method] ?? "credit-card-outline",
    dateLabel: orderDateLabel(order),
    badge: paymentBadge(order),
  };
}

const keyExtractor = (item: Payment) => item.id;

const PaymentRow = React.memo(function PaymentRow({ item, divider }: { item: Payment; divider: boolean }) {
  return (
    <ListRow
      title={`#${item.orderCode}`}
      subtitle={`${item.method} · ${item.dateLabel}`}
      left={<IconWrap size={34} bg="transparent" icon={item.icon} iconSize={20} iconColor={C.textSub} />}
      right={
        <View style={styles.rowRight}>
          <Text style={styles.amount} maxFontSizeMultiplier={1.3}>
            {item.amount}
          </Text>
          <Badge label={item.badge.label} tone={item.badge.tone} size="sm" pill />
        </View>
      }
      onPress={() => router.push(`/order/${item.id}`)}
      divider={divider}
      accessibilityLabel={`Order ${item.orderCode}, ${item.method}, ${item.dateLabel}, ${item.amount}, ${item.badge.label.toLowerCase()}`}
    />
  );
});

/** Four ListRow twins (glyph · two lines · amount + badge). */
function PaymentsSkeleton() {
  return (
    <SkeletonScreen label="Loading payments">
      {SKELETON_ROWS.map((i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton width={34} height={34} radius={radius.lg} />
          <View style={styles.skelLines}>
            <Skeleton width="40%" height={14} />
            <Skeleton width="65%" height={12} />
          </View>
          <View style={styles.skelRight}>
            <Skeleton width={56} height={16} />
            <Skeleton width={48} height={18} radius={radius.pill} />
          </View>
        </View>
      ))}
    </SkeletonScreen>
  );
}

export default function PaymentsScreen() {
  const { userId } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(() => getMemoryOrders());
  const [loading, setLoading] = useState(() => getMemoryOrders() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const fetchPayments = useCallback(
    async (force = false) => {
      if (!userId) {
        setOrders([]);
        setLoading(false);
        return;
      }
      const seq = ++seqRef.current;
      try {
        const data = await getUserOrders(userId, { force });
        if (seq !== seqRef.current) return;
        setOrders(data);
        setError(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        logError("Fetch payments", err);
        setError(err instanceof Error ? err.message : "Couldn't load payments");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [userId],
  );

  // Once: the memory mirror paints instantly when another screen already fetched; otherwise one list call.
  useEffect(() => {
    if (getMemoryOrders() === null) fetchPayments();
    else setLoading(false);
  }, [fetchPayments]);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    await fetchPayments(true);
    setRefreshing(false);
  }, [fetchPayments]);

  const payments = useMemo(() => (orders ?? []).map(toPayment), [orders]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Payment>) => <PaymentRow item={item} divider={index < payments.length - 1} />,
    [payments.length],
  );

  const showSkeleton = useForceSkeleton(loading && payments.length === 0);
  const slow = useSlowLoad(showSkeleton);
  const header = <ScreenHeader title="Payments" backFallbackHref="/(tabs)/home" />;

  if (showSkeleton) {
    return (
      <Screen bg={C.card}>
        {header}
        <PaymentsSkeleton />
        {slow ? (
          <View style={styles.slowWrap}>
            <Text style={styles.slowText}>Still loading… check your connection</Text>
            <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={() => fetchPayments(true)} />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (error && payments.length === 0) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load payments"
          text={error}
          action={{ label: "Retry", icon: "refresh", onPress: () => fetchPayments(true) }}
        />
      </Screen>
    );
  }

  return (
    <Screen bg={C.card}>
      {header}
      <FlashList
        data={payments}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
        ListEmptyComponent={
          <EmptyState
            iconWrap
            icon="credit-card-outline"
            title="No payments yet"
            text="Your payment history will appear here"
            action={{ label: "Start shopping", onPress: () => router.dismissTo("/(tabs)/home") }}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: layout.scrollBottom },
  rowRight: { alignItems: "flex-end", gap: 4 },
  amount: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, fontVariant: ["tabular-nums"] },

  slowWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  slowText: { ...text.caption, textAlign: "center" },
  skelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: layout.rowGap,
    paddingHorizontal: layout.rowPaddingX,
    paddingVertical: layout.rowPaddingY,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  skelLines: { flex: 1, gap: 6 },
  skelRight: { alignItems: "flex-end", gap: 6 },
});
