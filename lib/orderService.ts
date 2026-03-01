import { supabase, supabaseAdmin } from './supabase';

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

async function getNearbyStoreIds(lat: number, lng: number, radiusKm = 50): Promise<string[]> {
  try {
    const { data: storeIds, error } = await supabaseAdmin.rpc('get_nearby_store_ids', {
      cust_lat: lat,
      cust_lng: lng,
      radius_km: radiusKm,
    });
    if (error || !storeIds?.length) return [];
    return storeIds as string[];
  } catch {
    return [];
  }
}

async function generateOrderNumber(): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const prefix = `NN${year}${month}${day}`;

  const { data, error } = await supabase.rpc('generate_next_order_number', {
    prefix_input: prefix,
  });

  if (error || !data) throw new Error('Failed to generate order number');
  return data as string;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const storeIds = await getNearbyStoreIds(
    input.delivery_latitude,
    input.delivery_longitude,
    50,
  );
  if (!storeIds.length) {
    throw new Error('No store available for your delivery address. Please contact support.');
  }

  const orderCode = await generateOrderNumber();

  const masterProductIds = [
    ...new Set(
      input.items
        .map((it) => it.product_id)
        .filter((id): id is string => id != null && id !== ''),
    ),
  ];

  if (masterProductIds.length === 0) throw new Error('No valid products in order');

  const { data: productRows } = await supabaseAdmin
    .from('products')
    .select('id, store_id, master_product_id')
    .in('store_id', storeIds)
    .in('master_product_id', masterProductIds)
    .eq('is_active', true);

  const byMaster = new Map<string, Array<{ store_id: string; product_id: string }>>();
  for (const row of productRows || []) {
    const list = byMaster.get(row.master_product_id) || [];
    list.push({ store_id: row.store_id, product_id: row.id });
    byMaster.set(row.master_product_id, list);
  }

  const storeToItems = new Map<string, typeof input.items>();
  const assigned = new Set<number>();

  while (assigned.size < input.items.length) {
    let bestStore: string | null = null;
    let bestCount = 0;
    for (const storeId of storeIds) {
      let count = 0;
      for (let i = 0; i < input.items.length; i++) {
        if (assigned.has(i)) continue;
        const mid = input.items[i].product_id;
        const options = mid ? byMaster.get(mid) || [] : [];
        if (options.some((o) => o.store_id === storeId)) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestStore = storeId;
      }
    }
    if (!bestStore || bestCount === 0) break;
    const chunkItems: typeof input.items = [];
    for (let i = 0; i < input.items.length; i++) {
      if (assigned.has(i)) continue;
      const it = input.items[i];
      const mid = it.product_id;
      const options = mid ? byMaster.get(mid) || [] : [];
      if (options.some((o) => o.store_id === bestStore)) {
        chunkItems.push(it);
        assigned.add(i);
      }
    }
    const existing = storeToItems.get(bestStore) || [];
    storeToItems.set(bestStore, [...existing, ...chunkItems]);
  }

  const unassigned = input.items.filter((_, i) => !assigned.has(i));
  if (unassigned.length > 0) {
    throw new Error(
      `Product(s) not available from any nearby store: ${unassigned.map((u) => u.name).join(', ')}`,
    );
  }

  const paymentMethodEnum =
    input.payment_method === 'cod' ? 'cash_on_delivery' : 'upi';

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
      total_amount: input.order_total,
      delivery_address: input.delivery_address,
      delivery_latitude: input.delivery_latitude,
      delivery_longitude: input.delivery_longitude,
      notes: null,
    })
    .select()
    .single();

  if (coError || !customerOrder) {
    throw new Error(coError?.message || 'Failed to create order');
  }

  const storeIdsToUse = Array.from(storeToItems.keys());
  const itemChunks = storeIdsToUse.map((sid) => storeToItems.get(sid)!);

  for (let i = 0; i < itemChunks.length; i++) {
    const chunkItems = itemChunks[i];
    const storeId = storeIdsToUse[i];
    if (!chunkItems?.length || !storeId) continue;

    const chunkSubtotal = chunkItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const chunkDeliveryFee =
      itemChunks.length > 1 ? input.delivery_fee / itemChunks.length : input.delivery_fee;

    const { data: storeOrder, error: soError } = await supabaseAdmin
      .from('store_orders')
      .insert({
        customer_order_id: customerOrder.id,
        store_id: storeId,
        subtotal_amount: chunkSubtotal,
        delivery_fee: chunkDeliveryFee,
        status: 'pending_at_store',
      })
      .select()
      .single();

    if (soError || !storeOrder) {
      throw new Error(soError?.message || 'Failed to create store order');
    }

    const chunkMasterIds = chunkItems
      .map((it) => it.product_id)
      .filter((id): id is string => id != null && id !== '');

    if (chunkMasterIds.length === 0) continue;

    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, master_product_id')
      .eq('store_id', storeId)
      .in('master_product_id', chunkMasterIds)
      .eq('is_active', true);

    if (productsError) throw new Error('Failed to verify product availability');

    const masterToProduct = new Map<string, string>();
    for (const p of products || []) masterToProduct.set(p.master_product_id, p.id);

    const orderItemsPayload = chunkItems.map((item) => {
      const productId = item.product_id ? masterToProduct.get(item.product_id) : null;
      if (!productId) throw new Error(`Product "${item.name}" is not available from the store.`);
      return {
        store_order_id: storeOrder.id,
        product_id: productId,
        product_name: item.name,
        unit: item.unit || null,
        image_url: item.image || null,
        unit_price: item.price,
        quantity: item.quantity,
      };
    });

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItemsPayload);
    if (itemsError) throw new Error(itemsError.message || 'Failed to create order items');
  }

  await supabaseAdmin.from('order_status_history').insert({
    customer_order_id: customerOrder.id,
    status: 'pending_at_store',
    notes: 'Order placed',
    created_at: new Date().toISOString(),
  });

  return {
    id: customerOrder.id,
    order_number: orderCode,
    order_status: 'pending_at_store',
    payment_status: input.payment_status,
    payment_method: input.payment_method,
    order_total: input.order_total,
    subtotal: input.subtotal,
    delivery_fee: input.delivery_fee,
    items: input.items,
    items_count: input.items.length,
    delivery_address: input.delivery_address,
    created_at: customerOrder.placed_at || customerOrder.created_at || new Date().toISOString(),
  };
}

