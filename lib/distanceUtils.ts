export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export async function getStoreDistance(
  storeId: string,
  customerLat: number,
  customerLng: number,
): Promise<number> {
  // Plain anon client — this only reads public store/product coordinates
  // (no user-owned data, no IDOR risk), the same data lib/storeService.ts
  // and lib/productService.ts already read via the anon client. Using the
  // privileged admin client here was unnecessary.
  const { supabase } = await import('./supabase');
  
  try {
    const { data: store, error } = await supabase
      .from('stores')
      .select('latitude, longitude')
      .eq('id', storeId)
      .single();

    if (error || !store) return 50;

    return calculateDistance(
      customerLat,
      customerLng,
      store.latitude,
      store.longitude,
    );
  } catch {
    return 50;
  }
}

export async function getProductStoreDistance(
  productId: string,
  customerLat: number,
  customerLng: number,
): Promise<number> {
  // Plain anon client — this only reads public store/product coordinates
  // (no user-owned data, no IDOR risk), the same data lib/storeService.ts
  // and lib/productService.ts already read via the anon client. Using the
  // privileged admin client here was unnecessary.
  const { supabase } = await import('./supabase');

  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('store_id, stores(latitude, longitude)')
      .eq('master_product_id', productId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (error || !product || !product.stores) return 50;

    const store = product.stores as any;
    return calculateDistance(
      customerLat,
      customerLng,
      store.latitude,
      store.longitude,
    );
  } catch {
    return 50;
  }
}

/**
 * Batched version — resolves distances for multiple products in a SINGLE
 * round-trip instead of one per item (the checkout N+1 pattern).
 *
 * Replaces the `items.map(item => getProductStoreDistance(...))` pattern in
 * checkout.tsx, which issued one DB query per cart item and blocked the fee
 * calculation for each sequential response.
 */
export async function getBatchProductStoreDistances(
  productIds: string[],
  customerLat: number,
  customerLng: number,
): Promise<number[]> {
  if (!productIds.length) return [];
  // Plain anon client — this only reads public store/product coordinates
  // (no user-owned data, no IDOR risk), the same data lib/storeService.ts
  // and lib/productService.ts already read via the anon client. Using the
  // privileged admin client here was unnecessary.
  const { supabase } = await import('./supabase');

  try {
    const { data, error } = await supabase
      .from('products')
      .select('master_product_id, stores(latitude, longitude)')
      .in('master_product_id', productIds)
      .eq('is_active', true);

    if (error || !data) return productIds.map(() => 50);

    // Build a map of master_product_id → closest store distance.
    const distByMasterId = new Map<string, number>();
    for (const row of data as any[]) {
      if (!row.master_product_id || !row.stores) continue;
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
      if (!store?.latitude || !store?.longitude) continue;
      const d = calculateDistance(customerLat, customerLng, store.latitude, store.longitude);
      const existing = distByMasterId.get(row.master_product_id);
      if (existing === undefined || d < existing) {
        distByMasterId.set(row.master_product_id, d);
      }
    }

    return productIds.map((id) => distByMasterId.get(id) ?? 50);
  } catch {
    return productIds.map(() => 50);
  }
}
