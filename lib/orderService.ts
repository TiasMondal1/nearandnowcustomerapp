import AsyncStorage from '@react-native-async-storage/async-storage';

import { ORDER_STATUSES, TERMINAL_STATUSES } from '../constants/orderStatus';
import type { CartItem } from '../context/CartContext';
import { apiFetch } from './apiClient';
import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';
import { getMemoryHomeCache, type Product } from './productService';
import { cached, invalidate, QC_KEYS } from './queryCache';

// ─── User-orders SWR cache ──────────────────────────────────────────────────
// Keyed per user so switching accounts on the same device doesn't cross
// contaminate. Same shape/versioning as the home-catalog and saved-address
// caches for consistency.
const ORDERS_CACHE_VERSION = 1;
const ORDERS_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 1 day
/** Disk rows hold the newest N orders only — an unbounded history hits Android's 2 MB CursorWindow (C38). */
const ORDERS_CACHE_MAX_ROWS = 50;
/** queryCache TTLs: the list dedupes Home / Orders / Order again mounts; a single order is short-lived (polls refresh it). */
const ORDERS_LIST_TTL_MS = 20_000;
const SINGLE_ORDER_TTL_MS = 10_000;

const SYNTHETIC_ORDER_ID = 'dev-synthetic-order';

const ordersCacheKey = (userId: string) =>
  `nn_user_orders_v${ORDERS_CACHE_VERSION}:${userId}`;

interface UserOrdersCache {
  version: number;
  savedAt: number;
  orders: unknown[];
}

// ─── Memory mirror ──────────────────────────────────────────────────────────
// Filled by getUserOrders / readUserOrdersCache / getOrderById / createOrder so
// single-order screens can paint from `peekOrder(id)` on the first frame.
// User-scoped: AuthContext.clearStoredSession() calls clearOrdersMemory().

const ordersById = new Map<string, Order>();
let memoryOrders: Order[] | null = null;
/**
 * Bumped by `clearOrdersMemory()`. Every fetch captures it BEFORE its await and skips `remember*` when it moved,
 * so an in-flight list/order resolve can never repopulate the mirror after logout (W3 R1-01: queryCache refuses
 * to STORE a late resolve but still resolves it to the caller).
 */
let mirrorGen = 0;

function rememberOrders(orders: Order[]): void {
  for (const o of orders) ordersById.set(o.id, o);
  memoryOrders = orders;
}

function rememberOrder(order: Order): void {
  ordersById.set(order.id, order);
  if (memoryOrders) {
    const idx = memoryOrders.findIndex((o) => o.id === order.id);
    if (idx >= 0) {
      const next = memoryOrders.slice();
      next[idx] = order;
      memoryOrders = next;
    }
  }
}

/** Last known copy of an order from any fetch (list, disk cache, single read, placement); `undefined` when never seen. */
export function peekOrder(orderId: string): Order | undefined {
  return ordersById.get(orderId);
}

/** The last order list resolved for the current user (sorted newest first), or `null` before any fetch / after logout. */
export function getMemoryOrders(): Order[] | null {
  return memoryOrders;
}

/** Empties the mirror (Map + list). Called from `AuthContext.clearStoredSession()` — shared-device leak otherwise. */
export function clearOrdersMemory(): void {
  mirrorGen += 1;
  ordersById.clear();
  memoryOrders = null;
}

// ─── Disk cache ─────────────────────────────────────────────────────────────

/**
 * Per-user disk cache of the order list (newest 50). `null` on miss /
 * version mismatch / expiry (24 h) / parse error and under
 * `Dev_Cache_inhibit_Orders`. A hit also fills the memory mirror.
 */
export async function readUserOrdersCache(
  userId: string,
): Promise<Order[] | null> {
  if (!userId) return null;
  if (getDevFlag('Dev_Cache_inhibit_Orders')) return null;
  const gen = mirrorGen;
  try {
    const raw = await AsyncStorage.getItem(ordersCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserOrdersCache;
    if (!parsed || parsed.version !== ORDERS_CACHE_VERSION) return null;
    if (Date.now() - parsed.savedAt > ORDERS_CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.orders)) return null;
    const orders = parsed.orders as Order[];
    if (gen === mirrorGen) rememberOrders(orders);
    return orders;
  } catch {
    return null;
  }
}

