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
  const { supabaseAdmin } = await import('./supabase');
  
  try {
    const { data: store, error } = await supabaseAdmin
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
  const { supabaseAdmin } = await import('./supabase');
  
  try {
    const { data: product, error } = await supabaseAdmin
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
