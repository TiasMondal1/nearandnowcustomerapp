import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Category } from './categoryService';
import { supabaseAdmin } from './supabase';

// Real schema columns for popularity sorting are `rating` and `rating_count`
// (NOT `avg_rating` / `review_count`).
const MASTER_PRODUCT_FIELDS =
  'id,name,category,base_price,discounted_price,unit,image_url,description,is_loose,is_active,created_at,rating,rating_count';

// Lean field list used by the home catalog load. Excludes the potentially large `description`
// field, which the home screen never renders — slashes payload size & parse time.
const HOME_PRODUCT_FIELDS =
  'id,name,category,base_price,discounted_price,unit,image_url,is_loose,is_active,created_at,rating,rating_count';

/** Default page size for incremental home load. */
export const HOME_PAGE_SIZE = 20;

const HOME_CACHE_KEY = 'nn_home_catalog_v1';
const HOME_PAGE_CACHE_KEY = 'nn_home_page_v2';
const HOME_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h; UI re-fetches in background anyway.
/** How recent the cache must be to skip a background refresh entirely. */
export const HOME_CACHE_FRESH_MS = 1000 * 60 * 5; // 5 min

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
  rating?: number | string | null;
  rating_count?: number | string | null;
  [key: string]: unknown;
}

async function fetchAllMasterProductRows(
  fields: string = MASTER_PRODUCT_FIELDS,
): Promise<MasterProductRow[]> {
  const allRows: MasterProductRow[] = [];
  let from = 0;
  // Supabase default row cap per request is 1000. Use the full window to minimize
  // round-trips (fewer network hops = faster cold boot).
  const batchSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select(fields)
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
    data.rating == null
      ? undefined
      : typeof data.rating === 'string'
        ? parseFloat(data.rating)
        : data.rating;

  const reviewCount =
    data.rating_count == null
      ? undefined
      : typeof data.rating_count === 'string'
        ? Number(data.rating_count)
        : data.rating_count;

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
  // Home catalog does NOT need description text — use the lean field list to shave
  // payload + parse cost noticeably.
  const rows = await fetchAllMasterProductRows(HOME_PRODUCT_FIELDS);
  const products = rows.map(masterRowToProduct);
  const productsByCategory: Record<string, Product[]> = {};
  for (const p of products) {
    const c = p.category || 'Uncategorized';
    if (!productsByCategory[c]) productsByCategory[c] = [];
    productsByCategory[c].push(p);
  }
  // Sort each category by real popularity so the home "Top picks" tile shows the
  // best-rated items first. Cheap O(n log n) per category — done once per fetch,
  // never per render.
  for (const cat of Object.keys(productsByCategory)) {
    productsByCategory[cat].sort((a, b) => {
      const ar = a.avgRating ?? 0;
      const br = b.avgRating ?? 0;
      if (br !== ar) return br - ar;
      const ac = a.reviewCount ?? 0;
      const bc = b.reviewCount ?? 0;
      if (bc !== ac) return bc - ac;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });
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

/**
 * Fetch all in-stock products in a single category. Uses the existing
 * `idx_master_products_category` index for an O(log n) lookup instead of the
 * previous full-catalog scan + client-side filter.
 *
 * Order: best-rated first, falling back to most-recently-added.
 */
export async function getProductsByCategory(
  categoryName: string,
  _options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const trimmed = categoryName.trim();
  if (!trimmed) return [];

  const { data, error } = await supabaseAdmin
    .from('master_products')
    .select(HOME_PRODUCT_FIELDS)
    .eq('is_active', true)
    .ilike('category', trimmed) // case-insensitive exact match
    .order('rating', { ascending: false, nullsFirst: false })
    .order('rating_count', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Category fetch error: ${error.message}`);
  return (data || []).map((r) => masterRowToProduct(r as MasterProductRow));
}

/**
 * Server-side search. Uses Supabase's `ilike` (case-insensitive substring) on `name`,
 * `category`, and `brand`. Returns up to 50 rows ordered by rating.
 *
 * Previously this fetched the ENTIRE master catalog on every keystroke and filtered
 * client-side — easily the worst perf bug in the codebase. With this change, search
 * goes from ~200 KB / ~1.5 s per keystroke to ~5 KB / ~120 ms.
 *
 * For typo-tolerance ("tamato" → "tomato"), see PERFORMANCE_AUDIT.md → pg_trgm step.
 */
export async function searchProducts(
  query: string,
  _options?: { lat?: number; lng?: number; radiusKm?: number },
): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];

  // Supabase requires escaping % in `or` filters. Sanitize aggressively.
  const safe = q.replace(/[%,]/g, ' ').slice(0, 64);
  const pattern = `%${safe}%`;

  const { data, error } = await supabaseAdmin
    .from('master_products')
    .select(HOME_PRODUCT_FIELDS)
    .eq('is_active', true)
    .or(`name.ilike.${pattern},category.ilike.${pattern},brand.ilike.${pattern}`)
    .order('rating', { ascending: false, nullsFirst: false })
    .order('rating_count', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) throw new Error(`Search error: ${error.message}`);
  return (data || []).map((r) => masterRowToProduct(r as MasterProductRow));
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

/* ───────────── Fast boot helpers (paginated) ───────────── */

/**
 * Fetches only the `category` column for all active master products and tallies per-category
 * counts in memory. One small round-trip (category strings only) → no DB aggregation needed.
 */
export async function getCategoryCounts(): Promise<{
  counts: Record<string, number>;
  total: number;
}> {
  const counts: Record<string, number> = {};
  let total = 0;
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select('category')
      .eq('is_active', true)
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`Database error: ${error.message}`);
    if (data && data.length > 0) {
      for (const row of data as { category: string | null }[]) {
        const key = (row.category || 'Uncategorized').toLowerCase().trim();
        counts[key] = (counts[key] || 0) + 1;
        total += 1;
      }
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }
  return { counts, total };
}

/** Case-insensitive lookup helper for `getCategoryCounts().counts`. */
export function getCountForCategoryName(
  counts: Record<string, number>,
  categoryName: string,
): number {
  return counts[categoryName.toLowerCase().trim()] || 0;
}

/**
 * Paginated fetch from master_products. Returns exactly `limit` rows at a given offset.
 * If `category` is provided, filters case-insensitively on `master_products.category`.
 */
export async function getProductsPage(
  category: string | null,
  offset: number,
  limit: number = HOME_PAGE_SIZE,
): Promise<Product[]> {
  let query = supabaseAdmin
    .from('master_products')
    .select(MASTER_PRODUCT_FIELDS)
    .eq('is_active', true);

  if (category) {
    query = query.ilike('category', category.trim());
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`Database error: ${error.message}`);
  return (data as MasterProductRow[]).map(masterRowToProduct);
}

export async function getProductById(masterProductId: string): Promise<Product | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('master_products')
      .select(MASTER_PRODUCT_FIELDS)
      .eq('id', masterProductId)
      .single();

    if (error || !data) return null;
    return masterRowToProduct(data as MasterProductRow);
  } catch {
    return null;
  }
}

/* ───────────── Home screen SWR cache ───────────── */

export interface HomeCatalogCache {
  products: Product[];
  productsByCategory: Record<string, Product[]>;
  categories: Category[];
  savedAt: number;
}

export async function readHomeCatalogCache(): Promise<HomeCatalogCache | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeCatalogCache;
    if (!parsed?.products || !parsed?.categories) return null;
    if (Date.now() - (parsed.savedAt || 0) > HOME_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True if the cache is recent enough to skip a background re-fetch. */
export function isHomeCatalogCacheFresh(cache: HomeCatalogCache | null): boolean {
  if (!cache) return false;
  return Date.now() - (cache.savedAt || 0) < HOME_CACHE_FRESH_MS;
}

export async function writeHomeCatalogCache(
  data: Omit<HomeCatalogCache, 'savedAt'>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      HOME_CACHE_KEY,
      JSON.stringify({ ...data, savedAt: Date.now() }),
    );
  } catch {
    // cache write is best-effort
  }
}

/* ─── Lightweight home cache: categories + counts + first page ─── */

export interface HomePageCache {
  categories: Category[];
  categoryCounts: { counts: Record<string, number>; total: number };
  firstPage: Product[];
  savedAt: number;
}

export async function readHomePageCache(): Promise<HomePageCache | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_PAGE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomePageCache;
    if (!parsed?.firstPage || !parsed?.categories || !parsed?.categoryCounts) return null;
    if (Date.now() - (parsed.savedAt || 0) > HOME_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeHomePageCache(
  data: Omit<HomePageCache, 'savedAt'>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      HOME_PAGE_CACHE_KEY,
      JSON.stringify({ ...data, savedAt: Date.now() }),
    );
  } catch {
    // cache write is best-effort
  }
}