function createdAtMs(order: Order): number {
  const t = Date.parse(order.created_at);
  return Number.isFinite(t) ? t : 0;
}

async function writeUserOrdersCache(
  userId: string,
  orders: Order[],
): Promise<void> {
  if (!userId) return;
  const newestFirst = orders
    .filter((o) => o.id !== SYNTHETIC_ORDER_ID)
    .slice()
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
    .slice(0, ORDERS_CACHE_MAX_ROWS);
  const payload: UserOrdersCache = {
    version: ORDERS_CACHE_VERSION,
    savedAt: Date.now(),
    orders: newestFirst,
  };
  try {
    await AsyncStorage.setItem(ordersCacheKey(userId), JSON.stringify(payload));
  } catch {
    // Cache writes are best-effort.
  }
}

/**
 * Synchronous, memory-only invalidation: every `order:<id>` entry plus the
 * user's list entry when `userId` is given. Call after createOrder / cancel /
 * payment so the next read goes to the network.
 */
export function invalidateOrders(userId: string | null): void {
  invalidate('order:');
  if (userId) invalidate(QC_KEYS.orders(userId));
}

/** Removes the per-user disk row AND invalidates the memory entries (`invalidateOrders`). */
export async function invalidateUserOrdersCache(userId: string): Promise<void> {
  if (!userId) return;
  invalidateOrders(userId);
  try {
    await AsyncStorage.removeItem(ordersCacheKey(userId));
  } catch {
    // Ignore.
  }
}

export interface OrderItem {
  /**
   * Store-specific `products.id` — the FK stored on `order_items`. This is
   * NOT the id the mobile catalog keys off of (that's `master_product_id`
   * below). Kept here for backwards compat with screens that already use it.
   */
  product_id?: string;
  /**
   * Resolved `master_products.id` — populated by joining `products` during
   * the order fetch. This is the id that lines up with the home catalog, so
   * the Order Again tab uses it to re-add items to the cart and look up
   * enriched product info (images, discounts, stock).
   */
  master_product_id?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  unit?: string;
}

export interface Order {
  id: string;
  order_number?: string;
  order_status: string;
  payment_status: string;
  payment_method: string;
  order_total: number;
  subtotal?: number;
  delivery_fee?: number;
  /** Coupon discount actually applied server-side at checkout, if any. */
  discount_amount?: number;
  /** Delivery partner tip actually applied server-side at checkout, if any. */
  tip_amount?: number;
  gstin?: string;
  gstin_business_name?: string;
  /** "Order for someone else" — who actually received the order, if not the customer themself. */
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  items?: OrderItem[];
  items_count?: number;
  delivery_address?: string;
  created_at: string;
  /** 4-digit delivery verification PIN, generated after order is dispatched */
  delivery_otp?: string;
}

export interface CreateOrderInput {
  user_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  /**
   * The rail, never the Razorpay sub-method: the backend folds this string into the enum
   * razorpay | cod | wallet by substring ("upi" → razorpay; anything unrecognised → cod), so
   * "card" / "netbanking" would be stored as cash on delivery (W3 R2-02).
   */
  payment_method: "upi" | "cod" | "wallet";
  payment_status: "pending" | "paid";
  subtotal: number;
  delivery_fee: number;
  order_total: number;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  items: OrderItem[];
  notes?: string;
  gstin?: string;
  gstin_business_name?: string;
  /** "Order for someone else" — who actually receives the order, if not the customer themself. */
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  tip_amount?: number;
  coupon_id?: string;
}

type BackendOrderItem = {
  product_id?: string | null;
  product_name?: string | null;
  unit_price?: number | string | null;
  quantity?: number | string | null;
  unit?: string | null;
  image_url?: string | null;
  /**
   * Populated when the Supabase select joins `products(master_product_id)`.
   * Supabase returns the related row as either an object (to-one FK) or an
   * array depending on how the FK is defined — handle both.
   */
  products?:
    | { master_product_id?: string | null }
    | { master_product_id?: string | null }[]
    | null;
};

type BackendStoreOrder = {
  order_items?: BackendOrderItem[] | null;
};

type BackendCustomerOrder = {
  id: string;
  order_code?: string | null;
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  total_amount?: number | string | null;
  subtotal_amount?: number | string | null;
  delivery_fee?: number | string | null;
  discount_amount?: number | string | null;
  tip_amount?: number | string | null;
  gstin?: string | null;
  gstin_business_name?: string | null;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  receiver_address?: string | null;
  delivery_address?: string | null;
  placed_at?: string | null;
  created_at?: string | null;
  store_orders?: BackendStoreOrder[] | null;
};

