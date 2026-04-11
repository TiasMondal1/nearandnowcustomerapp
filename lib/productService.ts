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
  avgRating?: number;
  reviewCount?: number;
}

interface ProductRow {
  id: string;
  store_id: string;
  master_product_id: string;
  // `products.quantity` may not exist in your current Supabase schema yet.
  // Keep it optional so the app doesn't crash when it's missing.
  quantity?: unknown;
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
    avg_rating?: number | string | null;
    review_count?: number | string | null;
    [key: string]: unknown;
  } | null;
}

const IN_FILTER_CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function coerceQuantity(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

async function getNearbyStoreIds(lat: number, lng: number, radiusKm = 4): Promise<string[]> {
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
        .select('id, store_id, master_product_id, is_active, master_products(*)')
        .eq('is_active', true)
        .in('store_id', ids);
      if (error) throw new Error(`Database error: ${error.message}`);
      if (data?.length) allRows.push(...(data as unknown as ProductRow[]));
    }
    return allRows;
  }

  let from = 0;
  const batchSize = 500;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, store_id, master_product_id, is_active, master_products(*)')
      .eq('is_active', true)
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`Database error: ${error.message}`);
    if (data && data.length > 0) {
      allRows.push(...(data as unknown as ProductRow[]));
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
    if (!mp) continue;

    // Handle master_products as either single object or array
    const masterProduct = Array.isArray(mp) ? mp[0] : mp;
    if (!masterProduct || !masterProduct.is_active) continue;

    const existing = byMaster.get(row.master_product_id);
    if (!existing) {
      byMaster.set(row.master_product_id, row);
      continue;
    }

    // If `quantity` exists in the row, prefer the highest-quantity store row per master product.
    // If quantity is missing, keep the first-seen row to avoid unstable behavior.
    const q = coerceQuantity(row.quantity);
    const existingQ = coerceQuantity(existing.quantity);
    if (q != null && (existingQ == null || existingQ < q)) byMaster.set(row.master_product_id, row);
  }
  return Array.from(byMaster.values()).map(transformRow);
}

function transformRow(row: ProductRow): Product {
  const mp = row.master_products!;
  // Handle master_products as either single object or array
  const masterProduct = Array.isArray(mp) ? mp[0] : mp;

  const price =
    masterProduct.discounted_price != null
      ? typeof masterProduct.discounted_price === 'string'
        ? parseFloat(masterProduct.discounted_price)
        : masterProduct.discounted_price
      : 0;
  const originalPrice =
    masterProduct.base_price != null
      ? typeof masterProduct.base_price === 'string'
        ? parseFloat(masterProduct.base_price)
        : masterProduct.base_price
      : undefined;
  const q = coerceQuantity(row.quantity);

  const avgRating =
    masterProduct.avg_rating == null
      ? undefined
      : typeof masterProduct.avg_rating === "string"
        ? parseFloat(masterProduct.avg_rating)
        : masterProduct.avg_rating;

  const reviewCount =
    masterProduct.review_count == null
      ? undefined
      : typeof masterProduct.review_count === "string"
        ? Number(masterProduct.review_count)
        : masterProduct.review_count;

  return {
    id: masterProduct.id,
    name: masterProduct.name,
    category: masterProduct.category,
    price,
    original_price: originalPrice,
    image_url: masterProduct.image_url,
    description: masterProduct.description,
    // When quantity isn't available, treat "active" as in-stock.
    in_stock: row.is_active && (q == null || q > 0),
    unit: masterProduct.unit ?? 'piece',
    isLoose: masterProduct.is_loose ?? false,
    created_at: masterProduct.created_at,
    avgRating: Number.isFinite(avgRating as number) ? (avgRating as number) : undefined,
    reviewCount: Number.isFinite(reviewCount as number) ? (reviewCount as number) : undefined,
  };
}

export async function getAllProducts(options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<Product[]> {
  const { lat, lng, radiusKm = 4 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;

  // If no nearby stores found but location was provided, fetch all products
  // This ensures products are still shown even if location filtering fails
  const rows = await fetchProductRows(
    (lat != null && lng != null && !storeIdsToUse) ? null : storeIdsToUse
  );
  return productRowsToProducts(rows);
}

export async function getProductsByCategory(
  categoryName: string,
  options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const { lat, lng, radiusKm = 4 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;

  // If no nearby stores found but location was provided, fetch all products
  const rows = await fetchProductRows(
    (lat != null && lng != null && !storeIdsToUse) ? null : storeIdsToUse
  );

  const filtered = rows.filter((r) => {
    const mp = r.master_products;
    if (!mp) return false;
    const masterProduct = Array.isArray(mp) ? mp[0] : mp;
    return masterProduct?.category === categoryName;
  });
  return productRowsToProducts(filtered);
}

export async function searchProducts(
  query: string,
  options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const { lat, lng, radiusKm = 4 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;

  // If no nearby stores found but location was provided, fetch all products
  const rows = await fetchProductRows(
    (lat != null && lng != null && !storeIdsToUse) ? null : storeIdsToUse
  );

  const q = query.trim().toLowerCase();
  const matching = q ? rows.filter((r) => {
    const mp = r.master_products;
    if (!mp) return false;
    const masterProduct = Array.isArray(mp) ? mp[0] : mp;
    return masterProduct?.name?.toLowerCase().includes(q);
  }) : rows;
  return productRowsToProducts(matching);
}

export async function getAllProductsByCategory(options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<Record<string, Product[]>> {
  const { lat, lng, radiusKm = 4 } = options || {};
  const nearbyStoreIds =
    lat != null && lng != null ? await getNearbyStoreIds(lat, lng, radiusKm) : null;
  const storeIdsToUse = nearbyStoreIds?.length ? nearbyStoreIds : null;

  // If no nearby stores found but location was provided, fetch all products
  const rows = await fetchProductRows(
    (lat != null && lng != null && !storeIdsToUse) ? null : storeIdsToUse
  );
  const products = productRowsToProducts(rows);

  // Group products by category
  const productsByCategory: Record<string, Product[]> = {};

  products.forEach(product => {
    const category = product.category || 'Uncategorized';
    if (!productsByCategory[category]) {
      productsByCategory[category] = [];
    }
    productsByCategory[category].push(product);
  });

  return productsByCategory;
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
      avgRating:
        data.avg_rating == null
          ? undefined
          : typeof data.avg_rating === "string"
            ? parseFloat(data.avg_rating)
            : data.avg_rating,
      reviewCount:
        data.review_count == null
          ? undefined
          : typeof data.review_count === "string"
            ? Number(data.review_count)
            : data.review_count,
    };
  } catch {
    return null;
  }
}
