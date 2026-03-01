import { supabaseAdmin } from './supabase';

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  original_price?: number;
  image_url?: string;
  description?: string;
  in_stock: boolean;
  unit: string;
  isLoose?: boolean;
  created_at?: string;
}

interface ProductRow {
  id: string;
  store_id: string;
  master_product_id: string;
  quantity: number;
  is_active: boolean;
  master_products?: {
    id: string;
    name: string;
    category: string;
    base_price: number;
    discounted_price: number;
    unit: string;
    image_url?: string;
    description?: string;
    is_loose?: boolean;
    is_active: boolean;
    created_at?: string;
    [key: string]: unknown;
  } | null;
}

const IN_FILTER_CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function fetchProductRows(storeIds: string[] | null): Promise<ProductRow[]> {
  const allRows: ProductRow[] = [];

  if (storeIds != null && storeIds.length > 0) {
    const storeChunks = chunk(storeIds, IN_FILTER_CHUNK_SIZE);
    for (const ids of storeChunks) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('id, store_id, master_product_id, quantity, is_active, master_products(*)')
        .eq('is_active', true)
        .in('store_id', ids);
      if (error) throw new Error(`Database error: ${error.message}`);
      if (data?.length) allRows.push(...(data as ProductRow[]));
    }
    return allRows;
  }

  let from = 0;
  const batchSize = 500;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, store_id, master_product_id, quantity, is_active, master_products(*)')
      .eq('is_active', true)
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`Database error: ${error.message}`);
    if (data && data.length > 0) {
      allRows.push(...(data as ProductRow[]));
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }
  return allRows;
}

function productRowsToProducts(rows: ProductRow[]): Product[] {
  const byMaster = new Map<string, ProductRow>();
  for (const row of rows) {
    const mp = row.master_products;
    if (!mp || !mp.is_active) continue;
    const existing = byMaster.get(row.master_product_id);
    const q = typeof row.quantity === 'number' ? row.quantity : parseFloat(String(row.quantity)) || 0;
    if (!existing || (typeof existing.quantity === 'number' ? existing.quantity : 0) < q) {
      byMaster.set(row.master_product_id, row);
    }
  }
  return Array.from(byMaster.values()).map(transformRow);
}

function transformRow(row: ProductRow): Product {
  const mp = row.master_products!;
  const price =
    mp.discounted_price != null
      ? typeof mp.discounted_price === 'string'
        ? parseFloat(mp.discounted_price)
        : mp.discounted_price
      : 0;
  const originalPrice =
    mp.base_price != null
      ? typeof mp.base_price === 'string'
        ? parseFloat(mp.base_price)
        : mp.base_price
      : undefined;
  const q =
    typeof row.quantity === 'number' ? row.quantity : parseFloat(String(row.quantity)) || 0;

  return {
    id: mp.id,
    name: mp.name,
    category: mp.category,
    price,
    original_price: originalPrice,
    image_url: mp.image_url,
    description: mp.description,
    in_stock: row.is_active && q > 0,
    unit: mp.unit ?? 'piece',
    isLoose: mp.is_loose ?? false,
    created_at: mp.created_at,
  };
}

export async function getAllProducts(options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<Product[]> {
  const { lat, lng, radiusKm = 50 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;
  const rows = await fetchProductRows(storeIdsToUse);
  return productRowsToProducts(rows);
}

export async function getProductsByCategory(
  categoryName: string,
  options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const { lat, lng, radiusKm = 50 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;
  const rows = await fetchProductRows(storeIdsToUse);
  const filtered = rows.filter((r) => r.master_products?.category === categoryName);
  return productRowsToProducts(filtered);
}

export async function searchProducts(
  query: string,
  options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const { lat, lng, radiusKm = 50 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;
  const rows = await fetchProductRows(storeIdsToUse);
  const q = query.trim().toLowerCase();
  const matching = q ? rows.filter((r) => r.master_products?.name?.toLowerCase().includes(q)) : rows;
  return productRowsToProducts(matching);
}

export async function getProductById(masterProductId: string): Promise<Product | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select('*')
      .eq('id', masterProductId)
      .single();

    if (error || !data) return null;

    const price =
      data.discounted_price != null
        ? typeof data.discounted_price === 'string'
          ? parseFloat(data.discounted_price)
          : data.discounted_price
        : 0;

    return {
      id: data.id,
      name: data.name,
      category: data.category,
      price,
      original_price: data.base_price ? Number(data.base_price) : undefined,
      image_url: data.image_url,
      description: data.description,
      in_stock: data.is_active ?? true,
      unit: data.unit ?? 'piece',
      isLoose: data.is_loose ?? false,
      created_at: data.created_at,
    };
  } catch {
    return null;
  }
}
