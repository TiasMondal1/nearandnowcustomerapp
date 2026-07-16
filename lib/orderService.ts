import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch } from './apiClient';
import { assertSupabaseAdminConfigured, supabaseAdmin } from './supabase';

// ─── User-orders SWR cache ──────────────────────────────────────────────────
// Keyed per user so switching accounts on the same device doesn't cross
// contaminate. Same shape/versioning as the home-catalog and saved-address
// caches for consistency.
const ORDERS_CACHE_VERSION = 1;
const ORDERS_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 1 day

const ordersCacheKey = (userId: string) =>
  `nn_user_orders_v${ORDERS_CACHE_VERSION}:${userId}`;

interface UserOrdersCache {
  version: number;
  savedAt: number;
  orders: unknown[];
}

export async function readUserOrdersCache(
  userId: string,
): Promise<Order[] | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(ordersCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserOrdersCache;
    if (!parsed || parsed.version !== ORDERS_CACHE_VERSION) return null;
    if (Date.now() - parsed.savedAt > ORDERS_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.orders) ? (parsed.orders as Order[]) : null;
  } catch {
    return null;
  }
}

async function writeUserOrdersCache(
  userId: string,
  orders: Order[],
): Promise<void> {
  if (!userId) return;
  const payload: UserOrdersCache = {
    version: ORDERS_CACHE_VERSION,
    savedAt: Date.now(),
    orders,
  };
  try {
    await AsyncStorage.setItem(ordersCacheKey(userId), JSON.stringify(payload));
  } catch {
    // Cache writes are best-effort.
  }
}

export async function invalidateUserOrdersCache(userId: string): Promise<void> {
  if (!userId) return;
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
  payment_method: "upi" | "cod";
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
  tip_amount?: number;
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
    items,
    items_count: items.length,
    delivery_address: order.delivery_address || undefined,
    created_at: order.placed_at || order.created_at || new Date().toISOString(),
  };
}

async function getUserOrdersFromSupabase(userId: string): Promise<Order[]> {
  assertSupabaseAdminConfigured();

  const { data, error } = await supabaseAdmin
    .from('customer_orders')
    .select(
      `
      id,
      order_code,
      customer_id,
      status,
      payment_status,
      payment_method,
      subtotal_amount,
      delivery_fee,
      total_amount,
      delivery_address,
      placed_at,
      created_at,
      store_orders (
        id,
        order_items (
          product_id,
          product_name,
          unit_price,
          quantity,
          unit,
          image_url,
          products:product_id (
            master_product_id
          )
        )
      )
    `,
    )
    .eq('customer_id', userId)
    .order('placed_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  const rows = (data || []) as unknown as BackendCustomerOrder[];
  return rows.map(mapBackendOrder);
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
  // Delivery-note extras the backend doesn't have dedicated columns for yet
  // get folded into the free-text `notes` field, same as before.
  const noteParts: string[] = [];
  if (input.notes) noteParts.push(input.notes);
  if (input.gstin) noteParts.push(`GSTIN: ${input.gstin}`);
  if (typeof input.tip_amount === 'number' && input.tip_amount > 0) {
    noteParts.push(`Tip: ₹${input.tip_amount.toFixed(2)}`);
  }

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
      notes: noteParts.length ? noteParts.join(' | ') : undefined,
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

  // Fire-and-forget: the next visit to the Orders tab will refresh from the
  // server anyway, but clearing the stale cache now means the new order shows
  // up at the top even on a cold start within the TTL window.
  invalidateUserOrdersCache(input.user_id).catch(() => {});
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
): Promise<{ payment_status: string; status: string } | null> {
  if (!orderId) return null;
  try {
    assertSupabaseAdminConfigured();
    const { data, error } = await supabaseAdmin
      .from('customer_orders')
      .select('payment_status, status')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      payment_status: String((data as any).payment_status || 'pending'),
      status: String((data as any).status || ''),
    };
  } catch (err) {
    console.warn('[ORDER] getOrderPaymentStatus failed', err);
    return null;
  }
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

/**
 * @deprecated Use {@link buildOrderAgainItems} instead — it returns hydrated
 * items so the UI can render even when the catalog is unavailable. Kept as a
 * thin shim so existing call sites don't break.
 */
export function buildOrderAgainProductIds(orders: Order[]): {
  productIds: string[];
  qtyByProductId: Record<string, number>;
} {
  const items = buildOrderAgainItems(orders);
  const productIds: string[] = [];
  const qtyByProductId: Record<string, number> = {};
  for (const it of items) {
    const id = it.masterProductId || it.productId;
    if (!id) continue;
    productIds.push(id);
    qtyByProductId[id] = it.totalQty;
  }
  return { productIds, qtyByProductId };
}

// GET /api/orders/customer/:customerId — handled by Railway backend (reads with service role server-side)
export async function getUserOrders(userId: string): Promise<Order[]> {
  if (!userId) return [];
  // Prefer direct DB read (matches your schema exactly). Fallback to backend if admin key isn't configured.
  try {
    const orders = await getUserOrdersFromSupabase(userId);
    writeUserOrdersCache(userId, orders).catch(() => {});
    return orders;
  } catch (err) {
    // If admin key is missing, or any other issue occurs, try the backend route.
    try {
      const rows = await apiFetch<BackendCustomerOrder[]>(
        `/api/orders/customer/${encodeURIComponent(userId)}`,
      );
      if (!Array.isArray(rows)) return [];
      const orders = rows.map(mapBackendOrder);
      writeUserOrdersCache(userId, orders).catch(() => {});
      return orders;
    } catch (err2) {
      const message =
        (err2 instanceof Error && err2.message) ||
        (err instanceof Error && err.message) ||
        'Failed to fetch orders';
      throw new Error(message);
    }
  }
}

// ─── Delivery OTP ────────────────────────────────────────────────────────────

/**
 * Statuses where the delivery OTP should be displayed to the customer.
 * The OTP is stored on the order and shown from order_picked_up until delivered.
 */
export function shouldShowOTP(status: string): boolean {
  return ['in_transit', 'order_picked_up'].includes(status);
}