function toNumber(val: unknown, fallback = 0) {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return Number(val);
  return fallback;
}

function extractMasterProductId(
  products: BackendOrderItem['products'],
): string | undefined {
  if (!products) return undefined;
  if (Array.isArray(products)) {
    for (const p of products) {
      if (p && p.master_product_id) return String(p.master_product_id);
    }
    return undefined;
  }
  return products.master_product_id
    ? String(products.master_product_id)
    : undefined;
}

function mapBackendOrder(order: BackendCustomerOrder): Order {
  const items: OrderItem[] = [];
  for (const so of order.store_orders || []) {
    for (const it of so.order_items || []) {
      items.push({
        product_id: (it.product_id ?? undefined) || undefined,
        master_product_id: extractMasterProductId(it.products),
        name: String(it.product_name ?? ''),
        price: toNumber(it.unit_price, 0),
        quantity: toNumber(it.quantity, 0),
        unit: (it.unit ?? undefined) || undefined,
        image: (it.image_url ?? undefined) || undefined,
      });
    }
  }

  return {
    id: order.id,
    order_number: order.order_code || undefined,
    order_status: order.status || 'pending_at_store',
    payment_status: order.payment_status || 'pending',
    payment_method: order.payment_method || 'upi',
    order_total: toNumber(order.total_amount, 0),
    subtotal: toNumber(order.subtotal_amount, undefined as unknown as number) || undefined,
    delivery_fee: toNumber(order.delivery_fee, undefined as unknown as number) || undefined,
    discount_amount: toNumber(order.discount_amount, undefined as unknown as number) || undefined,
    tip_amount: toNumber(order.tip_amount, undefined as unknown as number) || undefined,
    gstin: order.gstin || undefined,
    gstin_business_name: order.gstin_business_name || undefined,
    receiver_name: order.receiver_name || undefined,
    receiver_phone: order.receiver_phone || undefined,
    receiver_address: order.receiver_address || undefined,
    items,
    items_count: items.length,
    delivery_address: order.delivery_address || undefined,
    created_at: order.placed_at || order.created_at || new Date().toISOString(),
  };
}

type PlaceOrderResponse = {
  id: string;
  order_code?: string;
  status?: string;
  payment_status?: string;
  payment_method?: string;
  total_amount?: number;
  subtotal_amount?: number;
  delivery_fee?: number;
  delivery_address?: string;
  placed_at?: string;
  created_at?: string;
};

// Places an order via the backend's `/api/orders/place` endpoint — the
// authenticated (requireCustomer), server-trusted checkout pipeline shared
// with the website. The backend re-derives item prices from `master_products`,
// recomputes the order total, and only ever assigns `customer_id` from the
// caller's own session token, never from anything in the request body.
//
// (Previously this wrote directly to Supabase using the service-role key,
// with no ownership check tying the order to the authenticated customer, and
// with client-computed prices/totals trusted as-is.)
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  // Delivery instructions still don't have a dedicated column, so they stay
  // folded into the free-text `notes` field. GSTIN, receiver info, and now tip
  // (previously folded in here too) all have real columns on customer_orders
  // — sent as structured fields below instead.
  const noteParts: string[] = [];
  if (input.notes) noteParts.push(input.notes);

  const [addressLine, ...addressRest] = input.delivery_address.split(',');

  const order = await apiFetch<PlaceOrderResponse>('/api/orders/place', {
    method: 'POST',
    body: JSON.stringify({
      user_id: input.user_id,
      customer_name: input.customer_name,
      customer_email: input.customer_email,
      customer_phone: input.customer_phone,
      order_total: input.order_total,
      subtotal: input.subtotal,
      delivery_fee: input.delivery_fee,
      payment_status: input.payment_status,
      payment_method: input.payment_method,
      coupon_id: input.coupon_id,
      notes: noteParts.length ? noteParts.join(' | ') : undefined,
      gstin: input.gstin,
      gstin_business_name: input.gstin_business_name,
      receiver_name: input.receiver_name,
      receiver_phone: input.receiver_phone,
      receiver_address: input.receiver_address,
      tip_amount: input.tip_amount,
      items: input.items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        image: it.image,
        unit: it.unit,
      })),
      shipping_address: {
        address: addressLine?.trim() || input.delivery_address,
        city: addressRest.join(',').trim() || undefined,
        latitude: input.delivery_latitude,
        longitude: input.delivery_longitude,
      },
    }),
  });

  const placedOrder: Order = {
    id: String(order.id),
    order_number: order.order_code || undefined,
    order_status: order.status || 'pending_at_store',
    payment_status: order.payment_status || input.payment_status,
    payment_method: order.payment_method || input.payment_method,
    order_total: order.total_amount ?? input.order_total,
    subtotal: order.subtotal_amount ?? input.subtotal,
    delivery_fee: order.delivery_fee ?? input.delivery_fee,
    items: input.items,
    items_count: input.items.length,
    delivery_address: order.delivery_address || input.delivery_address,
    created_at: order.placed_at || order.created_at || new Date().toISOString(),
  };

  // The memory entries go first (sync) so the next list/order read hits the
  // network, and the confirmation screen can peek the placed order right away.
  invalidateOrders(input.user_id);
  rememberOrder(placedOrder);
  // Fire-and-forget: the next visit to the Orders tab will refresh from the
  // server anyway, but clearing the stale disk cache now means the new order
  // shows up at the top even on a cold start within the TTL window.
  invalidateUserOrdersCache(input.user_id).catch((err) =>
    logSilentFailure('Invalidate user-orders cache after placing order', err),
  );
  return placedOrder;
}

