import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { C } from './colors';

/**
 * Single source of truth for `customer_orders.status` values.
 *
 * Mirrors the backend enum at near-and-now/backend/src/types/database.types.ts.
 * Keep this file in sync if the backend changes.
 */
export const ORDER_STATUSES = [
  'pending_at_store',
  'store_accepted',
  'preparing_order',
  'ready_for_pickup',
  'delivery_partner_assigned',
  'picking_up',
  'order_picked_up',
  'in_transit',
  'order_delivered',
  'order_cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: OrderStatus[] = ['order_delivered', 'order_cancelled'];
export const CANCELLED_STATUSES: OrderStatus[] = ['order_cancelled'];

/**
 * Linear timeline displayed in the tracking + order detail screens.
 * `order_cancelled` is intentionally excluded — it's rendered as a separate banner.
 */
export const ORDER_TIMELINE: {
  key: OrderStatus;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { key: 'pending_at_store', label: 'Order placed', icon: 'receipt' },
  { key: 'store_accepted', label: 'Store accepted', icon: 'store-check-outline' },
  { key: 'preparing_order', label: 'Preparing order', icon: 'package-variant' },
  { key: 'ready_for_pickup', label: 'Ready for pickup', icon: 'package-up' },
  { key: 'delivery_partner_assigned', label: 'Rider assigned', icon: 'account-check-outline' },
  { key: 'picking_up', label: 'Collecting items', icon: 'store-marker-outline' },
  { key: 'order_picked_up', label: 'Picked up', icon: 'bike' },
  { key: 'in_transit', label: 'On the way', icon: 'map-marker-path' },
  { key: 'order_delivered', label: 'Delivered', icon: 'check-circle' },
];

export interface StatusMeta {
  label: string;
  color: string;
  bg: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Short customer-facing description ("Your order is being prepared", etc.) */
  description: string;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending_at_store: {
    label: 'Order placed',
    color: C.warning,
    bg: C.warningLight,
    icon: 'receipt',
    description: 'Your order is waiting for the store to accept it.',
  },
  store_accepted: {
    label: 'Store accepted',
    color: C.primary,
    bg: C.primaryXLight,
    icon: 'store-check-outline',
    description: 'The store has accepted your order and will start preparing it shortly.',
  },
  preparing_order: {
    label: 'Preparing',
    color: C.primary,
    bg: C.primaryXLight,
    icon: 'package-variant',
    description: 'The store is preparing your order.',
  },
  ready_for_pickup: {
    label: 'Ready for pickup',
    color: C.warning,
    bg: C.warningLight,
    icon: 'package-up',
    description: 'Your order is ready and waiting for a delivery partner.',
  },
  delivery_partner_assigned: {
    label: 'Rider assigned',
    color: C.info,
    bg: C.infoLight,
    icon: 'account-check-outline',
    description: 'A delivery partner has been assigned and is heading to the store.',
  },
  picking_up: {
    label: 'Collecting items',
    color: C.info,
    bg: C.infoLight,
    icon: 'store-marker-outline',
    description: 'Your rider is collecting items from multiple stores.',
  },
  order_picked_up: {
    label: 'Picked up',
    color: C.info,
    bg: C.infoLight,
    icon: 'bike',
    description: 'Your delivery partner has picked up your order.',
  },
  in_transit: {
    label: 'On the way',
    color: C.info,
    bg: C.infoLight,
    icon: 'map-marker-path',
    description: 'Your order is on its way to you.',
  },
  order_delivered: {
    label: 'Delivered',
    color: C.success,
    bg: C.successLight,
    icon: 'check-circle',
    description: 'Your order has been delivered. Enjoy!',
  },
  order_cancelled: {
    label: 'Cancelled',
    color: C.danger,
    bg: C.dangerLight,
    icon: 'close-circle-outline',
    description: 'This order was cancelled.',
  },
};

/** Fallback meta for unknown / future statuses so the UI never crashes. */
export const UNKNOWN_STATUS_META: StatusMeta = {
  label: 'Processing',
  color: C.textSub,
  bg: C.bgSoft,
  icon: 'progress-clock',
  description: 'Your order is being processed.',
};

export function getStatusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return UNKNOWN_STATUS_META;
  return STATUS_META[status as OrderStatus] ?? UNKNOWN_STATUS_META;
}

export function getTimelineIndex(status: string | null | undefined): number {
  if (!status) return -1;
  return ORDER_TIMELINE.findIndex((s) => s.key === status);
}

// ─── Payment method labels (C22) ─────────────────────────────────────────────
// ADDED 2026-10-03 (W2-orders). Everything above is a byte-compatible mirror of the backend enum
// and stays untouched; these two exports are additive, shared by app/order/[id].tsx and
// app/settings/payments.tsx.
//
// Data domain (W3 R2-02): `customer_orders.payment_method` is the Postgres enum razorpay | cod | wallet
// (supabase/migrations/20260405000000_…, 20260912000000_…). The backend's placeCheckoutOrder folds whatever
// string the client sends into that enum ("upi" / "online" / "split" → razorpay), so the Razorpay sub-method
// (UPI app vs card vs netbanking) is never persisted — no label may claim it. The app posts "upi" for every
// Razorpay rail (lib/paymentSelection PaymentMode) and /api/orders/place echoes that string back, so a freshly
// placed online order reads "upi" until the first refetch returns "razorpay": both must render the same label.

/** Customer-facing label per `customer_orders.payment_method` value (plus the app's own pre-refetch "upi"). */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: 'Cash on delivery',
  razorpay: 'Online',
  upi: 'Online',
  wallet: 'Near & Now wallet',
};

/**
 * `PAYMENT_METHOD_LABEL[method]` (case-insensitive). An unknown non-empty method is shown
 * capitalised with underscores as spaces ("cash_on_delivery" → "Cash on delivery");
 * empty / null → "Online".
 */
export function paymentMethodLabel(method?: string | null): string {
  const key = String(method ?? '').trim().toLowerCase();
  if (!key) return 'Online';
  const known = PAYMENT_METHOD_LABEL[key];
  if (known) return known;
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
