// codename: vega
// One order in the "My orders" list (app/orders.tsx): a flat, hairline-separated pressable row that opens
// /order/[id], with the per-state action row (Reorder / Rate order / Track order / Pay now).
//
// This module also holds the list's shared helpers so the detail screen and the payments screen reuse them:
//  - `orderDateLabel(order)` — ONE formatted date per order object (WeakMap-cached), so no Intl formatting or
//    `new Date()` runs per render (MAP P22); the formatter is hand-rolled (no Intl variance across Hermes builds).
//  - `reorderOrder(order)` — the one Reorder flow (one `addMany` commit, one `success`, one toast with "View cart").
//  - `markOrderRated` / `snapshotRatedOrders` — session memory of orders the user finished rating. The Order
//    payload has no "reviewed" field, so without it a delivered order would keep offering "Rate order" after the
//    user rated it. Screens snapshot the set in a focus effect (never read module state during render).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { getStatusMeta } from "../../constants/orderStatus";
import { fontFamily, layout, motion, text } from "../../constants/ui";
import { cartActions } from "../../context/CartContext";
import { getDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { buildReorderItems, type Order } from "../../lib/orderService";
import { getCachedProduct } from "../../lib/productService";
import { Badge, notify, PressableScale, PrimaryButton } from "../ui";
import { OrderThumbs } from "./OrderThumbs";

// ─── Date labels ──────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "7:42 pm" — 12-hour clock, lowercase meridiem. Empty string for an unparseable ISO date. */
export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return clock(d);
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? "0" : ""}${m} ${h < 12 ? "am" : "pm"}`;
}

/** "Tue 1 Oct, 7:42 pm" (the year is appended only when it differs from `now`'s). Empty for an unparseable date. */
export function formatOrderDate(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${clock(d)}`;
}

const dateLabelCache = new WeakMap<Order, string>();

/** `formatOrderDate(order.created_at)` computed once per order OBJECT (WeakMap); pass the result into `OrderRow`. */
export function orderDateLabel(order: Order): string {
  const hit = dateLabelCache.get(order);
  if (hit !== undefined) return hit;
  const label = formatOrderDate(order.created_at);
  dateLabelCache.set(order, label);
  return label;
}

// ─── Rated-this-session memory ────────────────────────────────────────────────

const ratedOrderIds = new Set<string>();

/** The rate screen calls this once every reviewable item of `orderId` has a review. */
export function markOrderRated(orderId: string): void {
  ratedOrderIds.add(orderId);
}

/** True when `markOrderRated(orderId)` ran this session. Call from effects / handlers, never during render. */
export function isOrderRated(orderId: string): boolean {
  return ratedOrderIds.has(orderId);
}

/** A fresh copy of the rated set — take it in a focus effect and keep it in state so render never touches the module Set. */
export function snapshotRatedOrders(): ReadonlySet<string> {
  return new Set(ratedOrderIds);
}

// ─── Reorder ──────────────────────────────────────────────────────────────────

const REORDER_TOAST_ID = "reorder";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Shared Reorder flow (list row, order detail): catalog-priced lines via `buildReorderItems(order, getCachedProduct)`
 * → ONE `cartActions.addMany(items, { silent: true })` commit → ONE `feedback.add()` for the batch (`success` is reserved for order placement — W3 F7 / R2-24) → ONE toast whose single
 * action is "View cart". A toast carries at most one action, so there is no Undo here on purpose — the checkout's
 * "Clear cart" (with its own Undo) is the escape hatch. No-op under `Dev_Vega_inhibit_Reorder` /
 * `Dev_Vega_inhibit_Feature` (the buttons are hidden then anyway). Returns true when something was added.
 */