/**
 * Lightweight single-row read used by the post-payment reconcile loop.
 *
 * When `/api/payment/verify` fails (network blip, response timeout, etc.) the
 * Razorpay webhook may *still* settle the order asynchronously. Instead of
 * scaring the user with a refund warning, we poll this for ~10s — if the
 * webhook lands first, we promote the UI to "Paid" silently.
 */
export async function getOrderPaymentStatus(
  orderId: string,
  opts?: { timeoutMs?: number },
): Promise<{ payment_status: string; status: string } | null> {
  if (!orderId) return null;
  try {
    // requireCustomer-gated, and ownership is enforced inside the query
    // itself (customer_id filter in getOrderTracking) — not just an app-level
    // check. Previously this read customer_orders directly with the
    // privileged client and NO ownership check at all: any known/guessed
    // order id's payment status was readable by anyone.
    // Pollers pass a short `timeoutMs` (order detail: 8 s cadence) so requests cannot pile up on a slow link.
    const data = await apiFetch<{ payment_status?: string; status?: string }>(
      `/api/tracking/orders/${encodeURIComponent(orderId)}`,
      { timeoutMs: opts?.timeoutMs },
    );
    if (!data) return null;
    return {
      payment_status: String(data.payment_status || 'pending'),
      status: String(data.status || ''),
    };
  } catch (err) {
    logSilentFailure('[ORDER] getOrderPaymentStatus', err);
    return null;
  }
}

/**
 * Voids an order that was created (needed for Razorpay's order_id linkage —
 * see usePaymentFlow.ts) before payment was actually confirmed, but then had
 * its payment cancelled or fail outright. Same backend endpoint the website
 * uses (`orders.controller.ts`'s cancelOrder / database.service.ts's
 * cancelOrder) — unwinds `order_store_allocations`/`store_orders` and
 * notifies the shopkeeper of the cancellation, so a store doesn't keep
 * prepping/see an order nobody actually paid for.
 */
export async function cancelOrder(orderId: string): Promise<void> {
  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  });
  // Every memory entry — the caller knows the user id; the list is cheap to refetch.
  invalidateOrders(null);
  // Patch the mirror so `peekOrder` never seeds a detail/confirmation screen with the pre-void status (W3 R2-11).
  const prev = ordersById.get(orderId);
  if (prev && prev.order_status !== 'order_cancelled') rememberOrder({ ...prev, order_status: 'order_cancelled' });
}

/**
 * A hydrated line item used by the Order Again tab. It stores everything we
 * need to render a card WITHOUT the home catalog — so even when a product has
 * been removed from the store, the customer still sees their past purchase.
 *
 * `masterProductId` is the preferred join key for the home catalog and cart;
 * it may be missing for legacy orders, in which case we fall back to the
 * deduped `fallbackKey` (product_id OR normalized name+unit).
 */
