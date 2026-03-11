import { apiFetch } from './apiClient';
import { assertSupabaseAdminConfigured, supabaseAdmin } from './supabase';

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
  payment_method: 'upi' | 'cod';
  payment_status: 'pending' | 'paid';
  subtotal: number;
  delivery_fee: number;
  order_total: number;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  items: OrderItem[];
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

// POST /api/orders/create — handled by Railway backend (service role key stays server-side)
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const payload = {
    customer_id: input.user_id,
    delivery_address: input.delivery_address,
    delivery_latitude: input.delivery_latitude,
    delivery_longitude: input.delivery_longitude,
    payment_method: input.payment_method,
    notes: undefined,
    coupon_id: undefined,
    cart_items: (input.items || []).map((it) => ({
      product_id: it.product_id || '',
      product_name: it.name,
      // store_id is required by the backend schema; if your backend assigns stores later,
      // update the backend to accept cart without store_id and infer store mapping.
      store_id: '',
      unit_price: it.price,
      quantity: it.quantity,
      unit: it.unit,
      image_url: it.image,
    })),
  };

  const created = await apiFetch<any>('/api/orders/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  // Backend returns { customer_order, store_orders }. Normalize to our Order shape.
  if (created?.customer_order?.id) {
    return mapBackendOrder({
      ...created.customer_order,
      store_orders: created.store_orders || [],
    } as BackendCustomerOrder);
  }
  return created as Order;
}

// GET /api/orders/customer/:customerId — handled by Railway backend (reads with service role server-side)
export async function getUserOrders(userId: string): Promise<Order[]> {
  if (!userId) return [];
  // Prefer direct DB read (matches your schema exactly). Fallback to backend if admin key isn't configured.
  try {
    return await getUserOrdersFromSupabase(userId);
  } catch (err) {
    // If admin key is missing, or any other issue occurs, try the backend route.
    try {
      const rows = await apiFetch<BackendCustomerOrder[]>(
        `/api/orders/customer/${encodeURIComponent(userId)}`,
      );
      if (!Array.isArray(rows)) return [];
      return rows.map(mapBackendOrder);
    } catch (err2) {
      const message =
        (err2 instanceof Error && err2.message) ||
        (err instanceof Error && err.message) ||
        'Failed to fetch orders';
      throw new Error(message);
    }
  }
}
