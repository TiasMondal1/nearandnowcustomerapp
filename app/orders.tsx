// codename: vega
// "My orders": Active | Past segments, flat pressable rows (components/orders/OrderRow), Reorder / Rate / Track /
// Pay now, focus refresh, a 20 s poll only while an active order exists (focused + foregrounded), reconnect
// refetch, pull-to-refresh and client-side windowing of the cached list (the API is unpaginated — DECISIONS D6).
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager, RefreshControl, StyleSheet, Text, View } from "react-native";

import { PaymentProcessingOverlay } from "../components/PaymentProcessingOverlay";
import { OrderRow, orderDateLabel, reorderOrder, snapshotRatedOrders } from "../components/orders/OrderRow";
import {
  EmptyState,
  notify,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Skeleton,
  SkeletonScreen,
  type Segment,
} from "../components/ui";
import { C } from "../constants/colors";
import { CANCELLED_STATUSES } from "../constants/orderStatus";
import { layout, radius, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { usePaymentFlow } from "../hooks/usePaymentFlow";
import { useRefetchOnReconnect } from "../hooks/useRefetchOnReconnect";
import { useForceSkeleton, useSlowLoad } from "../hooks/useSlowLoad";
import { getDevFlag, useDevFlag } from "../lib/devFlags";
import { feedback } from "../lib/feedback";
import { logError } from "../lib/logError";
import { logSilentFailure } from "../lib/logSilentFailure";
import { markOrderPlaced } from "../lib/orderHistoryFlag";
import {
  getMemoryOrders,
  getUserOrders,
  invalidateOrders,
  isActiveOrder,
  readUserOrdersCache,
  splitActivePast,
  type Order,
} from "../lib/orderService";
import { clearSavedPaymentMethodsCache } from "../lib/razorpayService";
import { payOrderWithWallet } from "../lib/walletService";

type SegmentKey = "active" | "past";

/** Rows rendered per "Show more" step (client-side windowing — no new endpoint). */
const PAGE_SIZE = 20;
/** Mirrors Home's active-orders cadence; runs only while an active order exists, the screen is focused and the app is foregrounded. */
const ACTIVE_POLL_MS = 20_000;
const SKELETON_ROWS = [0, 1, 2, 3] as const;
const CANCELLED = new Set<string>(CANCELLED_STATUSES);
const PAY_TOAST_ID = "pay-now";

const keyExtractor = (item: Order) => item.id;

/** Same ids + statuses in the same order → keep the previous array so memoised rows are not re-rendered by a poll tick. */
function sameOrders(prev: Order[], next: Order[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.order_status !== b.order_status || a.payment_status !== b.payment_status) return false;
  }
  return true;
}

function orderNumber(order: Order): string {
  return order.order_number || order.id.slice(0, 8).toUpperCase();
}

// dismissTo pops to the live tabs route instead of leaving the original (tabs) underneath (W3 R6-04).
function goHome() {
  router.dismissTo("/(tabs)/home");
}

/** Placeholder with the row's geometry (thumbs · badge + date · total / names / two xs buttons). */
function SkeletonOrderRow() {
  return (
    <View style={styles.skelRow}>
      <View style={styles.skelTop}>
        <View style={styles.skelThumbs}>
          <Skeleton width={40} height={40} radius={radius.md} />
          <Skeleton width={40} height={40} radius={radius.md} style={styles.skelThumbOverlap} />
          <Skeleton width={40} height={40} radius={radius.md} style={styles.skelThumbOverlap} />
        </View>
        <View style={styles.skelMeta}>
          <Skeleton width={84} height={18} radius={radius.pill} />
          <Skeleton width={140} height={12} />
        </View>
        <Skeleton width={56} height={16} />
      </View>
      <Skeleton width="85%" height={13} />
      <View style={styles.skelActions}>
        <Skeleton width={96} height={36} radius={radius.xl} />
        <Skeleton width={112} height={36} radius={radius.xl} />
      </View>
    </View>
  );
}