export interface OrderAgainItem {
  /** Stable key unique per distinct product across the customer's orders. */
  key: string;
  masterProductId?: string;
  productId?: string;
  name: string;
  price: number;
  unit?: string;
  image?: string;
  /** Total quantity ever ordered by this customer — useful for sorting. */
  totalQty: number;
  /** Number of distinct orders this item appeared in. */
  orderCount: number;
  /** ISO date of the most recent purchase. */
  lastOrderedAt: string;
}

function orderAgainKey(it: OrderItem): string {
  if (it.master_product_id) return `m:${it.master_product_id}`;
  if (it.product_id) return `p:${it.product_id}`;
  // Last-resort dedupe key for unresolved items (e.g. legacy orders that never
  // stored a product_id). Lowercased name + unit keeps "Amul Milk 500 ml" from
  // splintering into multiple rows due to casing/whitespace.
  const n = (it.name || '').trim().toLowerCase();
  const u = (it.unit || '').trim().toLowerCase();
  return `n:${n}|${u}`;
}

/**
 * Aggregates a customer's order history into hydrated "Order Again" line
 * items, sorted by recency (most-recent first). Pure in-memory reduction over
 * `Order[]` — no extra network calls.
 *
 * Orders are expected to come sorted placed_at DESC from `getUserOrders`, so
 * the first occurrence of a key is also its most recent purchase.
 */
export function buildOrderAgainItems(orders: Order[]): OrderAgainItem[] {
  const byKey = new Map<string, OrderAgainItem>();
  // Track which orders contributed to which key so we can count distinct
  // orders (not distinct line items).
  const orderKeyAdded = new Map<string, Set<string>>();

  for (const order of orders) {
    const placedAt = order.created_at || new Date().toISOString();
    for (const it of order.items || []) {
      const key = orderAgainKey(it);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          key,
          masterProductId: it.master_product_id || undefined,
          productId: it.product_id || undefined,
          name: (it.name || '').trim() || 'Item',
          price: Number(it.price) || 0,
          unit: it.unit || undefined,
          image: it.image || undefined,
          totalQty: Number(it.quantity) || 1,
          orderCount: 1,
          lastOrderedAt: placedAt,
        });
        orderKeyAdded.set(key, new Set([order.id]));
      } else {
        existing.totalQty += Number(it.quantity) || 1;
        // Patch in any fields missing on the first (oldest) occurrence.
        if (!existing.masterProductId && it.master_product_id) {
          existing.masterProductId = it.master_product_id;
        }
        if (!existing.image && it.image) existing.image = it.image;
        const seenOrders = orderKeyAdded.get(key)!;
        if (!seenOrders.has(order.id)) {
          seenOrders.add(order.id);
          existing.orderCount += 1;
        }
      }
    }
  }

  // Map.values() preserves insertion order, which is already recency order
  // because orders arrive placed_at DESC.
  return Array.from(byKey.values());
}

// ─── Active / past (vega) ───────────────────────────────────────────────────

const TERMINAL_SET = new Set<string>(TERMINAL_STATUSES);

/** Every `ORDER_STATUSES` entry except `TERMINAL_STATUSES` (delivered / cancelled). */
export const ACTIVE_ORDER_STATUSES: readonly string[] = ORDER_STATUSES.filter((s) => !TERMINAL_SET.has(s));

const ACTIVE_SET = new Set<string>(ACTIVE_ORDER_STATUSES);

/** True when `order.order_status` is one of `ACTIVE_ORDER_STATUSES`. */
export function isActiveOrder(order: Order): boolean {
  return ACTIVE_SET.has(order.order_status);
}

/**
 * Partitions a list into `{ active, past }`. `active` is sorted newest first
 * by `created_at`; `past` keeps the input order (already newest first from the API).
 */
export function splitActivePast(orders: Order[]): { active: Order[]; past: Order[] } {
  const active: Order[] = [];
  const past: Order[] = [];
  for (const o of orders) (isActiveOrder(o) ? active : past).push(o);
  active.sort((a, b) => createdAtMs(b) - createdAtMs(a));
  return { active, past };
}

// ─── Reorder (vega) ─────────────────────────────────────────────────────────