export function reorderOrder(order: Order): boolean {
  if (getDevFlag("Dev_Vega_inhibit_Reorder") || getDevFlag("Dev_Vega_inhibit_Feature")) return false;

  const { items, unavailable } = buildReorderItems(order, getCachedProduct);
  if (items.length === 0) {
    feedback.error();
    notify({ id: REORDER_TOAST_ID, tone: "warning", title: "None of these items are available right now" });
    return false;
  }

  const { added } = cartActions.addMany(items, { silent: true });
  if (added === 0) {
    feedback.error();
    notify({ id: REORDER_TOAST_ID, tone: "warning", title: "Your cart already has the maximum of these items" });
    return false;
  }

  const priceChanged = items.reduce((n, it) => n + (it.priceChanged ? 1 : 0), 0);
  feedback.add();
  notify({
    id: REORDER_TOAST_ID,
    tone: "success",
    title: `Added ${plural(added, "item")} to cart${unavailable.length > 0 ? ` · ${unavailable.length} unavailable` : ""}`,
    message: priceChanged > 0 ? `Prices updated for ${plural(priceChanged, "item")}` : undefined,
    action: { label: "View cart", onPress: () => router.push("/support/checkout") },
  });
  return true;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

export type OrderRowProps = {
  order: Order;
  /** Precomputed via `orderDateLabel(order)` — never formatted inside the cell. */
  dateLabel: string;
  /** Not delivered / cancelled: shows "Track order ›" instead of Reorder. */
  isActive: boolean;
  /** Past order with Reorder not inhibited. */
  showReorder: boolean;
  /** Delivered and not yet rated this session. */
  showRate: boolean;
  /** Online method, `payment_status` pending, not cancelled → warning badge + "Pay now". */
  needsPayment: boolean;
  /** This row's wallet payment is in flight (Pay now shows its spinner). */
  isPaying: boolean;
  /** Any payment is in flight on the screen (every Pay now is disabled). */
  payDisabled: boolean;
  onReorder: (order: Order) => void;
  onPayNow: (order: Order) => void;
  /** 1 px C.border under the row, drawn OUTSIDE the scaled view. Default true. */
  divider?: boolean;
  testID?: string;
};

/** Lifts the 13 px "Track order" link to a 44 pt target without changing the row's height. */
const TRACK_HIT_SLOP = { top: 10, bottom: 10, left: 8, right: 8 } as const;

function OrderRowBase({
  order,
  dateLabel,
  isActive,
  showReorder,
  showRate,
  needsPayment,
  isPaying,
  payDisabled,
  onReorder,
  onPayNow,
  divider = true,
  testID,
}: OrderRowProps) {
  const meta = getStatusMeta(order.order_status);
  const number = order.order_number || order.id.slice(0, 8).toUpperCase();
  const items = order.items ?? [];
  const count = items.length || order.items_count || 0;
  const names = items
    .map((it) => it.name)
    .filter(Boolean)
    .join(", ");
  const total = formatMoney(order.order_total);
  const a11yLabel = `Order ${number}, ${meta.label.toLowerCase()}, ${dateLabel}, ${total}, ${plural(count, "item")}`;
  const hasActions = showReorder || showRate || isActive || needsPayment;

  return (
    <View style={divider ? styles.divider : undefined}>
      <PressableScale
        scale={motion.scale.row}
        pressedStyle={styles.pressed}
        innerStyle={styles.row}
        onPress={() => router.push(`/order/${order.id}`)}
        accessibilityLabel={a11yLabel}
        accessibilityHint="Opens the order details"
        testID={testID}
      >
        <View style={styles.top}>
          <OrderThumbs items={items} />
          <View style={styles.meta}>
            <View style={styles.badges}>
              <Badge label={meta.label} bg={meta.bg} color={meta.color} pill size="sm" />
              {needsPayment ? <Badge label="Payment pending" tone="warning" pill size="sm" /> : null}
            </View>
            <Text style={styles.date} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {dateLabel}
            </Text>
          </View>
          <Text style={styles.total} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {total}
          </Text>
        </View>

        {names ? (
          <Text style={styles.names} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {names}
          </Text>
        ) : null}

        {hasActions ? (
          <View style={styles.actions}>
            {showReorder ? (
              <PrimaryButton
                size="xs"
                variant="outline"
                label="Reorder"
                icon="repeat"
                onPress={() => onReorder(order)}
                accessibilityLabel={`Reorder order ${number}`}
              />
            ) : null}
            {showRate ? (
              <PrimaryButton
                size="xs"
                variant="outline"
                label="Rate order"
                icon="star-outline"
                onPress={() => router.push(`/order/rate/${order.id}`)}
                accessibilityLabel={`Rate order ${number}`}
              />
            ) : null}
            <View style={styles.spacer} />
            {needsPayment ? (
              <PrimaryButton
                size="xs"
                variant="warning"
                label="Pay now"
                icon="credit-card-fast-outline"
                loading={isPaying}
                disabled={payDisabled}
                onPress={() => onPayNow(order)}
                accessibilityLabel={`Pay now for order ${number}, ${total}`}
              />
            ) : isActive ? (
              <PressableScale
                scale={motion.scale.row}
                hitSlop={TRACK_HIT_SLOP}
                innerStyle={styles.trackBtn}
                onPress={() => router.push(`/order/track/${order.id}`)}
                accessibilityLabel={`Track order ${number}`}
              >
                <Text style={styles.trackText} maxFontSizeMultiplier={1.3}>
                  Track order
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={16} color={C.primary} />
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </PressableScale>
    </View>
  );
}

/** Memoised: the list passes primitives + the order object + stable callbacks (speed-and-ease #13, MAP P22). */
export const OrderRow = React.memo(OrderRowBase);
OrderRow.displayName = "OrderRow";

const styles = StyleSheet.create({
  divider: { borderBottomWidth: 1, borderBottomColor: C.border },
  row: { paddingHorizontal: layout.gutter, paddingVertical: 14, gap: 10, backgroundColor: C.card },
  pressed: { backgroundColor: C.bgSoft },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  meta: { flex: 1, gap: 4 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  date: { ...text.rowSubtitle },
  total: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.text, fontVariant: ["tabular-nums"] },
  names: { ...text.bodySm },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  spacer: { flex: 1 },
  trackBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 8, paddingLeft: 8 },
  trackText: { fontFamily: fontFamily.bold, fontSize: 13, color: C.primary },
});