export default function OrdersScreen() {
  const { userId, user, customer } = useAuth();
  const inhibitFeature = useDevFlag("Dev_Vega_inhibit_Feature");
  const inhibitPoll = useDevFlag("Dev_Vega_inhibit_ActivePoll");
  const inhibitReorder = useDevFlag("Dev_Vega_inhibit_Reorder");

  // Seed synchronously from the memory mirror (Home / Order again may have fetched already); the disk cache and
  // the network follow in the mount effect.
  const [orders, setOrders] = useState<Order[]>(() => getMemoryOrders() ?? []);
  const [loading, setLoading] = useState(() => getMemoryOrders() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedSegment, setPickedSegment] = useState<SegmentKey | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  // Snapshot of the rated-this-session set, refreshed on every focus so rows hide "Rate order" after rating.
  const [ratedIds, setRatedIds] = useState<ReadonlySet<string>>(() => snapshotRatedOrders());

  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();
  // Wallet retry bypasses usePaymentFlow entirely (it has no "wallet" phase), so paymentPhase never reflects it
  // and the Pay-now button would never actually disable — mirrors usePaymentFlow's own inFlight ref to guard
  // against a fast double-tap firing two concurrent wallet debits. walletPayingId is the state twin of the same
  // guard, used only to drive the button's loading/disabled UI (the ref remains the synchronous guard).
  const walletPaymentInFlight = useRef(false);
  const [walletPayingId, setWalletPayingId] = useState<string | null>(null);

  // Monotonic sequence so a slow response never overwrites a newer one (MAP §2.8 #30).
  const seqRef = useRef(0);
  const firstFocusRef = useRef(true);

  const fetchOrders = useCallback(
    async (opts?: { force?: boolean; background?: boolean }) => {
      if (!userId) {
        setOrders([]);
        setLoading(false);
        return;
      }
      const seq = ++seqRef.current;
      try {
        const data = await getUserOrders(userId, { force: opts?.force });
        if (seq !== seqRef.current) return;
        setOrders((prev) => (sameOrders(prev, data) ? prev : data));
        setError(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (opts?.background) logSilentFailure("Poll orders", err);
        else logError("Fetch orders", err);
        setError(err instanceof Error ? err.message : "Couldn't load your orders");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [userId],
  );

  // Mount: disk cache (when the memory mirror was empty) → network after interactions.
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (getMemoryOrders() === null) {
      readUserOrdersCache(userId).then((cached) => {
        if (cancelled || !cached || cached.length === 0) return;
        setOrders((prev) => (prev.length === 0 ? cached : prev));
        setLoading(false);
      });
    }
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) fetchOrders();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [fetchOrders, userId]);

  // Focus: track focus for the poll, re-check rated orders, and refresh (statuses change on the tracking screen).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setRatedIds(snapshotRatedOrders());
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
      } else if (!getDevFlag("Dev_Vega_inhibit_Feature")) {
        fetchOrders({ background: true });
      }
      return () => setFocused(false);
    }, [fetchOrders]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  const { active, past } = useMemo(() => splitActivePast(orders), [orders]);
  const hasActive = active.length > 0;

  // Poll: only with an active order, focused, foregrounded, and not inhibited. `force` skips the 20 s memory TTL
  // (otherwise a tick inside the TTL window would just return the cached list).
  useEffect(() => {
    if (!userId || !hasActive || !focused || !appActive || inhibitPoll || inhibitFeature) return;
    const intervalId = setInterval(() => fetchOrders({ force: true, background: true }), ACTIVE_POLL_MS);
    return () => clearInterval(intervalId);
  }, [userId, hasActive, focused, appActive, inhibitPoll, inhibitFeature, fetchOrders]);

  // Vega off = mount-only fetch (CONTRACTS §7): reconnect must not refetch either (W3 R2-16).
  useRefetchOnReconnect(() => fetchOrders({ force: true, background: true }), focused && !inhibitFeature);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    await fetchOrders({ force: true });
    setRefreshing(false);
  }, [fetchOrders]);

  // ─── Pay now (retry) ────────────────────────────────────────────────────────
  const handleRetryPayment = useCallback(
    async (order: Order) => {
      const number = orderNumber(order);
      const method = (order.payment_method ?? "").toLowerCase();

      if (method === "wallet") {
        if (walletPaymentInFlight.current) return;
        walletPaymentInFlight.current = true;
        setWalletPayingId(order.id);
        try {
          await payOrderWithWallet(order.id);
          feedback.success(); // payment completed for a placed order — the same money moment as placement (lead: W3 F7 carve-out)
          notify({
            id: PAY_TOAST_ID,
            tone: "success",
            title: "Payment successful",
            message: `Order ${number} was paid from your wallet`,
          });
        } catch (err: unknown) {
          feedback.error();
          notify({
            id: PAY_TOAST_ID,
            tone: "error",
            title: "Payment failed",
            message: err instanceof Error ? err.message : "Please try again",
          });
        } finally {
          walletPaymentInFlight.current = false;
          setWalletPayingId(null);
          invalidateOrders(userId);
          fetchOrders({ force: true, background: true });
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
        // Same post-payment housekeeping as checkout (W3 R2-14).
        clearSavedPaymentMethodsCache();
        markOrderPlaced().catch((err) => logSilentFailure("Mark order-placed flag", err));
        feedback.success(); // payment completed for a placed order — the same money moment as placement (lead: W3 F7 carve-out)
        notify({ id: PAY_TOAST_ID, tone: "success", title: "Payment successful", message: `Order ${number} is confirmed` });
        invalidateOrders(userId);
        fetchOrders({ force: true, background: true });
        return;
      }
      if (result.status === "error") {
        feedback.error();
        notify({ id: PAY_TOAST_ID, tone: "error", title: "Payment unavailable", message: result.message });
        return;
      }
      invalidateOrders(userId);
      fetchOrders({ force: true, background: true });
      // A user-dismissed gateway sheet is not an error.
      if (result.reason === "cancelled") return;
      feedback.error();
      notify({
        id: PAY_TOAST_ID,
        tone: "error",
        title: "Payment not completed",
        message: result.message ?? "Please try again",
        // "Money may have been debited" deserves a longer read.
        duration: result.reason === "unverified" ? 6000 : undefined,
      });
    },
    [payForOrder, user, customer, fetchOrders, userId],
  );

  const handleReorder = useCallback((order: Order) => {
    reorderOrder(order);
  }, []);

  // ─── Segments / windowing ──────────────────────────────────────────────────
  // Default to Past when nothing is active (an empty Active tab on open is a dead end).
  const segment: SegmentKey = pickedSegment ?? (hasActive ? "active" : "past");
  const list = inhibitFeature ? orders : segment === "active" ? active : past;
  const visible = useMemo(() => (list.length > limit ? list.slice(0, limit) : list), [list, limit]);
  const remaining = list.length - visible.length;

  const segments = useMemo<Segment<SegmentKey>[]>(
    () => [
      { key: "active", label: "Active", count: active.length },
      { key: "past", label: "Past", count: past.length },
    ],
    [active.length, past.length],
  );

  const onSegmentChange = useCallback((key: SegmentKey) => {
    setPickedSegment(key);
    setLimit(PAGE_SIZE);
  }, []);

  const payDisabled = paymentPhase !== "idle" || walletPayingId !== null;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Order>) => {
      const status = item.order_status ?? "";
      const activeOrder = isActiveOrder(item);
      const method = (item.payment_method ?? "").toLowerCase();
      // An empty / null method (legacy rows) is NOT an online order to retry (W3 R2-21).
      const isOnline = !!method && method !== "cod" && method !== "cash_on_delivery";
      const needsPayment = isOnline && item.payment_status === "pending" && !CANCELLED.has(status);
      return (
        <OrderRow
          order={item}
          dateLabel={orderDateLabel(item)}
          isActive={activeOrder}
          showReorder={!activeOrder && !inhibitReorder && !inhibitFeature}
          showRate={status === "order_delivered" && !ratedIds.has(item.id)}
          needsPayment={needsPayment}
          isPaying={walletPayingId === item.id}
          payDisabled={payDisabled}
          onReorder={handleReorder}
          onPayNow={handleRetryPayment}
        />
      );
    },
    [inhibitReorder, inhibitFeature, walletPayingId, payDisabled, handleReorder, handleRetryPayment, ratedIds],
  );

  // ─── States ────────────────────────────────────────────────────────────────
  const showSkeleton = useForceSkeleton(loading && orders.length === 0);
  const slow = useSlowLoad(showSkeleton);
  const count = orders.length;
  const subtitle = count > 0 ? `${count} order${count === 1 ? "" : "s"}` : undefined;

  const header = <ScreenHeader size="lg" title="My orders" subtitle={subtitle} backFallbackHref="/(tabs)/home" />;

  if (showSkeleton) {
    return (
      <Screen bg={C.card}>
        {header}
        {!inhibitFeature ? (
          <View style={styles.segmentWrap}>
            <Skeleton height={36} radius={radius.lg} />
          </View>
        ) : null}
        <SkeletonScreen label="Loading your orders">
          {SKELETON_ROWS.map((i) => (
            <SkeletonOrderRow key={i} />
          ))}
        </SkeletonScreen>
        {slow ? (
          <View style={styles.slowWrap}>
            <Text style={styles.slowText}>Still loading… check your connection</Text>
            <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={() => fetchOrders({ force: true })} />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (error && orders.length === 0) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load your orders"
          text={error}
          action={{ label: "Retry", icon: "refresh", onPress: () => fetchOrders({ force: true }) }}
        />
      </Screen>
    );
  }

  const listEmpty =
    !inhibitFeature && segment === "active" ? (
      <EmptyState
        iconWrap
        icon="bike-fast"
        title="No active orders"
        text="Hungry? Fresh groceries in minutes"
        action={{ label: "Start shopping", onPress: goHome }}
      />
    ) : (
      <EmptyState
        iconWrap
        icon="package-variant-closed"
        title="No orders yet"
        text="Your order history will appear here"
        action={{ label: "Start shopping", onPress: goHome }}
      />
    );

  return (
    <Screen bg={C.card}>
      {header}
      {!inhibitFeature ? (
        <View style={styles.segmentWrap}>
          <SegmentedControl segments={segments} value={segment} onChange={onSegmentChange} />
        </View>
      ) : null}

      <FlashList
        data={visible}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
        ListEmptyComponent={listEmpty}
        ListFooterComponent={
          remaining > 0 ? (
            <View style={styles.footer}>
              <PrimaryButton
                size="sm"
                variant="ghost"
                label={`Show ${Math.min(PAGE_SIZE, remaining)} more`}
                onPress={() => setLimit((l) => l + PAGE_SIZE)}
                accessibilityLabel={`Show ${Math.min(PAGE_SIZE, remaining)} more orders, ${remaining} remaining`}
              />
            </View>
          ) : null
        }
      />

      {RazorpayUI}
      <PaymentProcessingOverlay phase={paymentPhase} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  segmentWrap: {
    paddingHorizontal: layout.gutter,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  list: { paddingBottom: layout.scrollBottom },
  footer: { alignItems: "center", paddingVertical: 12 },

  slowWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  slowText: { ...text.caption, textAlign: "center" },

  // Skeleton twins of OrderRow
  skelRow: { paddingHorizontal: layout.gutter, paddingVertical: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  skelTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  skelThumbs: { flexDirection: "row", alignItems: "center" },
  skelThumbOverlap: { marginLeft: -8 },
  skelMeta: { flex: 1, gap: 6 },
  skelActions: { flexDirection: "row", gap: 8 },
});