/** A cart line ready for `cartActions.addMany`; `priceChanged` = catalog price differs from what was paid. */
export type ReorderItem = Omit<CartItem, 'quantity'> & { quantity: number; priceChanged: boolean };

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Turns an order's lines into cart lines using the catalog `lookup`
 * (`getCachedProduct` or a nearby-filtered map):
 * - matched in the catalog → `isLoose` + current `price` from the product, `priceChanged` when it moved
 * - `master_product_id` present but not in the catalog → the order line's price with `priceChanged: false`
 *   (`isLoose` inferred from a fractional quantity)
 * - no `master_product_id` AND no catalog match → `unavailable.push(name)`
 * Duplicate products (same item from two store orders) are merged by summing quantities.
 */
export function buildReorderItems(
  order: Order,
  lookup: (masterProductId: string) => Product | undefined,
): { items: ReorderItem[]; unavailable: string[] } {
  const byProductId = new Map<string, ReorderItem>();
  const unavailable: string[] = [];

  for (const line of order.items ?? []) {
    const qty = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
    const name = (line.name || '').trim() || 'Item';

    // Lines placed from this app carry the master id in `product_id`; backend
    // rows carry it in `master_product_id`. Try both before giving up.
    const candidates = [line.master_product_id, line.product_id].filter((id): id is string => !!id);
    let product: Product | undefined;
    for (const id of candidates) {
      product = lookup(id);
      if (product) break;
    }

    let item: ReorderItem;
    if (product) {
      item = {
        product_id: product.id,
        name: product.name,
        price: product.price,
        unit: product.unit,
        image_url: product.image_url,
        isLoose: product.isLoose ?? false,
        quantity: qty,
        priceChanged: !approxEqual(product.price, Number(line.price) || 0),
      };
    } else if (line.master_product_id) {
      item = {
        product_id: line.master_product_id,
        name,
        price: Number(line.price) || 0,
        unit: line.unit,
        image_url: line.image,
        isLoose: !Number.isInteger(qty),
        quantity: qty,
        priceChanged: false,
      };
    } else {
      unavailable.push(name);
      continue;
    }

    const existing = byProductId.get(item.product_id);
    if (existing) {
      existing.quantity += item.quantity;
      existing.priceChanged = existing.priceChanged || item.priceChanged;
    } else {
      byProductId.set(item.product_id, item);
    }
  }

  return { items: Array.from(byProductId.values()), unavailable };
}

// ─── Synthetic active order (Dev_Orders_inhibit_SimulateActive) ─────────────

const SYNTHETIC_FALLBACK_ITEMS: Pick<OrderItem, 'name' | 'price' | 'unit'>[] = [
  { name: 'Toned milk', price: 28, unit: '500 ml' },
  { name: 'Brown bread', price: 45, unit: '400 g' },
  { name: 'Bananas', price: 40, unit: '1 kg' },
];
const SYNTHETIC_DELIVERY_FEE = 25;
const SYNTHETIC_AGE_MS = 12 * 60_000;

let syntheticOrder: Order | null = null;
let syntheticOrderCatalog: ReturnType<typeof getMemoryHomeCache> = null;

/**
 * One in-transit order for dev simulations: `id 'dev-synthetic-order'`,
 * `order_number 'NN-DEV01'`, `in_transit`, paid by UPI, 3 items (the first
 * three memory-catalog products with images when the catalog is loaded,
 * placeholders otherwise), `created_at` 12 minutes before it was first built.
 * Built once per session and rebuilt when the memory catalog object changes
 * (so images appear once the catalog lands); never written to disk.
 */
