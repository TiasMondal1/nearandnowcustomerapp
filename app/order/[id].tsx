import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { PaymentProcessingOverlay } from "../../components/PaymentProcessingOverlay";
import {
    Badge,
    Card,
    Divider,
    EmptyState,
    IconWrap,
    PrimaryButton,
    Screen,
    ScreenHeader,
    SectionLabel,
    Skeleton,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { PLATFORM_FEE, HANDLING_FEE } from "../../constants/fees";
import {
    CANCELLED_STATUSES,
    ORDER_TIMELINE,
    TERMINAL_STATUSES,
    getStatusMeta,
    getTimelineIndex,
} from "../../constants/orderStatus";
import { layout } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { usePaymentFlow } from "../../hooks/usePaymentFlow";
import { logError } from "../../lib/logError";
import { getOrderPaymentStatus, getUserOrders, type Order } from "../../lib/orderService";
import { formatQuantityDisplay } from "../../lib/quantityFormat";
import { supabase } from "../../lib/supabase";
import { payOrderWithWallet } from "../../lib/walletService";

// Fallback for when Realtime never delivers a single event on this screen —
// `customer_orders`' `customer_own_orders` RLS policy gates on `auth.uid()`,
// which is always NULL here since this app authenticates via its own
// phone-OTP JWT, never `supabase.auth` (documented dead-policy finding).
// Unlike the premium tracking screen's poll fallback (which genuinely is
// just a fallback, since that screen fetches its own data through a
// backend endpoint rather than Realtime's client-side RLS path), realtime
// is never expected to fire here at all — so this is the only source of
// live updates on this screen, not a redundant one.
const STATUS_POLL_MS = 8_000;

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
  const { userId, user, customer } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();
  // Wallet retry bypasses usePaymentFlow entirely (it has no "wallet" phase),
  // so paymentPhase never reflects it and the Pay-now button never actually
  // disables — mirrors usePaymentFlow's own inFlight ref to guard against a
  // fast double-tap firing two concurrent wallet debits. walletPaying is the
  // state twin of the same guard, used only to drive the button's
  // loading/disabled UI — the ref is the real synchronous guard.
  const walletPaymentInFlight = useRef(false);
  const [walletPaying, setWalletPaying] = useState(false);

  // Presentational only: the ring on the "Live tracking" CTA breathes outward.
  // Declared above the early returns so hook order stays stable; native
  // driver, looped, stopped on cleanup.
  const pulse = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [pulse]);
  const livePulseStyle = useMemo(
    () => ({
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
    }),
    [pulse],
  );

  useEffect(() => {
    if (userId) loadOrder();
  }, [id, userId]);

  // Supabase Realtime subscription for instant order status updates.
  // Requires: realtime enabled on customer_orders table in Supabase Dashboard
  //           + a SELECT RLS policy allowing the customer to read their own order.
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`order-status-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'customer_orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          const next = payload.new as any;
          const newStatus = next?.status as string | undefined;
          const newPaymentStatus = next?.payment_status as string | undefined;
          if (newStatus || newPaymentStatus) {
            setAutoRefreshing(true);
            setOrder((prev) =>
              prev
                ? {
                    ...prev,
                    ...(newStatus ? { order_status: newStatus } : {}),
                    ...(newPaymentStatus ? { payment_status: newPaymentStatus } : {}),
                  }
                : prev,
            );
            setTimeout(() => setAutoRefreshing(false), 800);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // Mirrors the realtime handler's merge shape exactly, so the status
  // badge/timeline update identically regardless of which source caught the
  // change. Kept in a ref (not read from `order` state directly) so the
  // comparison/early-terminal-exit stays outside the setState updater —
  // updaters here must stay pure, no side effects.
  const latestOrderSnapshotRef = useRef<{ status?: string; payment_status?: string } | null>(null);
  useEffect(() => {
    latestOrderSnapshotRef.current = order
      ? { status: order.order_status, payment_status: order.payment_status }
      : null;
  }, [order?.order_status, order?.payment_status]);

  useEffect(() => {
    if (!id) return;

    // `cancelled` guard matches the established pattern in
    // useOrderTracking.ts's driver-location poll — without it, a tick's
    // `await` can resolve after `id` has already changed or this screen has
    // unmounted, writing a stale/wrong order's status into state.
    let cancelled = false;

    const poll = async () => {
      const prevSnap = latestOrderSnapshotRef.current;
      if (prevSnap?.status && TERMINAL_STATUSES.includes(prevSnap.status as any)) return;
      const result = await getOrderPaymentStatus(id);
      if (cancelled || !result) return;
      const changed =
        (!!result.status && result.status !== prevSnap?.status) ||
        (!!result.payment_status && result.payment_status !== prevSnap?.payment_status);
      if (!changed) return;
      setAutoRefreshing(true);
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              ...(result.status ? { order_status: result.status } : {}),
              ...(result.payment_status ? { payment_status: result.payment_status } : {}),
            }
          : prev,
      );
      setTimeout(() => setAutoRefreshing(false), 800);
    };

    const intervalId = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [id]);

  const loadOrder = async (isRefresh = false) => {
    if (!userId) return;
    if (!isRefresh) setLoading(true);
    try {
      const orders = await getUserOrders(userId);
      const found = orders.find((o) => o.id === id);
      setOrder(found ?? null);
    } catch (err) {
      logError('Load order', err);
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
      <Screen>
        <ScreenHeader title="Order Details" onBack={() => router.back()} />
        <OrderDetailSkeleton />
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <ScreenHeader title="Order Details" onBack={() => router.back()} />
        <EmptyState fill icon="alert-circle-outline" iconSize={48} title="Order not found">
          <PrimaryButton
            size="sm"
            variant="secondary"
            label="Go back to orders"
            onPress={() => router.back()}
            style={styles.backLinkBtn}
            textStyle={styles.backLinkText}
          />
        </EmptyState>
      </Screen>
    );
  }

  const status = order.order_status ?? "";
  const isCancelled = CANCELLED_STATUSES.includes(status as any);
  const isDelivered = status === "order_delivered";
  const isInFlight = !TERMINAL_STATUSES.includes(status as any);
  const currentStatusIndex = getTimelineIndex(status);
  const statusMeta = getStatusMeta(status);

  const paymentMethod = (order.payment_method ?? "").toLowerCase();
  const isOnline = paymentMethod !== "cod" && paymentMethod !== "cash_on_delivery";
  const needsPayment =
    isOnline && order.payment_status === "pending" && !isCancelled;

  const handleRetryPayment = async () => {
    if (!order) return;

    if (paymentMethod === "wallet") {
      if (walletPaymentInFlight.current) return;
      walletPaymentInFlight.current = true;
      setWalletPaying(true);
      try {
        await payOrderWithWallet(order.id);
        setOrder((prev) => (prev ? { ...prev, payment_status: "paid" } : prev));
        Alert.alert("Payment successful", "Your order has been paid from your wallet.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Please try again.";
        Alert.alert("Payment failed", message);
      } finally {
        walletPaymentInFlight.current = false;
        setWalletPaying(false);
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
      setOrder((prev) => (prev ? { ...prev, payment_status: "paid" } : prev));
      Alert.alert("Payment successful", "Your order has been paid.");
      return;
    }
    if (result.status === "error") {
      Alert.alert("Payment unavailable", result.message);
      return;
    }
    if (result.reason === "cancelled") return;
    Alert.alert("Payment not completed", result.message ?? "Please try again.");
    loadOrder(true);
  };

  const payDisabled = paymentPhase !== "idle" || walletPaying;

  return (
    <Screen>
      <ScreenHeader
        title={isDelivered ? 'Invoice' : 'Order Details'}
        onBack={() => router.back()}
        right={
          <View style={styles.headerSlot}>
            {autoRefreshing && !isDelivered ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : null}
          </View>
        }
      />

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
        {needsPayment && (
          <Card size="lg" bg={C.warningLight} borderColor="#fcd34d" style={styles.payBanner}>
            <IconWrap size={38} bg={C.card} icon="alert-circle" iconSize={22} iconColor={C.warning} />
            <View style={styles.flex1}>
              <Text style={styles.payBannerTitle}>Payment pending</Text>
              <Text style={styles.payBannerSub}>
                Complete payment of ₹{order.order_total.toFixed(2)} to confirm your order.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.payBannerBtn, payDisabled && styles.payBannerBtnDisabled]}
              activeOpacity={0.8}
              onPress={handleRetryPayment}
              disabled={paymentPhase !== "idle" || walletPaying}
              accessibilityRole="button"
              accessibilityState={{ disabled: payDisabled, busy: walletPaying }}
            >
              {walletPaying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons name="credit-card-fast-outline" size={16} color="#fff" />
              )}
              <Text style={styles.payBannerBtnText}>{walletPaying ? "Paying…" : "Pay now"}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Order meta */}
        <Card size="lg" style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.flex1}>
              <Text style={styles.orderNum}>
                #{order.order_number || order.id.slice(0, 8).toUpperCase()}
              </Text>
              <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
            </View>
            <Badge
              label={statusMeta.label}
              bg={statusMeta.bg}
              color={statusMeta.color}
              icon={statusMeta.icon}
              iconSize={14}
              style={styles.statusBadge}
              textStyle={styles.statusText}
            />
          </View>

          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={16} color={C.textSub} style={styles.infoIcon} />
            <Text style={styles.infoText} numberOfLines={2}>
              {order.delivery_address || "—"}
            </Text>
          </View>

          {order.receiver_name && (
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="account-outline" size={16} color={C.textSub} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                Ordered for {order.receiver_name}
                {order.receiver_phone ? ` · ${order.receiver_phone}` : ""}
              </Text>
            </View>
          )}

          {order.gstin && (
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="file-document-outline" size={16} color={C.textSub} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                GSTIN {order.gstin}
                {order.gstin_business_name ? ` · ${order.gstin_business_name}` : ""}
              </Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="credit-card-outline" size={16} color={C.textSub} style={styles.infoIcon} />
            <Text style={styles.infoText}>
              {isOnline ? "Online" : "Cash on Delivery"} ·{" "}
              <Text style={order.payment_status === "paid" ? styles.paidText : styles.pendingText}>
                {order.payment_status === "paid" ? "Paid" : "Pending"}
              </Text>
            </Text>
          </View>

          {isInFlight && (
            <TouchableOpacity
              style={styles.liveTrackBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
              onPress={() => router.push(`/order/track/${order.id}` as any)}
            >
              <View style={styles.liveTrackDotWrap}>
                <Animated.View style={[styles.liveTrackPulse, livePulseStyle]} />
                <View style={styles.liveTrackDot} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.liveTrackTitle}>Live tracking</Text>
                <Text style={styles.liveTrackSub}>See your rider on the map in real time</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </Card>

        {/* Status timeline or Invoice */}
        {isDelivered ? (
          <View style={styles.section}>
            <SectionLabel>Invoice Details</SectionLabel>
            <Card size="lg" borderColor={C.successLight} shadow="cardMd">
              <View style={styles.invoiceHeader}>
                <MaterialCommunityIcons name="file-document-check" size={32} color={C.success} />
                <View style={styles.flex1}>
                  <Text style={styles.invoiceTitle}>Order Delivered Successfully</Text>
                  <Text style={styles.invoiceDate}>{formatDate(order.created_at)}</Text>
                </View>
              </View>
              <Divider spacing={0} style={styles.invoiceDivider} />
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
                <Text style={[styles.invoiceValue, order.payment_status === "paid" ? styles.paidText : styles.pendingText]}>
                  {order.payment_status === "paid" ? "Paid" : "Pending"}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.viewInvoiceBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                onPress={() => router.push(`/order/invoice/${order.id}` as any)}
              >
                <MaterialCommunityIcons name="file-document-outline" size={18} color="#fff" />
                <Text style={styles.viewInvoiceBtnText}>View Tax Invoice</Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color="#fff" />
              </TouchableOpacity>
            </Card>
          </View>
        ) : !isCancelled ? (
          <View style={styles.section}>
            <SectionLabel>Order Status</SectionLabel>
            <View style={styles.timeline}>
              {ORDER_TIMELINE.map((step, index) => {
                const isDone = currentStatusIndex >= index;
                const isActive = currentStatusIndex === index;
                const isLast = index === ORDER_TIMELINE.length - 1;

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
                          name={step.icon}
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
                          isDone && styles.timelineLabelDone,
                          isActive && styles.timelineLabelActive,
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
          <Card size="lg" bg={C.dangerLight} borderColor="#fca5a5" style={styles.cancelledBanner}>
            <MaterialCommunityIcons name="close-circle-outline" size={24} color={C.danger} />
            <View style={styles.flex1}>
              <Text style={styles.cancelledTitle}>Order Cancelled</Text>
              <Text style={styles.cancelledSub}>This order was not fulfilled.</Text>
            </View>
          </Card>
        )}

        {/* Items */}
        <View style={styles.section}>
          <SectionLabel>Items Ordered</SectionLabel>
          <Card size="lg" padded={false}>
            {!order.items?.length ? (
              <View style={styles.itemsEmpty}>
                <MaterialCommunityIcons name="package-variant" size={20} color={C.textLight} />
                <Text style={styles.itemsEmptyText}>No items to show</Text>
              </View>
            ) : null}
            {order.items?.map((item, i) => (
              <View
                key={i}
                style={[styles.itemRow, i < order.items!.length - 1 && styles.itemRowBorder]}
              >
                <View style={styles.flex1}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.itemUnit}>₹{item.price} / {item.unit}</Text>
                </View>
                <View style={styles.itemRight}>
                  <Text style={styles.itemQty}>×{formatQuantityDisplay(item.quantity)}</Text>
                  <Text style={styles.itemTotal}>
                    ₹{(item.price * item.quantity).toFixed(2)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* Bill — reconstructs the fee breakdown from the fixed
            PLATFORM_FEE/HANDLING_FEE constants (not persisted per-order,
            since they haven't varied since this order model), matching the
            live checkout screen's own display convention. Coupon Discount
            and Tip come straight from the order record when present. */}
        <View style={styles.section}>
          <SectionLabel>Bill Summary</SectionLabel>
          <Card size="lg" style={styles.billCard}>
            <BillLine label="Subtotal" value={`₹${(order.subtotal ?? 0).toFixed(2)}`} />
            <BillLine label="Platform Fee" value={`₹${PLATFORM_FEE.toFixed(2)}`} />
            <BillLine label="Handling Charges" value={`₹${HANDLING_FEE.toFixed(2)}`} />
            <BillLine label="Delivery fee" value={`₹${(order.delivery_fee ?? 0).toFixed(2)}`} />
            {!!order.discount_amount && (
              <BillLine label="Coupon Discount" value={`-₹${order.discount_amount.toFixed(2)}`} />
            )}
            {!!order.tip_amount && (
              <BillLine label="Delivery Partner Tip" value={`₹${order.tip_amount.toFixed(2)}`} />
            )}
            <Divider spacing={4} />
            <BillLine
              label={order.payment_status === "paid" ? "Total Paid" : "Total Payable"}
              value={`₹${order.order_total.toFixed(2)}`}
              bold
            />
          </Card>
        </View>
      </ScrollView>

      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} />
    </Screen>
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

/** Loading placeholder mirroring the meta card + two sections below it. */
function OrderDetailSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading order details">
      <Card size="lg" style={styles.metaCard}>
        <View style={styles.metaRow}>
          <View style={styles.flex1}>
            <Skeleton width={120} height={18} />
            <Skeleton width={90} height={12} style={styles.skeletonGap} />
          </View>
          <Skeleton width={84} height={28} radius={12} />
        </View>
        <Skeleton height={12} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="60%" height={12} />
        <Skeleton height={48} radius={12} />
      </Card>
      <View style={styles.section}>
        <Skeleton width={90} height={11} style={styles.skeletonLabel} />
        <Card size="lg" style={styles.skeletonCard} />
      </View>
      <View style={styles.section}>
        <Skeleton width={90} height={11} style={styles.skeletonLabel} />
        <Card size="lg" style={styles.skeletonCard} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  headerSlot: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollContent: { paddingBottom: layout.scrollBottom },

  // Skeleton
  skeletonGap: { marginTop: 6 },
  skeletonLabel: { marginBottom: 8, marginLeft: 2 },
  skeletonCard: { height: 120 },

  backLinkBtn: { minHeight: 44, marginTop: 4, backgroundColor: C.card },
  backLinkText: { color: C.primary },

  payBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginBottom: 0,
    padding: 14,
  },
  payBannerTitle: {
    color: "#92400e",
    fontSize: 14,
    fontFamily: "PlusJakartaSans_800ExtraBold",
  },
  payBannerSub: { fontFamily: "PlusJakartaSans_400Regular",
    color: "#92400e",
    fontSize: 12,
    marginTop: 2,
    opacity: 0.85,
  },
  payBannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    backgroundColor: C.warning,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: C.warning,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  payBannerBtnDisabled: { opacity: 0.6 },
  payBannerBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: "#fff",
    fontSize: 13,
  },

  metaCard: {
    margin: 16,
    gap: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  orderNum: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 17, fontVariant: ["tabular-nums"] },
  orderDate: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 12, marginTop: 4 },
  statusBadge: {
    flexShrink: 0,
    gap: 6,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12 },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  infoIcon: { marginTop: 2 },
  infoText: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 13, flex: 1, lineHeight: 19 },
  paidText: { color: C.success },
  pendingText: { color: C.warning },

  liveTrackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: C.primary,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  liveTrackDotWrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  liveTrackPulse: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#fff",
  },
  liveTrackDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveTrackTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: "#fff", fontSize: 14 },
  liveTrackSub: { fontFamily: "PlusJakartaSans_800ExtraBold", color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },

  section: { paddingHorizontal: 16, marginBottom: 20 },

  timeline: { gap: 0 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 32 },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    borderWidth: 1,
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
    minHeight: 24,
  },
  timelineLineDone: { backgroundColor: C.primary },
  timelineContent: {
    flex: 1,
    paddingBottom: 24,
    justifyContent: "center",
  },
  timelineLabel: { fontFamily: "PlusJakartaSans_700Bold", color: C.textLight, fontSize: 14 },
  timelineLabelDone: { color: C.text },
  timelineLabelActive: { color: C.primary },
  timelineActiveHint: { fontFamily: "PlusJakartaSans_700Bold",
    color: C.primary,
    fontSize: 11,
    marginTop: 4,
  },

  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  cancelledTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.danger, fontSize: 15 },
  cancelledSub: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.danger, fontSize: 13, marginTop: 2, opacity: 0.8 },

  invoiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  invoiceTitle: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.success,
    fontSize: 16,
  },
  invoiceDate: { fontFamily: "PlusJakartaSans_400Regular",
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
  },
  invoiceDivider: { marginBottom: 16 },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  invoiceLabel: { fontFamily: "PlusJakartaSans_600SemiBold",
    color: C.textSub,
    fontSize: 14,
  },
  invoiceValue: { fontFamily: "PlusJakartaSans_700Bold",
    color: C.text,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  viewInvoiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.success,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 8,
    shadowColor: C.success,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  viewInvoiceBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: "#fff",
    fontSize: 14,
    flex: 1,
    textAlign: "center",
  },

  itemsEmpty: { alignItems: "center", gap: 6, paddingVertical: 20 },
  itemsEmptyText: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 13 },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    gap: 10,
  },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.text, fontSize: 14 },
  itemUnit: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 12, marginTop: 2 },
  itemRight: { alignItems: "flex-end", gap: 2 },
  itemQty: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 12 },
  itemTotal: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 14, fontVariant: ["tabular-nums"] },

  billCard: { gap: 12 },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  billLabel: { fontFamily: "PlusJakartaSans_500Medium", color: C.textSub, fontSize: 14 },
  billLabelBold: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14 },
  billValue: { fontFamily: "PlusJakartaSans_500Medium", color: C.text, fontSize: 14, fontVariant: ["tabular-nums"] },
  billValueBold: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 16 },
});