export async function getUserOrders(userId: string): Promise<Order[]> {
  if (!userId) return [];

  const { data: customerOrders, error } = await supabaseAdmin
    .from('customer_orders')
    .select(
      'id, order_code, customer_id, status, payment_status, payment_method, subtotal_amount, delivery_fee, total_amount, delivery_address, placed_at, created_at',
    )
    .eq('customer_id', userId)
    .order('placed_at', { ascending: false });

  if (error || !customerOrders?.length) return [];

  const orderIds = customerOrders.map((co) => co.id);

  const { data: storeOrders } = await supabaseAdmin
    .from('store_orders')
    .select('id, customer_order_id')
    .in('customer_order_id', orderIds);

  const storeOrderIds = (storeOrders || []).map((so) => so.id);
  const coToStoreOrders = new Map<string, typeof storeOrders>();
  for (const so of storeOrders || []) {
    const list = coToStoreOrders.get(so.customer_order_id) || [];
    list!.push(so);
    coToStoreOrders.set(so.customer_order_id, list!);
  }

  const { data: items } = storeOrderIds.length
    ? await supabaseAdmin
        .from('order_items')
        .select('store_order_id, product_id, product_name, unit, image_url, unit_price, quantity')
        .in('store_order_id', storeOrderIds)
    : { data: [] };

  const soToItems = new Map<string, typeof items>();
  for (const item of items || []) {
    const list = soToItems.get(item.store_order_id) || [];
    list!.push(item);
    soToItems.set(item.store_order_id, list!);
  }

  return customerOrders.map((co) => {
    const storeOrdersForCo = coToStoreOrders.get(co.id) || [];
    const allItems: OrderItem[] = [];
    for (const so of storeOrdersForCo!) {
      const oi = soToItems.get(so!.id) || [];
      for (const i of oi!) {
        allItems.push({
          product_id: i!.product_id,
          name: i!.product_name,
          price: i!.unit_price,
          quantity: i!.quantity,
          image: i!.image_url,
          unit: i!.unit,
        });
      }
    }
    return {
      id: co.id,
      order_number: co.order_code,
      order_status: co.status,
      payment_status: co.payment_status,
      payment_method: co.payment_method || '',
      order_total: Number(co.total_amount),
      subtotal: Number(co.subtotal_amount),
      delivery_fee: Number(co.delivery_fee || 0),
      items: allItems,
      items_count: allItems.length,
      delivery_address: co.delivery_address || '',
      created_at: co.placed_at || co.created_at || '',
    };
  });
}