export function buildSyntheticActiveOrder(): Order {
  const catalog = getMemoryHomeCache();
  if (syntheticOrder && syntheticOrderCatalog === catalog) return syntheticOrder;

  const picks = catalog?.products.slice(0, 3) ?? [];
  const items: OrderItem[] = SYNTHETIC_FALLBACK_ITEMS.map((fallback, i) => {
    const p = picks[i];
    if (!p) return { name: fallback.name, price: fallback.price, quantity: 1, unit: fallback.unit };
    return {
      product_id: p.id,
      master_product_id: p.id,
      name: p.name,
      price: Math.round(p.price * 100) / 100,
      quantity: 1,
      unit: p.unit,
      image: p.image_url,
    };
  });
  const subtotal = Math.round(items.reduce((sum, it) => sum + it.price * it.quantity, 0) * 100) / 100;
  const createdAt = syntheticOrder?.created_at ?? new Date(Date.now() - SYNTHETIC_AGE_MS).toISOString();

  syntheticOrder = {
    id: SYNTHETIC_ORDER_ID,
    order_number: 'NN-DEV01',
    order_status: 'in_transit',
    payment_status: 'paid',
    payment_method: 'upi',
    order_total: Math.round(subtotal + SYNTHETIC_DELIVERY_FEE),
    subtotal,
    delivery_fee: SYNTHETIC_DELIVERY_FEE,
    items,
    items_count: items.length,
    delivery_address: 'Simulated address (dev)',
    created_at: createdAt,
    delivery_otp: '4821',
  };
  syntheticOrderCatalog = catalog;
  return syntheticOrder;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Fetches a single order directly by id (`GET /api/orders/:orderId`,
 * ownership-checked server-side), instead of fetching the customer's whole
 * order list and scanning it for a matching id. Used right after placing an
 * order (confirmation screen) — the full-list endpoint can be a beat behind
 * (cache, replication lag) immediately after creation, which previously
 * meant `orders.find(...)` silently came back empty with no error at all.
 * `cached(QC_KEYS.order(id), 10 s, userScope)`; a resolve fills the memory
 * mirror (`peekOrder`). The dev synthetic order resolves locally while
 * `Dev_Orders_inhibit_SimulateActive` is on. Rejects on a real error.
 */
export async function getOrderById(orderId: string): Promise<Order> {
  if (orderId === SYNTHETIC_ORDER_ID && getDevFlag('Dev_Orders_inhibit_SimulateActive')) {
    const synthetic = buildSyntheticActiveOrder();
    rememberOrder(synthetic);
    return synthetic;
  }
  const gen = mirrorGen;
  const order = await cached<Order>(
    QC_KEYS.order(orderId),
    async () => {
      const raw = await apiFetch<BackendCustomerOrder>(
        `/api/orders/${encodeURIComponent(orderId)}`,
      );
      return mapBackendOrder(raw);
    },
    { ttlMs: SINGLE_ORDER_TTL_MS, userScope: true },
  );
  if (gen === mirrorGen) rememberOrder(order);
  return order;
}

// GET /api/orders/customer/:customerId — requireCustomer-gated; the controller
// verifies the :customerId param matches the caller's own session
// (req.customerId) before querying, so this is safe to call directly with no
// privileged client involved.
async function fetchUserOrders(userId: string): Promise<Order[]> {
  const rows = await apiFetch<BackendCustomerOrder[]>(
    `/api/orders/customer/${encodeURIComponent(userId)}`,
  );
  const orders = Array.isArray(rows) ? rows.map(mapBackendOrder) : [];
  writeUserOrdersCache(userId, orders).catch((err) =>
    logSilentFailure('Write user-orders cache', err),
  );
  return orders;
}

/**
 * The customer's order history, newest first.
 * `cached(QC_KEYS.orders(userId), 20 s, userScope)` dedupes Home / Orders /
 * Order again; `force` (pull-to-refresh) skips memory. A network resolve
 * writes the per-user disk row (newest 50). Every resolve fills the memory mirror.
 * `Dev_Orders_inhibit_History` → `[]` with no network;
 * `Dev_Orders_inhibit_SimulateActive` → `buildSyntheticActiveOrder()` prepended.
 */
export async function getUserOrders(userId: string, opts?: { force?: boolean }): Promise<Order[]> {
  if (!userId) return [];

  const gen = mirrorGen;
  let orders: Order[];
  if (getDevFlag('Dev_Orders_inhibit_History')) {
    orders = [];
  } else {
    orders = await cached<Order[]>(QC_KEYS.orders(userId), () => fetchUserOrders(userId), {
      ttlMs: ORDERS_LIST_TTL_MS,
      userScope: true,
      force: opts?.force,
    });
  }

  if (getDevFlag('Dev_Orders_inhibit_SimulateActive')) {
    orders = [buildSyntheticActiveOrder(), ...orders.filter((o) => o.id !== SYNTHETIC_ORDER_ID)];
  }

  if (gen === mirrorGen) rememberOrders(orders);
  return orders;
}

// ─── Delivery OTP ────────────────────────────────────────────────────────────

/**
 * Statuses where the delivery OTP should be displayed to the customer.
 * The OTP is stored on the order and shown from order_picked_up until delivered.
 */
export function shouldShowOTP(status: string): boolean {
  return ['in_transit', 'order_picked_up'].includes(status);
}
