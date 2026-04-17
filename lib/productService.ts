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

/** Row shape from `master_products` (select *). */
interface MasterProductRow {
  id: string;
  name: string;
  category: string;
  base_price?: number | string | null;
  discounted_price?: number | string | null;
  unit?: string | null;
  image_url?: string | null;
  description?: string | null;
  is_loose?: boolean | null;
  is_active?: boolean | null;
  created_at?: string | null;
  avg_rating?: number | string | null;
  review_count?: number | string | null;
  [key: string]: unknown;
}

async function fetchAllMasterProductRows(): Promise<MasterProductRow[]> {
  const allRows: MasterProductRow[] = [];
  let from = 0;
  const batchSize = 500;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select('*')
      .eq('is_active', true)
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`Database error: ${error.message}`);
    if (data && data.length > 0) {
      allRows.push(...(data as MasterProductRow[]));
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }
  return allRows;
}

function masterRowToProduct(data: MasterProductRow): Product {
  const price =
    data.discounted_price != null
      ? typeof data.discounted_price === 'string'
        ? parseFloat(data.discounted_price)
        : Number(data.discounted_price)
      : 0;
  const originalPrice =
    data.base_price != null
      ? typeof data.base_price === 'string'
        ? parseFloat(data.base_price)
        : Number(data.base_price)
      : undefined;

  const avgRating =
    data.avg_rating == null
      ? undefined
      : typeof data.avg_rating === 'string'
        ? parseFloat(data.avg_rating)
        : data.avg_rating;

  const reviewCount =
    data.review_count == null
      ? undefined
      : typeof data.review_count === 'string'
        ? Number(data.review_count)
        : data.review_count;

  return {
    id: data.id,
    name: data.name,
    category: data.category,
    price,
    original_price: originalPrice,
    image_url: data.image_url ?? undefined,
    description: data.description ?? undefined,
    in_stock: data.is_active !== false,
    unit: data.unit ?? 'piece',
    isLoose: data.is_loose ?? false,
    created_at: data.created_at ?? undefined,
    avgRating: Number.isFinite(avgRating as number) ? (avgRating as number) : undefined,
    reviewCount: Number.isFinite(reviewCount as number) ? (reviewCount as number) : undefined,
  };
}

/**
 * Single DB pass for home / categories: all active master products + group by category string.
 * Options kept for API compatibility; catalog is no longer filtered by store location.
 */
export async function loadMasterCatalog(_options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<{ products: Product[]; productsByCategory: Record<string, Product[]> }> {
  const rows = await fetchAllMasterProductRows();
  const products = rows.map(masterRowToProduct);
  const productsByCategory: Record<string, Product[]> = {};
  for (const p of products) {
    const c = p.category || 'Uncategorized';
    if (!productsByCategory[c]) productsByCategory[c] = [];
    productsByCategory[c].push(p);
  }
  return { products, productsByCategory };
}

export async function getAllProducts(_options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<Product[]> {
  const rows = await fetchAllMasterProductRows();
  return rows.map(masterRowToProduct);
}

export async function getProductsByCategory(
  categoryName: string,
  _options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const want = categoryName.toLowerCase().trim();
  const rows = await fetchAllMasterProductRows();
  const filtered = rows.filter(
    (r) => r.category != null && r.category.toLowerCase().trim() === want,
  );
  return filtered.map(masterRowToProduct);
}

export async function searchProducts(
  query: string,
  _options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const rows = await fetchAllMasterProductRows();
  const q = query.trim().toLowerCase();
  const matching = q
    ? rows.filter((r) => r.name?.toLowerCase().includes(q))
    : rows;
  return matching.map(masterRowToProduct);
}

export async function getAllProductsByCategory(_options?: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<Record<string, Product[]>> {
  const { productsByCategory } = await loadMasterCatalog(_options);
  return productsByCategory;
}

/**
 * Looks up grouped products by `master_products.category`, matching category rows by name
 * with case-insensitive comparison (handles "Dairy" vs "dairy").
 */
export function getProductsForCategoryName(
  productsByCategory: Record<string, Product[]>,
  categoryName: string,
): Product[] {
  const t = categoryName.toLowerCase().trim();
  const out: Product[] = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(productsByCategory)) {
    if (k.toLowerCase().trim() !== t) continue;
    for (const p of v) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
  }
  return out;
}

export async function getProductById(masterProductId: string): Promise<Product | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select('*')
      .eq('id', masterProductId)
      .single();

    if (error || !data) return null;
    return masterRowToProduct(data as MasterProductRow);
  } catch {
    return null;
  }
}
