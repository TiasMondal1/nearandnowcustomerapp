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
  product_id?: string;
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

function mapBackendOrder(order: BackendCustomerOrder): Order {
  const items: OrderItem[] = [];
  for (const so of order.store_orders || []) {
    for (const it of so.order_items || []) {
      items.push({
        product_id: (it.product_id ?? undefined) || undefined,
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
          image_url
        )
      )
    `,
    )
    .eq('customer_id', userId)
    .order('placed_at', { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (data || []) as unknown as BackendCustomerOrder[];
  return rows.map(mapBackendOrder);
}

// Direct-to-Supabase order creation.
//
// NOTE (temporary): we bypass the backend's `/api/orders/place` nearest-store
// pipeline for now because the production DB doesn't yet have the per-store
// inventory populated (the `products` / `stores` tables are sparse), and that
// pipeline throws "No store available" / "Product(s) not available from any
// store near you" if ANY cart item can't be mapped to a nearby store. Until
// inventory is in place, orders simply get pinned to the first active store
// and any cart items without a matching `products` row are recorded in the
// `notes` column instead of `order_items`. The order itself always goes in,
// so the checkout/payment flow works end-to-end.
//
// When inventory is ready, flip back to `/api/orders/place` — nothing else
// in the app depends on the direct-write path.
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  assertSupabaseAdminConfigured();

  // ─── 1. Fold extras into notes ────────────────────────────────────────────
  const noteParts: string[] = [];
  if (input.notes) noteParts.push(input.notes);
  if (input.gstin) noteParts.push(`GSTIN: ${input.gstin}`);
  if (typeof input.tip_amount === 'number' && input.tip_amount > 0) {
    noteParts.push(`Tip: ₹${input.tip_amount.toFixed(2)}`);
  }

  // ─── 2. Pick any active store (fallback until nearest-store is wired) ────
  let fallbackStoreId: string | null = null;
  try {
    const { data: stores } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    fallbackStoreId = (stores && stores[0]?.id) || null;
  } catch {
    // If there isn't even one active store, we still create the order — it
    // just won't get a store_orders row. Delivery ops can reassign later.
    fallbackStoreId = null;
  }

  // ─── 3. Resolve master_product_id → products.id (best-effort) ────────────
  // `order_items.product_id` references `products.id` (store-specific catalog
  // row), not `master_products.id`. The mobile cart stores master ids, so we
  // have to map. We prefer products from the fallback store, then fall back
  // to ANY active products row with the same master id.
  const masterIds = Array.from(
    new Set(
      (input.items || [])
        .map((i) => i.product_id)
        .filter((id): id is string => !!id && id.length > 0),
    ),
  );

  type ProductRow = { id: string; store_id: string; master_product_id: string };
  let productRows: ProductRow[] = [];
  if (masterIds.length > 0) {
    try {
      const { data } = await supabaseAdmin
        .from('products')
        .select('id, store_id, master_product_id')
        .in('master_product_id', masterIds)
        .eq('is_active', true);
      productRows = (data as ProductRow[] | null) || [];
    } catch {
      productRows = [];
    }
  }

  const resolveProductId = (masterId: string | undefined): string | null => {
    if (!masterId) return null;
    const matches = productRows.filter((r) => r.master_product_id === masterId);
    if (matches.length === 0) return null;
    const preferred = matches.find((r) => r.store_id === fallbackStoreId);
    return (preferred || matches[0]).id;
  };

  // ─── 4. Order code — simple, unique, human-readable ──────────────────────
  const orderCode = `NAN-${Date.now().toString(36).toUpperCase()}`;

  // ─── 5. Payment method → DB enum ─────────────────────────────────────────
  // `customer_orders.payment_method` is a Postgres enum (`payment_method`).
  // The schema's enum values are `cod` and `razorpay` — map the mobile's
  // 'upi' rail to 'razorpay' so the insert doesn't trip the enum check.
  const paymentMethodEnum =
    input.payment_method === 'cod' ? 'cod' : 'razorpay';

  // ─── 6. Insert customer_orders ───────────────────────────────────────────
  const { data: customerOrder, error: coError } = await supabaseAdmin
    .from('customer_orders')
    .insert({
      customer_id: input.user_id,
      order_code: orderCode,
      status: 'pending_at_store',
      payment_status: input.payment_status,
      payment_method: paymentMethodEnum,
      subtotal_amount: input.subtotal,
      delivery_fee: input.delivery_fee,
      discount_amount: 0,
      total_amount: Math.round(input.order_total),
      delivery_address: input.delivery_address,
      delivery_latitude: input.delivery_latitude,
      delivery_longitude: input.delivery_longitude,
      notes: noteParts.length ? noteParts.join(' | ') : null,
    })
    .select()
    .single();

  if (coError || !customerOrder) {
    throw new Error(coError?.message || 'Failed to create order');
  }

  const customerOrderId = String((customerOrder as { id: string }).id);

  // ─── 7. Best-effort: store_orders + order_items ──────────────────────────
  // If we have a fallback store, create one store_orders row and slot all
  // the resolvable items under it. Items whose master id doesn't map to any
  // products row are appended to notes so the record isn't lost.
  const unresolvedItemNames: string[] = [];
  if (fallbackStoreId) {
    const { data: storeOrder, error: soError } = await supabaseAdmin
      .from('store_orders')
      .insert({
        customer_order_id: customerOrderId,
        store_id: fallbackStoreId,
        status: 'pending_at_store',
        subtotal_amount: input.subtotal,
        delivery_fee: input.delivery_fee,
      })
      .select()
      .single();

    if (!soError && storeOrder) {
      const storeOrderId = String((storeOrder as { id: string }).id);
      const orderItemsPayload: Array<{
        store_order_id: string;
        product_id: string;
        product_name: string;
        unit: string | null;
        image_url: string | null;
        unit_price: number;
        quantity: number;
      }> = [];

      for (const it of input.items) {
        const productId = resolveProductId(it.product_id);
        if (!productId) {
          unresolvedItemNames.push(`${it.name} × ${it.quantity}`);
          continue;
        }
        orderItemsPayload.push({
          store_order_id: storeOrderId,
          product_id: productId,
          product_name: it.name,
          unit: it.unit || null,
          image_url: it.image || null,
          unit_price: it.price,
          quantity: it.quantity,
        });
      }

      if (orderItemsPayload.length > 0) {
        const { error: itemsError } = await supabaseAdmin
          .from('order_items')
          .insert(orderItemsPayload);
        if (itemsError) {
          // Non-fatal: the order still exists, we just couldn't attach the
          // items list. Log to notes so support can reconstruct the cart.
          unresolvedItemNames.push(
            ...input.items
              .filter((_, idx) => idx < orderItemsPayload.length)
              .map((it) => `${it.name} × ${it.quantity}`),
          );
        }
      }
    }
  } else {
    // No store available at all — every item is unresolved.
    for (const it of input.items) {
      unresolvedItemNames.push(`${it.name} × ${it.quantity}`);
    }
  }

  // If any items couldn't be FK'd, patch them into the notes column so the
  // full cart is always recoverable from the customer_orders row.
  if (unresolvedItemNames.length > 0) {
    const unresolvedNote = `Unlinked items: ${unresolvedItemNames.join(', ')}`;
    const mergedNotes = [
      noteParts.length ? noteParts.join(' | ') : null,
      unresolvedNote,
    ]
      .filter(Boolean)
      .join(' | ');
    try {
      await supabaseAdmin
        .from('customer_orders')
        .update({ notes: mergedNotes })
        .eq('id', customerOrderId);
    } catch {
      // ignore — notes update is purely informational
    }
  }

  // ─── 8. Seed order_status_history ────────────────────────────────────────
  try {
    await supabaseAdmin.from('order_status_history').insert({
      customer_order_id: customerOrderId,
      status: 'pending_at_store',
      notes: 'Order placed',
    });
  } catch {
    // History row is nice-to-have, never fatal.
  }

  // ─── 9. Return the Order shape the app expects ───────────────────────────
  const placedOrder: Order = {
    id: customerOrderId,
    order_number: orderCode,
    order_status: 'pending_at_store',
    payment_status: input.payment_status,
    payment_method: paymentMethodEnum,
    order_total: input.order_total,
    subtotal: input.subtotal,
    delivery_fee: input.delivery_fee,
    items: input.items,
    items_count: input.items.length,
    delivery_address: input.delivery_address,
    created_at:
      (customerOrder as { placed_at?: string; created_at?: string }).placed_at ||
      (customerOrder as { created_at?: string }).created_at ||
      new Date().toISOString(),
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
