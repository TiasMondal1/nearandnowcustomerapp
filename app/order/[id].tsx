// Order details: paints from `peekOrder(id)` on the first frame, then `getOrderById(id)` (10 s cache — never the
// whole history, MAP P8). Live updates come from the 8 s status poll only (realtime is never trusted here —
// MAP §7.17; the dead `customer_orders` channel is gone). Timeline timestamps are best-effort from
// `fetchOrderTrackingFull().statusHistory`. Reorder / Rate entries are vega's; the rest carries no codename.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { PaymentProcessingOverlay } from "../../components/PaymentProcessingOverlay";
import { formatClockTime, isOrderRated, orderDateLabel, reorderOrder } from "../../components/orders/OrderRow";
import {
  Badge,
  EmptyState,
  ListRow,
  notify,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonScreen,
  type IconName,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { DELIVERY_FEE_WAS, HANDLING_FEE, PLATFORM_FEE } from "../../constants/fees";
import {
  CANCELLED_STATUSES,
  ORDER_TIMELINE,
  TERMINAL_STATUSES,
  getStatusMeta,
  getTimelineIndex,
  paymentMethodLabel,
} from "../../constants/orderStatus";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { usePaymentFlow } from "../../hooks/usePaymentFlow";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { isInvoiceAvailable } from "../../lib/invoiceEligibility";
import { logError } from "../../lib/logError";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { markOrderPlaced } from "../../lib/orderHistoryFlag";
import { getOrderById, getOrderPaymentStatus, invalidateOrders, peekOrder, type Order } from "../../lib/orderService";
import { formatQuantityDisplay } from "../../lib/quantityFormat";
import { clearSavedPaymentMethodsCache } from "../../lib/razorpayService";
import { fetchOrderTrackingFull } from "../../lib/trackingService";
import { payOrderWithWallet } from "../../lib/walletService";

// The poll is the ONLY source of live updates on this screen: `customer_orders`' RLS policy gates on
// `auth.uid()`, which is always NULL under the app's phone-OTP JWT, so a Realtime channel can never fire
// (documented dead-policy finding — MAP §7.17). It stops on TERMINAL_STATUSES and pauses in the background.
const STATUS_POLL_MS = 8_000;
const TERMINAL = new Set<string>(TERMINAL_STATUSES);
const CANCELLED = new Set<string>(CANCELLED_STATUSES);
const PAY_TOAST_ID = "pay-now";
const SKELETON_ROWS = [0, 1, 2] as const;

type TimelineStep = {
  key: string;
  label: string;
  icon: IconName;
  done: boolean;
  active: boolean;
  /** "7:12 pm" from statusHistory, when known. */
  stamp?: string;
};

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

function orderNumber(order: Order): string {
  return order.order_number || order.id.slice(0, 8).toUpperCase();
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";
  const { userId, user, customer } = useAuth();
  const inhibitVega = useDevFlag("Dev_Vega_inhibit_Feature");
  const inhibitReorder = useDevFlag("Dev_Vega_inhibit_Reorder");

  // Instant paint from the memory mirror (list / cache / placement), network refresh right after.
  const [order, setOrder] = useState<Order | null>(() => peekOrder(orderId) ?? null);
  const [loading, setLoading] = useState(order === null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // status → "7:12 pm", formatted once when the history lands (no `new Date()` in render — C46).
  const [stamps, setStamps] = useState<Record<string, string>>({});
  // Store orders on the tracking payload; `picking_up` is a multi-store-only step.
  const [storeCount, setStoreCount] = useState<number | null>(null);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  // Rated-this-session flag, re-read on every focus so "Rate order" disappears after the rate screen pops.
  const [rated, setRated] = useState(false);

  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();
  // Wallet retry bypasses usePaymentFlow entirely (it has no "wallet" phase), so paymentPhase never reflects it
  // and the Pay-now button would never actually disable — mirrors usePaymentFlow's own inFlight ref to guard
  // against a fast double-tap firing two concurrent wallet debits. walletPaying is the state twin of the same
  // guard, used only to drive the button's loading/disabled UI — the ref is the real synchronous guard.
  const walletPaymentInFlight = useRef(false);
  const [walletPaying, setWalletPaying] = useState(false);

  const seqRef = useRef(0);

  const loadOrder = useCallback(
    async (isRefresh = false) => {
      if (!orderId) return;
      const seq = ++seqRef.current;
      try {
        const next = await getOrderById(orderId);
        if (seq !== seqRef.current) return;
        setOrder(next);
        setNotFound(false);
        setError(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        logError("Load order", err);
        if (isNotFoundError(err)) {
          setNotFound(true);
        } else {
          const message = err instanceof Error ? err.message : "Couldn't load this order";
          setError(message);
          // With a seed the content stays; a manual refresh still deserves a word.
          if (isRefresh) notify({ id: "order-refresh", tone: "error", title: "Couldn't refresh this order", message });
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Focus twin for the poll (the tracking / rate / support screens pushed on top poll for themselves).
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setRated(isOrderRated(orderId));
      return () => setFocused(false);
    }, [orderId]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  const status = order?.order_status ?? "";

  // 8 s status poll — stops on terminal statuses, pauses while backgrounded OR unfocused (tracking / rate / support
  // on top run their own polls — W3 R1-06), re-arms on a status change. Each request times out at the cadence.
  useEffect(() => {
    if (!orderId || !order || TERMINAL.has(status) || !appActive || !focused) return;
    let cancelled = false;
    const tick = async () => {
      const result = await getOrderPaymentStatus(orderId, { timeoutMs: STATUS_POLL_MS });
      if (cancelled || !result) return;
      setOrder((prev) => {
        if (!prev) return prev;
        const nextStatus = result.status || prev.order_status;
        const nextPayment = result.payment_status || prev.payment_status;
        if (nextStatus === prev.order_status && nextPayment === prev.payment_status) return prev;
        return { ...prev, order_status: nextStatus, payment_status: nextPayment };
      });
    };
    const intervalId = setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // `order` is only read for its presence; the status key is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, status, appActive, focused, !!order]);

  // Timeline timestamps + store count (best-effort; refreshed when the status advances).
  useEffect(() => {
    if (!orderId || !order) return;
    let cancelled = false;
    fetchOrderTrackingFull(orderId)
      .then((res) => {
        if (cancelled || !res) return;
        const next: Record<string, string> = {};
        for (const ev of res.statusHistory ?? []) {
          const label = formatClockTime(ev.created_at);
          if (ev.status && label) next[ev.status] = label;
        }
        setStamps(next);
        setStoreCount(res.order?.store_orders?.length ?? null);
      })
      .catch((err) => {
        if (!cancelled) logSilentFailure("Order detail status history", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, status, !!order]);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    await loadOrder(true);
    setRefreshing(false);
  }, [loadOrder]);

  // ─── Pay now (retry) ────────────────────────────────────────────────────────
  const handleRetryPayment = useCallback(async () => {
    if (!order) return;
    const number = orderNumber(order);
    const method = (order.payment_method ?? "").toLowerCase();

    if (method === "wallet") {
      if (walletPaymentInFlight.current) return;
      walletPaymentInFlight.current = true;
      setWalletPaying(true);
      try {
        await payOrderWithWallet(order.id);
        setOrder((prev) => (prev ? { ...prev, payment_status: "paid" } : prev));
        invalidateOrders(userId);
        feedback.success(); // payment completed for a placed order — the same money moment as placement (lead: W3 F7 carve-out)
        notify({ id: PAY_TOAST_ID, tone: "success", title: "Payment successful", message: `Order ${number} was paid from your wallet` });
      } catch (err: unknown) {
        feedback.error();
        notify({ id: PAY_TOAST_ID, tone: "error", title: "Payment failed", message: err instanceof Error ? err.message : "Please try again" });
      } finally {
        walletPaymentInFlight.current = false;
        setWalletPaying(false);
      }
      return;
    }

    const result = await payForOrder({
      internalOrderId: order.id,
      userId,
      amount: order.order_total,
      customer: {
        name: user?.name || "Customer",
        email: user?.email || undefined,
        phone: user?.phone || customer?.phone || undefined,
      },
      description: `Payment for order #${number}`,
    });

    if (result.status === "paid") {
      setOrder((prev) => (prev ? { ...prev, payment_status: "paid" } : prev));
      invalidateOrders(userId);
      // Same post-payment housekeeping as checkout (W3 R2-14): the token Razorpay just minted shows up on the next
      // payment-options visit and the first-order flag flips.
      clearSavedPaymentMethodsCache();
      markOrderPlaced().catch((err) => logSilentFailure("Mark order-placed flag", err));
      feedback.success(); // payment completed for a placed order — the same money moment as placement (lead: W3 F7 carve-out)
      notify({ id: PAY_TOAST_ID, tone: "success", title: "Payment successful", message: `Order ${number} is confirmed` });
      return;
    }
    if (result.status === "error") {
      feedback.error();
      notify({ id: PAY_TOAST_ID, tone: "error", title: "Payment unavailable", message: result.message });
      return;
    }
    invalidateOrders(userId);
    loadOrder(true);
    if (result.reason === "cancelled") return;
    feedback.error();
    notify({
      id: PAY_TOAST_ID,
      tone: "error",
      title: "Payment not completed",
      message: result.message ?? "Please try again",
      duration: result.reason === "unverified" ? 6000 : undefined,
    });
  }, [order, payForOrder, user, customer, userId, loadOrder]);

  // ─── States ────────────────────────────────────────────────────────────────
  const showSkeleton = useForceSkeleton(loading && !order);
  const slow = useSlowLoad(showSkeleton);
  const header = (
    <ScreenHeader title="Order details" subtitle={order ? `#${orderNumber(order)}` : undefined} backFallbackHref="/orders" />
  );

  if (showSkeleton) {
    return (
      <Screen bg={C.card}>
        {header}
        <OrderDetailSkeleton />
        {slow ? (
          <View style={styles.slowWrap}>
            <Text style={styles.slowText}>Still loading… check your connection</Text>
            <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={() => loadOrder()} />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (notFound && !order) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          iconWrap
          icon="package-variant-closed-remove"
          title="Order not found"
          text="It may have been removed or the link is out of date"
          action={{ label: "My orders", onPress: () => router.replace("/orders") }}
        />
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load this order"
          text={error ?? undefined}
          action={{ label: "Retry", icon: "refresh", onPress: () => loadOrder() }}
        />
      </Screen>
    );
  }

  // ─── Derived ────────────────────────────────────────────────────────────────
  const isCancelled = CANCELLED.has(status);
  const isDelivered = status === "order_delivered";
  const isInFlight = !TERMINAL.has(status);
  const statusMeta = getStatusMeta(status);
  const method = (order.payment_method ?? "").toLowerCase();
  // An empty / null method (legacy rows) is NOT an online order to retry (W3 R2-21).
  const isOnline = !!method && method !== "cod" && method !== "cash_on_delivery";
  const isPaid = order.payment_status === "paid";
  const needsPayment = isOnline && order.payment_status === "pending" && !isCancelled;
  const payDisabled = paymentPhase !== "idle" || walletPaying;
  const total = formatMoney(order.order_total);
  const dateLabel = orderDateLabel(order);
  // Hidden while in flight, like the list (W3 R2-17); back for delivered / cancelled orders.
  const showReorder = !inhibitReorder && !inhibitVega && !isInFlight && (order.items?.length ?? 0) > 0;
  const showRate = isDelivered && !rated;
  const showInvoice = isDelivered && isInvoiceAvailable(order);

  // `picking_up` only exists for multi-store orders: hide it unless the payload says several stores (or the
  // order itself is / was in that step).
  const multiStore = storeCount !== null ? storeCount > 1 : status === "picking_up" || !!stamps.picking_up;
  const timelineSource = multiStore ? ORDER_TIMELINE : ORDER_TIMELINE.filter((s) => s.key !== "picking_up");
  const currentIndex = getTimelineIndex(status);
  const timeline: TimelineStep[] = timelineSource.map((step) => {
    const stepIndex = getTimelineIndex(step.key);
    return {
      key: step.key,
      label: step.label,
      icon: step.icon,
      done: currentIndex >= stepIndex,
      active: currentIndex === stepIndex,
      stamp: stamps[step.key],
    };
  });

  const deliveryFee = order.delivery_fee ?? 0;

  return (
    <Screen bg={C.card}>
      {header}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        {needsPayment ? (
          <View style={styles.payBanner} accessible accessibilityLabel={`Payment pending. Complete payment of ${total} to confirm your order`}>
            <MaterialCommunityIcons name="alert-circle" size={22} color={C.warning} />
            <View style={styles.flex1}>
              <Text style={styles.payTitle} maxFontSizeMultiplier={1.3}>
                Payment pending
              </Text>
              <Text style={styles.paySub} maxFontSizeMultiplier={1.3}>
                Complete payment of {total} to confirm your order
              </Text>
            </View>
            <PrimaryButton
              size="xs"
              variant="warning"
              label="Pay now"
              icon="credit-card-fast-outline"
              loading={walletPaying}
              disabled={payDisabled}
              onPress={handleRetryPayment}
              accessibilityLabel={`Pay now, ${total}`}
            />
          </View>
        ) : null}

        {/* Status */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            <Badge label={statusMeta.label} bg={statusMeta.bg} color={statusMeta.color} icon={statusMeta.icon} iconSize={14} pill />
            <Text style={styles.statusDate} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {dateLabel}
            </Text>
          </View>
          <Text style={styles.statusDesc}>{statusMeta.description}</Text>

          <InfoRow icon="map-marker-outline" value={order.delivery_address || "—"} lines={2} />
          {order.receiver_name ? (
            <InfoRow
              icon="account-outline"
              value={`Ordered for ${order.receiver_name}${order.receiver_phone ? ` · ${order.receiver_phone}` : ""}`}
            />
          ) : null}
          {order.gstin ? (
            <InfoRow
              icon="file-document-outline"
              value={`GSTIN ${order.gstin}${order.gstin_business_name ? ` · ${order.gstin_business_name}` : ""}`}
            />
          ) : null}
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="credit-card-outline" size={16} color={C.textSub} style={styles.infoIcon} />
            <Text style={styles.infoText}>
              {paymentMethodLabel(order.payment_method)} ·{" "}
              <Text style={isPaid ? styles.paidText : styles.pendingText}>{isPaid ? "Paid" : "Pending"}</Text>
            </Text>
          </View>

          {isInFlight ? (
            <PressableScale
              scale={motion.scale.row}
              style={styles.liveWrap}
              innerStyle={styles.liveRow}
              pressedStyle={styles.liveRowPressed}
              onPress={() => router.push(`/order/track/${order.id}`)}
              accessibilityLabel="Live tracking, see your rider on the map"
            >
              <View style={styles.liveDot} />
              <View style={styles.flex1}>
                <Text style={styles.liveTitle} maxFontSizeMultiplier={1.3}>
                  Live tracking
                </Text>
                <Text style={styles.liveSub} maxFontSizeMultiplier={1.3}>
                  See your rider on the map in real time
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={C.onPrimary} />
            </PressableScale>
          ) : null}
        </View>

        <View style={styles.band} />

        {/* Timeline / cancelled */}
        {isCancelled ? (
          <View style={styles.section}>
            <View style={styles.cancelledBanner} accessible accessibilityLabel="Order cancelled. This order was not fulfilled">
              <MaterialCommunityIcons name="close-circle-outline" size={24} color={C.danger} />
              <View style={styles.flex1}>
                <Text style={styles.cancelledTitle}>Order cancelled</Text>
                <Text style={styles.cancelledSub}>This order was not fulfilled</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <SectionLabel>Order status</SectionLabel>
            <View>
              {timeline.map((step, index) => {
                const isLast = index === timeline.length - 1;
                const state = step.active ? "current" : step.done ? "done" : "upcoming";
                return (
                  <View
                    key={step.key}
                    style={styles.timelineRow}
                    accessible
                    accessibilityLabel={`${step.label}${step.stamp ? `, ${step.stamp}` : ""}, ${state}`}
                  >
                    <View style={styles.timelineLeft}>
                      <View style={[styles.timelineDot, step.done && styles.timelineDotDone]}>
                        <MaterialCommunityIcons name={step.icon} size={13} color={step.done ? C.onPrimary : C.textLight} />
                      </View>
                      {!isLast ? (
                        <View style={[styles.timelineLine, step.done && !step.active && styles.timelineLineDone]} />
                      ) : null}
                    </View>
                    <View style={[styles.timelineContent, isLast && styles.timelineContentLast]}>
                      <Text
                        style={[styles.timelineLabel, step.done && styles.timelineLabelDone, step.active && styles.timelineLabelActive]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {step.label}
                      </Text>
                      {step.stamp ? (
                        <Text style={styles.timelineStamp} maxFontSizeMultiplier={1.3}>
                          {step.stamp}
                        </Text>
                      ) : step.active ? (
                        <Text style={[styles.timelineStamp, styles.timelineStampActive]} maxFontSizeMultiplier={1.3}>
                          Current status
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.band} />

        {/* Items */}
        <View style={styles.section}>
          <SectionLabel>Items</SectionLabel>
          {!order.items?.length ? (
            <View style={styles.itemsEmpty}>
              <MaterialCommunityIcons name="package-variant" size={20} color={C.textLight} />
              <Text style={styles.itemsEmptyText}>No items to show</Text>
            </View>
          ) : null}
          {order.items?.map((item, i) => (
            <View
              key={`${item.master_product_id ?? item.product_id ?? item.name}-${i}`}
              style={[styles.itemRow, i < (order.items?.length ?? 0) - 1 && styles.itemRowBorder]}
            >
              <View style={styles.flex1}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.itemUnit}>
                  {formatMoney(item.price)}
                  {item.unit ? ` / ${item.unit}` : ""}
                </Text>
              </View>
              <View style={styles.itemRight}>
                <Text style={styles.itemQty}>×{formatQuantityDisplay(item.quantity)}</Text>
                <Text style={styles.itemTotal}>{formatMoney(item.price * item.quantity, { decimals: 2 })}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.band} />

        {/* Bill — reconstructs the fee breakdown from the fixed PLATFORM_FEE/HANDLING_FEE constants (not persisted
            per-order, since they haven't varied since this order model), matching the live checkout screen's own
            display convention. Coupon discount and tip come straight from the order record when present. */}
        <View style={styles.section}>
          <SectionLabel>Bill summary</SectionLabel>
          <View style={styles.bill}>
            <BillLine label="Subtotal" value={formatMoney(order.subtotal ?? 0, { decimals: 2 })} />
            <BillLine label="Platform fee" value={formatMoney(PLATFORM_FEE, { decimals: 2 })} />
            <BillLine label="Handling charges" value={formatMoney(HANDLING_FEE, { decimals: 2 })} />
            <BillLine
              label="Delivery fee"
              value={deliveryFee === 0 ? "FREE" : formatMoney(deliveryFee, { decimals: 2 })}
              strikeValue={deliveryFee === 0 ? formatMoney(DELIVERY_FEE_WAS, { decimals: 0 }) : undefined}
              free={deliveryFee === 0}
            />
            {order.discount_amount ? <BillLine label="Coupon discount" value={`-${formatMoney(order.discount_amount, { decimals: 2 })}`} /> : null}
            {order.tip_amount ? <BillLine label="Delivery partner tip" value={formatMoney(order.tip_amount, { decimals: 2 })} /> : null}
            <View style={styles.billRule} />
            <BillLine label={isPaid ? "Total paid" : "Total payable"} value={total} bold />
          </View>
        </View>

        <View style={styles.band} />

        {/* Actions */}
        {showRate || showReorder ? (
          <View style={styles.ctaBlock}>
            {showRate ? (
              <PrimaryButton label="Rate order" icon="star-outline" onPress={() => router.push(`/order/rate/${order.id}`)} />
            ) : null}
            {showReorder ? (
              <PrimaryButton variant="outline" label="Reorder" icon="repeat" onPress={() => reorderOrder(order)} />
            ) : null}
          </View>
        ) : null}
        {showInvoice ? (
          <ListRow
            icon="file-document-outline"
            iconBg="transparent"
            title="View tax invoice"
            subtitle="Itemised GST breakdown as a PDF"
            onPress={() => router.push(`/order/invoice/${order.id}`)}
            divider
          />
        ) : null}
        <ListRow
          icon="headset"
          iconBg="transparent"
          title="Need help with this order?"
          onPress={() => router.push({ pathname: "/settings/support", params: { orderId: order.id } })}
          accessibilityLabel={`Need help with order ${orderNumber(order)}?`}
        />
      </ScrollView>

      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} />
    </Screen>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function InfoRow({ icon, value, lines }: { icon: IconName; value: string; lines?: number }) {
  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons name={icon} size={16} color={C.textSub} style={styles.infoIcon} />
      <Text style={styles.infoText} numberOfLines={lines}>
        {value}
      </Text>
    </View>
  );
}

function BillLine({
  label,
  value,
  bold,
  strikeValue,
  free,
}: {
  label: string;
  value: string;
  bold?: boolean;
  /** Shown struck through before `value` (e.g. a waived delivery fee's original price). */
  strikeValue?: string;
  /** Styles `value` as a "free" highlight (green "FREE" text). */
  free?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billLabelBold]}>{label}</Text>
      <View style={styles.billValueWrap}>
        {strikeValue ? <Text style={styles.billStrike}>{strikeValue}</Text> : null}
        <Text style={[styles.billValue, bold && styles.billValueBold, free && styles.billValueFree]}>{value}</Text>
      </View>
    </View>
  );
}

/** Loading twin: status block + three timeline rows. */
function OrderDetailSkeleton() {
  return (
    <SkeletonScreen label="Loading order details">
      <View style={styles.section}>
        <View style={styles.statusRow}>
          <Skeleton width={110} height={24} radius={radius.pill} />
          <Skeleton width={120} height={12} />
        </View>
        <Skeleton width="90%" height={13} />
        <Skeleton width="70%" height={13} />
        <Skeleton width="55%" height={13} />
        <Skeleton height={56} radius={radius.xl} />
      </View>
      <View style={styles.band} />
      <View style={styles.section}>
        <Skeleton width={90} height={11} />
        {SKELETON_ROWS.map((i) => (
          <View key={i} style={styles.skelTimelineRow}>
            <Skeleton width={24} height={24} radius={12} />
            <View style={styles.skelTimelineText}>
              <Skeleton width={140} height={13} />
              <Skeleton width={60} height={11} />
            </View>
          </View>
        ))}
      </View>
    </SkeletonScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingBottom: layout.scrollBottom },
  section: { paddingHorizontal: layout.gutter, paddingVertical: 16, gap: 12 },
  band: { height: 8, backgroundColor: C.surfaceBand },

  slowWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  slowText: { ...text.caption, textAlign: "center" },
  skelTimelineRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  skelTimelineText: { gap: 6 },

  payBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: layout.gutter,
    marginTop: 16,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: C.warningLight,
    borderWidth: 1,
    borderColor: C.warningBorder,
  },
  payTitle: { fontFamily: fontFamily.bold, fontSize: 14, color: C.warningText },
  paySub: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16, color: C.warningText, marginTop: 2 },

  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  statusDate: { ...text.rowSubtitle, flexShrink: 1 },
  statusDesc: { ...text.bodySm },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoIcon: { marginTop: 2 },
  infoText: { ...text.bodySm, flex: 1 },
  paidText: { color: C.success },
  pendingText: { color: C.warning },

  liveWrap: { marginTop: 4 },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.xl,
  },
  liveRowPressed: { backgroundColor: C.primaryDark },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.onPrimary },
  liveTitle: { fontFamily: fontFamily.extrabold, fontSize: 14, color: C.onPrimary },
  liveSub: { fontFamily: fontFamily.regular, fontSize: 12, color: C.onDarkSub, marginTop: 2 },

  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: C.dangerLight,
    borderWidth: 1,
    borderColor: C.dangerBorder,
  },
  cancelledTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.danger },
  cancelledSub: { ...text.bodySm, color: C.danger, marginTop: 2 },

  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 24 },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineDotDone: { backgroundColor: C.primary, borderColor: C.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.border, marginVertical: 2, minHeight: 20 },
  timelineLineDone: { backgroundColor: C.primary },
  timelineContent: { flex: 1, paddingBottom: 18, paddingTop: 2 },
  timelineContentLast: { paddingBottom: 0 },
  timelineLabel: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  timelineLabelDone: { color: C.text },
  timelineLabelActive: { color: C.primary },
  timelineStamp: { ...text.caption, marginTop: 2 },
  timelineStampActive: { color: C.primary },

  itemsEmpty: { alignItems: "center", gap: 6, paddingVertical: 20 },
  itemsEmptyText: { ...text.bodySm },
  itemRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, gap: 10 },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { ...text.bodyStrong },
  itemUnit: { ...text.rowSubtitle, marginTop: 2 },
  itemRight: { alignItems: "flex-end", gap: 2 },
  itemQty: { fontFamily: fontFamily.bold, fontSize: 12, color: C.textSub },
  itemTotal: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, fontVariant: ["tabular-nums"] },

  bill: { gap: 12 },
  billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  billValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  billRule: { height: 1, backgroundColor: C.border, marginVertical: 2 },
  billLabel: { fontFamily: fontFamily.medium, fontSize: 14, color: C.textSub },
  billLabelBold: { fontFamily: fontFamily.extrabold, color: C.text },
  billValue: { fontFamily: fontFamily.medium, fontSize: 14, color: C.text, fontVariant: ["tabular-nums"] },
  billValueBold: { fontFamily: fontFamily.extrabold, fontSize: 16 },
  billValueFree: { fontFamily: fontFamily.bold, color: C.success },
  billStrike: { ...text.mrp },

  ctaBlock: { paddingHorizontal: layout.gutter, paddingVertical: 16, gap: 10 },
});
