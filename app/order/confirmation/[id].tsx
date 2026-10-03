// codename: nova
// Order confirmation — the ONE success moment (design/blinkit-parity §3.10 / BP-20 · speed #11 · motion M10).
// SuccessHeader plays the single `success` feedback per order id for every payment mode; the add-more window charges
// ONLY through its explicit "Pay ₹X to add N items" button (MAP C14 / §7.16 — the 30 s auto-run effect is gone);
// suggestions come from the warm catalog cache (0 catalog requests); the countdown ticks inside AddMoreWindow alone.
import { useRazorpay, type RazorpayErrorResponse, type RazorpaySuccessResponse } from "@codearcade/expo-razorpay";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, InteractionManager, ScrollView, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ADD_MORE_WINDOW_SECONDS,
  AddMoreWindow,
  remainingAddMoreSeconds,
  UNVERIFIED_COPY,
  type AddItemsPhase,
} from "../../../components/confirmation/AddMoreWindow";
import { SuccessHeader } from "../../../components/confirmation/SuccessHeader";
import {
  BottomDock,
  Divider,
  EmptyState,
  IconButton,
  PrimaryButton,
  ProductCard,
  Screen,
  Skeleton,
  SkeletonCircle,
  SkeletonScreen,
  notify,
  useDockHeight,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import { fontFamily, iconSize, layout, radius, text } from "../../../constants/ui";
import { useAuth } from "../../../context/AuthContext";
import { useCart } from "../../../context/CartContext";
import { useLocation, type ActiveLocation } from "../../../context/LocationContext";
import { useForceSkeleton } from "../../../hooks/useSlowLoad";
import { getDevFlag } from "../../../lib/devFlags";
import { feedback } from "../../../lib/feedback";
import { formatMoney } from "../../../lib/formatMoney";
import { cdnImage } from "../../../lib/imageUrl";
import { isInvoiceAvailable } from "../../../lib/invoiceEligibility";
import { logError } from "../../../lib/logError";
import { logSilentFailure } from "../../../lib/logSilentFailure";
import { createAdditionPayment, verifyAdditionPayment } from "../../../lib/orderAdditionService";
import { getOrderById, peekOrder, type Order, type OrderItem } from "../../../lib/orderService";
import { getMemoryHomeCache, getPopularProducts, type Product } from "../../../lib/productService";
import { formatQuantityDisplay } from "../../../lib/quantityFormat";
import { peekNearbyProductFilter } from "../../../lib/storeService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Quick-add rail length. */
const RAIL_COUNT = 6;
/** Item rows shown before "+N more items" (unchanged from the previous screen). */
const SUMMARY_PREVIEW_ROWS = 5;
/** One retry on a failed order fetch, after this pause (the first failure is usually the post-payment write racing the read). */
const RETRY_DELAY_MS = 700;
/** `apiFetch` maps a 404 to exactly this message (lib/apiClient.ts) — the only not-found signal it exposes. */
const NOT_FOUND_MESSAGE = "Resource not found.";
/** Shorter than apiFetch's 30 s default so a stalled gateway setup / verify fails fast while the window is open. */
const CREATE_PAYMENT_TIMEOUT_MS = 15_000;
const VERIFY_PAYMENT_TIMEOUT_MS = 20_000;
/** After an unverified add-on charge: poll the order 3 × 2 s and promote to done when its items grew (W3 R2-01). */
const UNVERIFIED_POLL_ATTEMPTS = 3;
const UNVERIFIED_POLL_INTERVAL_MS = 2000;
/** Forced-gateway dev seam: a short beat so the processing state is visible (mirrors usePaymentFlow's "preparing"). */
const SIMULATED_GATEWAY_MS = 600;
/** One toast id for the add-items flow so a retry nudges the existing toast instead of stacking. */
const ADD_ITEMS_TOAST_ID = "add-items";
/** Summary thumb: 40 px on screen → 80 px CDN hint. */
const THUMB_SIZE = 40;
const THUMB_CDN_WIDTH = 80;
const SKELETON_ROWS = [0, 1, 2];

type LoadState = "loading" | "ready" | "error" | "notFound" | "signedOut";

type GatewayResult =
  | { kind: "success"; razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
  | { kind: "cancelled" }
  | { kind: "failed"; description?: string };

type SuggestionSet = { key: string; products: Product[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `getOrderById` with one retry; a 404 is final (the retry would only 404 again). */
async function fetchOrderWithRetry(orderId: string): Promise<Order> {
  try {
    return await getOrderById(orderId);
  } catch (err) {
    if (err instanceof Error && err.message === NOT_FOUND_MESSAGE) throw err;
    await sleep(RETRY_DELAY_MS);
    return getOrderById(orderId);
  }
}

/**
 * Quick-add suggestions from memory only (speed #11 / MAP P9 — 0 catalog requests): the warm home catalog filtered
 * by the cached nearby set for the delivery location, minus what is already in the order and anything out of stock;
 * when no nearby set is in memory yet, the precomputed popular list. No location → nothing (MAP §2.11 #39: the
 * platform-wide catalog never leaks past the 4 km radius; these items are addable to the order).
 */
function pickSuggestions(order: Order | null, location: ActiveLocation | null): Product[] {
  if (!location) return [];
  const inOrder = new Set<string>();
  for (const item of order?.items ?? []) {
    if (item.master_product_id) inOrder.add(item.master_product_id);
    if (item.product_id) inOrder.add(item.product_id);
  }
  const eligible = (p: Product) => p.in_stock !== false && !inOrder.has(p.id);

  const nearby = peekNearbyProductFilter(location.latitude, location.longitude);
  if (nearby) {
    const products = getMemoryHomeCache()?.products ?? [];
    const available = products.filter((p) => nearby.productIds.has(p.id) && eligible(p));
    // Fisher-Yates — `sort(() => Math.random() - 0.5)` is a classic
    // biased-shuffle bug (comparator-based sorts don't guarantee a
    // uniform random permutation from an inconsistent comparator).
    const shuffled = [...available];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, RAIL_COUNT);
  }
  return getPopularProducts(RAIL_COUNT + inOrder.size).filter(eligible).slice(0, RAIL_COUNT);
}

// dismissTo pops to the live tabs route (the stack is already [(tabs), confirmation]) instead of mounting a second
// tab navigator (W3 R6-04).
function goHome(): void {
  router.dismissTo("/(tabs)/home");
}

function goToOrders(): void {
  router.replace("/orders");
}

/** "Go to cart" → checkout: checkout IS the cart (DECISIONS D5). */
function goToCart(): void {
  router.push("/support/checkout");
}

const railKeyExtractor = (p: Product) => p.id;
const renderRailItem = ({ item }: ListRenderItemInfo<Product>) => (
  <ProductCard variant="rail" stepperSize="xs" product={item} testID={`confirmation-rail-${item.id}`} />
);
const RailGap = () => <View style={styles.railGap} />;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrderConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId, user, isLoading: authLoading } = useAuth();
  const { items: cartItems, subtotal: cartSubtotal, itemCount, clearCart } = useCart();
  const { location, locationKey } = useLocation();
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();
  const insets = useSafeAreaInsets();
  const dockHeight = useDockHeight();

  // Seed from the memory mirror (filled by createOrder / the orders list) so the celebration paints on frame one.
  const [order, setOrder] = useState<Order | null>(() => (id ? (peekOrder(id) ?? null) : null));
  const [loadState, setLoadState] = useState<LoadState>(() => (id && peekOrder(id) ? "ready" : "loading"));
  const [retryTick, setRetryTick] = useState(0);

  const [addPhase, setAddPhase] = useState<AddItemsPhase>("idle");
  const [addError, setAddError] = useState<string | null>(null);
  // Sync re-entrancy lock (state alone cannot stop a double tap — MAP §7.16).
  const payBusyRef = useRef(false);

  const placedAtMs = order ? Date.parse(order.created_at) : Number.NaN;
  // null = not known yet (no order on screen); seeded for the first frame, settled in the effect below, closed by the
  // window's own tick. Never computed during a re-render (MAP C46: no clock reads in render).
  const [windowOpen, setWindowOpen] = useState<boolean | null>(() =>
    Number.isFinite(placedAtMs) ? remainingAddMoreSeconds(placedAtMs) > 0 : null,
  );

  // ─── Load order (seed → fetch with one retry) ────────────────────────────
  useEffect(() => {
    // While auth is still hydrating, `userId` is transiently null — wait
    // for it rather than treating that the same as "genuinely logged out".
    // Only once auth has settled (authLoading is false) and there's still
    // no userId (e.g. a stale deep link opened while logged out — not
    // reachable via this app's own navigation, but possible via a raw
    // link) do we stop waiting; previously this returned unconditionally
    // with no way to ever clear the initial `loading` state, leaving the
    // screen stuck on the spinner forever in that case.
    if (!id) return;
    if (!userId) {
      if (!authLoading) setLoadState((s) => (s === "ready" ? s : "signedOut"));
      return;
    }
    let cancelled = false;
    // A seeded order stays on screen while the fresh copy loads (SWR); only a cold load shows the skeleton.
    setLoadState((s) => (s === "ready" ? s : "loading"));

    const task = InteractionManager.runAfterInteractions(() => {
      (async () => {
        try {
          const found = await fetchOrderWithRetry(id);
          if (cancelled) return;
          setOrder(found);
          setLoadState("ready");
        } catch (err) {
          if (cancelled) return;
          logError("Load order", err);
          const notFound = err instanceof Error && err.message === NOT_FOUND_MESSAGE;
          setLoadState((s) => (s === "ready" ? s : notFound ? "notFound" : "error"));
        }
      })();
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [id, userId, authLoading, retryTick]);

  // Settle the window state once the order (and so `placed_at`) is known; the seed above covers the warm path.
  useEffect(() => {
    if (!Number.isFinite(placedAtMs)) return;
    setWindowOpen((open) => (open === null ? remainingAddMoreSeconds(placedAtMs) > 0 : open));
  }, [placedAtMs]);

  const handleWindowExpired = useCallback(() => setWindowOpen(false), []);

  // ─── Quick-add suggestions (memory only; keyed on order id + location key, not the order object) ──
  const orderId = order?.id ?? null;
  const suggestionKey = `${orderId ?? ""}|${locationKey ?? ""}`;
  const [suggestions, setSuggestions] = useState<SuggestionSet>(() => ({
    key: suggestionKey,
    products: pickSuggestions(order, location),
  }));
  useEffect(() => {
    setSuggestions((prev) => (prev.key === suggestionKey ? prev : { key: suggestionKey, products: pickSuggestions(order, location) }));
  }, [suggestionKey, order, location]);

  // ─── Add items: EXPLICIT button only (C14) ────────────────────────────────
  const handlePayToAdd = useCallback(async () => {
    if (!id || payBusyRef.current) return;
    const items = cartItems;
    if (items.length === 0) return;
    payBusyRef.current = true;
    setAddPhase("processing");
    setAddError(null);

    const finishSuccess = () => {
      // Silent clear: the verified-payment `success` below is the one feedback for this gesture.
      clearCart({ silent: true });
      setAddPhase("done");
      feedback.success();
      notify({ id: ADD_ITEMS_TOAST_ID, tone: "success", title: "Items added to your order", message: "They'll arrive with this delivery" });
      // Refresh the order so the summary below reflects the newly-added items.
      getOrderById(id)
        .then(setOrder)
        .catch((err) => logSilentFailure("Refresh order after add-items", err));
    };

    // Cancelled or failed at the gateway — items stay in the ordinary cart, exactly
    // as they would have before this feature existed. The order is untouched;
    // the customer just didn't complete the add-on purchase.
    const rejectGateway = (result: Exclude<GatewayResult, { kind: "success" }>) => {
      setAddPhase("idle");
      feedback.error();
      notify({
        id: ADD_ITEMS_TOAST_ID,
        tone: "error",
        title: result.kind === "cancelled" ? "Payment cancelled" : "Payment didn't go through",
        message: result.kind === "failed" && result.description ? result.description : "Your items are still in the cart",
      });
    };

    try {
      // ─── Dev seam: forced gateway result ───────────────────────────────
      // Same enum semantics as usePaymentFlow (hooks/usePaymentFlow.ts): anything but 'off' short-circuits BEFORE
      // /add-items/create-payment, so nothing reaches Razorpay or the backend and the order is untouched.
      // 'paid' exercises the success path locally (the backend never saw the addition, so the refreshed summary will
      // not list the items — expected, as on checkout); 'cancelled' / 'failed' take the real gateway-rejected path;
      // 'unverified' takes the real verify-failed path.
      const forced = getDevFlag("Dev_Payment_inhibit_GatewayResult");
      if (forced !== "off") {
        await sleep(SIMULATED_GATEWAY_MS);
        if (forced === "paid") {
          finishSuccess();
          return;
        }
        if (forced === "unverified") {
          throw new Error("We couldn't confirm the payment (simulated by the dev panel). Your items are still in the cart.");
        }
        rejectGateway(forced === "cancelled" ? { kind: "cancelled" } : { kind: "failed", description: "Simulated by the dev panel" });
        return;
      }

      const paymentOrder = await createAdditionPayment(
        id,
        items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
        { timeoutMs: CREATE_PAYMENT_TIMEOUT_MS },
      );

      const gatewayResult = await new Promise<GatewayResult>((resolve) => {
        openCheckout(
          {
            key: paymentOrder.key_id,
            amount: paymentOrder.amount,
            currency: paymentOrder.currency,
            order_id: paymentOrder.razorpay_order_id,
            name: "Near & Now",
            description:
              paymentOrder.razorpay_mode === "test"
                ? "Test payment (Razorpay sandbox)"
                : "Additional items for your order",
            prefill: {
              name: user?.name || "Customer",
              email: user?.email || "",
              contact: user?.phone || "",
            },
            theme: { color: C.primary },
          },
          {
            onSuccess: (response: RazorpaySuccessResponse) =>
              resolve({
                kind: "success",
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            onFailure: (error: RazorpayErrorResponse["error"]) => resolve({ kind: "failed", description: error?.description }),
            onClose: () => resolve({ kind: "cancelled" }),
          },
        );
      });
      closeCheckout?.();

      if (gatewayResult.kind !== "success") {
        rejectGateway(gatewayResult);
        return;
      }

      // ─── Verify: its own try — the customer has been DEBITED by now ───────
      // A verify failure (timeout, 5xx, network) after a gateway success is money-ambiguous: the webhook may still
      // settle it. Never report it as "items still in your cart" with a live Pay button (W3 R2-01): the window goes
      // to 'unverified' (no Pay button, debit/refund copy) and a short poll promotes it to 'done' if the order grew.
      try {
        await verifyAdditionPayment(
          id,
          {
            request_id: paymentOrder.request_id,
            razorpay_payment_id: gatewayResult.razorpay_payment_id,
            razorpay_order_id: gatewayResult.razorpay_order_id,
            razorpay_signature: gatewayResult.razorpay_signature,
          },
          { timeoutMs: VERIFY_PAYMENT_TIMEOUT_MS, userId },
        );
      } catch (err) {
        logError("Verify add-items payment", err);
        setAddError(UNVERIFIED_COPY);
        setAddPhase("unverified");
        feedback.error();
        notify({ id: ADD_ITEMS_TOAST_ID, tone: "warning", title: "Payment received — confirming", message: "Don't pay again", duration: 6000 });
        const before = order?.items?.length ?? 0;
        for (let attempt = 0; attempt < UNVERIFIED_POLL_ATTEMPTS; attempt += 1) {
          await sleep(UNVERIFIED_POLL_INTERVAL_MS);
          try {
            const fresh = await getOrderById(id);
            if ((fresh.items?.length ?? 0) > before) {
              setOrder(fresh);
              finishSuccess();
              return;
            }
          } catch (pollErr) {
            logSilentFailure("Poll order after unverified add-items", pollErr);
          }
        }
        return;
      }
      finishSuccess();
    } catch (err) {
      logError("Add items to order", err);
      const message = err instanceof Error && err.message ? err.message : "Couldn't add your items to this order. They're still in your cart.";
      setAddError(message);
      setAddPhase("failed");
      feedback.error();
      notify({ id: ADD_ITEMS_TOAST_ID, tone: "error", title: "Couldn't add those items", message });
    } finally {
      payBusyRef.current = false;
    }
  }, [id, cartItems, clearCart, openCheckout, closeCheckout, user, userId, order?.items?.length]);

  const handleRetry = useCallback(() => setRetryTick((n) => n + 1), []);

  // Dev_Onyx_inhibit_SkeletonExit forces the skeleton like every other screen (W3 R3-08).
  const showSkeleton = useForceSkeleton(!order && loadState === "loading");

  const handleTrackOrder = useCallback(() => {
    if (!id) return;
    // replace (not push) so Back from tracking lands on Home, as goToOrderConfirmation() intends.
    router.replace(`/order/track/${id}`);
  }, [id]);

  const handleInvoice = useCallback(() => {
    if (!id) return;
    router.push(`/order/invoice/${id}`);
  }, [id]);

  // ─── Loading / error / not-found (no celebration until an order is on screen) ──
  if (!order || showSkeleton) {
    if (showSkeleton) {
      return (
        <Screen bg={C.card} edges={["left", "right"]} testID="confirmation-loading">
          <SkeletonScreen label="Loading your order…" style={styles.flex1}>
            <View style={[styles.skelBand, { paddingTop: insets.top + 24 }]}>
              <SkeletonCircle size={96} color={C.card} />
              <Skeleton width={200} height={24} radius={radius.md} color={C.card} style={styles.skelGap20} />
              <Skeleton width={120} height={14} color={C.card} style={styles.skelGap8} />
            </View>
            <View style={styles.skelRows}>
              {SKELETON_ROWS.map((i) => (
                <View key={i} style={styles.skelRow}>
                  <Skeleton width={THUMB_SIZE} height={THUMB_SIZE} radius={radius.lg} />
                  <View style={styles.flex1}>
                    <Skeleton width="70%" height={14} />
                    <Skeleton width="40%" height={12} style={styles.skelGap6} />
                  </View>
                  <Skeleton width={48} height={14} />
                </View>
              ))}
            </View>
          </SkeletonScreen>
          <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={goHome} style={[styles.closeFloating, { top: insets.top + 8 }]} />
        </Screen>
      );
    }

    return (
      <Screen bg={C.card} edges={["left", "right"]} testID={`confirmation-${loadState}`}>
        <View style={[styles.stateHeader, { paddingTop: insets.top + 8 }]}>
          <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={goHome} />
        </View>
        {loadState === "notFound" ? (
          <EmptyState
            fill
            icon="package-variant-closed-remove"
            title="Order not found"
            text="This link doesn't match any of your orders"
            action={{ label: "Go to Home", onPress: goHome }}
          />
        ) : loadState === "signedOut" ? (
          <EmptyState
            fill
            iconWrap
            icon="account-lock-outline"
            title="Sign in to see this order"
            text="Your order was placed — log in to view it"
            action={{ label: "Go to Home", onPress: goHome }}
          />
        ) : (
          <EmptyState
            fill
            iconWrap
            icon="alert-circle-outline"
            title="Couldn't load your order"
            text="It was placed — check My orders"
            action={{ label: "Retry", onPress: handleRetry }}
          >
            <PrimaryButton variant="ghost" size="sm" label="Go to orders" onPress={goToOrders} />
          </EmptyState>
        )}
      </Screen>
    );
  }

  // ─── Ready ────────────────────────────────────────────────────────────────
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const isCod = String(order.payment_method || "").toLowerCase() === "cod";
  const orderItems = order.items ?? [];
  const previewItems = orderItems.slice(0, SUMMARY_PREVIEW_ROWS);
  const moreCount = orderItems.length - previewItems.length;
  const showWindow = windowOpen === true || (windowOpen === false && itemCount > 0);
  const showRail = windowOpen === true && suggestions.products.length > 0;
  const invoiceAvailable = isInvoiceAvailable(order);

  return (
    <Screen bg={C.card} edges={["left", "right"]} testID="confirmation">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: dockHeight + layout.gutter }}
        testID="confirmation-scroll"
      >
        <SuccessHeader
          key={order.id}
          orderId={order.id}
          orderNumber={orderNumber}
          placedAtMs={placedAtMs}
          onClose={goHome}
          topInset={insets.top}
          testID="confirmation-header"
        />

        {showWindow ? (
          <AddMoreWindow
            placedAtMs={placedAtMs}
            windowSeconds={ADD_MORE_WINDOW_SECONDS}
            itemCount={itemCount}
            amount={cartSubtotal}
            isCod={isCod}
            phase={addPhase}
            errorMessage={addError}
            onPay={handlePayToAdd}
            onKeepShopping={goHome}
            onGoToCart={goToCart}
            onExpired={handleWindowExpired}
            testID="confirmation-add-more"
          />
        ) : null}

        {showRail ? (
          <View style={styles.railSection} testID="confirmation-rail">
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.3}>
              Quick add
            </Text>
            <Text style={styles.sectionSub} maxFontSizeMultiplier={1.3}>
              Added items arrive with this order
            </Text>
            <FlatList
              horizontal
              data={suggestions.products}
              keyExtractor={railKeyExtractor}
              renderItem={renderRailItem}
              ItemSeparatorComponent={RailGap}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.railContent}
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              windowSize={3}
              removeClippedSubviews
            />
          </View>
        ) : null}

        <View style={styles.summary} testID="confirmation-summary">
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.3}>
            Order summary
          </Text>
          <View style={styles.summaryRows}>
            {previewItems.map((item, idx) => (
              <SummaryRow key={`${item.product_id ?? item.master_product_id ?? item.name}-${idx}`} item={item} last={idx === previewItems.length - 1} />
            ))}
            {moreCount > 0 ? (
              <Text style={styles.moreItems} maxFontSizeMultiplier={1.3}>
                +{moreCount} more {moreCount === 1 ? "item" : "items"}
              </Text>
            ) : null}
          </View>
          <Divider spacing={12} />
          <View style={styles.totalRow} accessible accessibilityLabel={`Total ${formatMoney(order.order_total)}`}>
            <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>
              Total
            </Text>
            <Text style={styles.totalValue} maxFontSizeMultiplier={1.3}>
              {formatMoney(order.order_total)}
            </Text>
          </View>
        </View>
      </ScrollView>

      {RazorpayUI}

      <BottomDock testID="confirmation-dock">
        <PrimaryButton size="lg" label="Track order" onPress={handleTrackOrder} accessibilityLabel="Track order" testID="confirmation-track" />
        <PrimaryButton
          size="md"
          variant="outline"
          label="Continue shopping"
          onPress={goHome}
          accessibilityLabel="Continue shopping"
          style={styles.dockGap}
          testID="confirmation-continue"
        />
        {invoiceAvailable ? (
          <PrimaryButton
            size="sm"
            variant="ghost"
            label="View invoice"
            onPress={handleInvoice}
            accessibilityLabel="View invoice"
            style={styles.dockGhost}
            testID="confirmation-invoice"
          />
        ) : null}
      </BottomDock>
    </Screen>
  );
}

// ─── Summary row ──────────────────────────────────────────────────────────────

function SummaryRow({ item, last }: { item: OrderItem; last: boolean }) {
  const uri = cdnImage(item.image, THUMB_CDN_WIDTH);
  // Two-argument form kept on purpose (C51): order items carry no isLoose flag, so a fractional quantity is the signal.
  const qty = formatQuantityDisplay(item.quantity);
  const lineTotal = item.price * item.quantity;
  return (
    <View>
      <View style={styles.summaryRow} accessible accessibilityLabel={`${item.name}, ${formatMoney(item.price)} times ${qty}, ${formatMoney(lineTotal)}`}>
        <View style={styles.thumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} contentFit="contain" cachePolicy="memory-disk" transition={120} recyclingKey={item.master_product_id ?? item.product_id} accessibilityIgnoresInvertColors />
          ) : (
            <MaterialCommunityIcons name="image-off-outline" size={iconSize.md} color={C.textLight} />
          )}
        </View>
        <View style={styles.summaryText}>
          <Text style={styles.summaryName} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {item.name}
          </Text>
          <Text style={styles.summaryQty} maxFontSizeMultiplier={1.3}>
            {formatMoney(item.price)} × {qty}
          </Text>
        </View>
        <Text style={styles.summaryTotal} maxFontSizeMultiplier={1.3}>
          {formatMoney(lineTotal)}
        </Text>
      </View>
      {last ? null : <Divider spacing={0} color={C.hairline} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  // Skeleton (mirrors the band + 3 summary rows)
  skelBand: {
    alignItems: "center",
    backgroundColor: C.primaryXLight,
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  skelGap6: { marginTop: 6 },
  skelGap8: { marginTop: 8 },
  skelGap20: { marginTop: 20 },
  skelRows: { paddingHorizontal: layout.gutter, paddingTop: 24, gap: 16 },
  skelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  closeFloating: { position: "absolute", right: 8 },

  // Error / not-found header row
  stateHeader: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 8 },

  // Sections
  sectionTitle: { ...text.sectionTitle },
  sectionSub: { ...text.rowSubtitle, marginTop: 2 },

  // Quick-add rail
  railSection: { paddingTop: 20 },
  railContent: { paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 4 },
  railGap: { width: layout.gridGap },

  // Summary
  summary: { paddingHorizontal: layout.gutter, paddingTop: 20 },
  summaryRows: { marginTop: 4 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE },
  summaryText: { flex: 1 },
  summaryName: { ...text.bodyStrong },
  summaryQty: { ...text.rowSubtitle, marginTop: 2 },
  summaryTotal: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, flexShrink: 0 },
  moreItems: { fontFamily: fontFamily.medium, fontSize: 12, color: C.textSub, paddingVertical: 8 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { ...text.h3 },
  totalValue: { ...text.priceLg },

  // Dock
  dockGap: { marginTop: 10 },
  dockGhost: { alignSelf: "center", marginTop: 4 },
});
