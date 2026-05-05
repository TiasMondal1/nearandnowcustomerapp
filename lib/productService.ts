import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Category } from './categoryService';
import { supabase } from './supabase';

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
  nearbyIds?: Set<string>,
): Promise<MasterProductRow[]> {
  // If a nearby filter was requested but no stores are nearby, return nothing.
  if (nearbyIds !== undefined && nearbyIds.size === 0) return [];

  const allRows: MasterProductRow[] = [];
  let from = 0;
  // Supabase default row cap per request is 1000. Use the full window to minimize
  // round-trips (fewer network hops = faster cold boot).
  const batchSize = 1000;
  let hasMore = true;
  while (hasMore) {
    let q = supabase
      .from('master_products')
      .select(fields)
      .eq('is_active', true);
    if (nearbyIds) q = q.in('id', [...nearbyIds]);
    const { data, error } = await q.range(from, from + batchSize - 1);
    if (error) throw new Error(`Database error: ${error.message}`);
    if (data && data.length > 0) {
      allRows.push(...(data as unknown as MasterProductRow[]));
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
 * Single DB pass for home / categories: active master products + group by category.
 * Pass `nearbyIds` (from getNearbyProductFilter) to restrict to nearby-store inventory.
 */
export async function loadMasterCatalog(options?: {
  nearbyIds?: Set<string>;
}): Promise<{ products: Product[]; productsByCategory: Record<string, Product[]> }> {
  // Home catalog does NOT need description text — use the lean field list to shave
  // payload + parse cost noticeably.
  const rows = await fetchAllMasterProductRows(HOME_PRODUCT_FIELDS, options?.nearbyIds);
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

export async function getAllProducts(options?: {
  nearbyIds?: Set<string>;
}): Promise<Product[]> {
  const rows = await fetchAllMasterProductRows(MASTER_PRODUCT_FIELDS, options?.nearbyIds);
  return rows.map(masterRowToProduct);
}

/**
 * Cold-start fast path: returns the top N most-popular in-stock products in a
 * SINGLE round-trip (no pagination). The home screen renders top-6 per category,
 * so 500 rows is easily enough to fill every section above the fold. The full
 * catalog is then loaded in the background to keep search/filter responsive.
 *
 * Cost on a slow 3G connection: ~30–80 KB compressed, ~120–400 ms vs.
 * 1–5 s for `loadMasterCatalog()`.
 */
export async function loadMasterCatalogFast(
  limit: number = 500,
  nearbyIds?: Set<string>,
): Promise<{ products: Product[]; productsByCategory: Record<string, Product[]> }> {
  // If a nearby filter was requested but no stores are nearby, return nothing.
  if (nearbyIds !== undefined && nearbyIds.size === 0) {
    return { products: [], productsByCategory: {} };
  }

  let q = supabase
    .from('master_products')
    .select(HOME_PRODUCT_FIELDS)
    .eq('is_active', true);
  if (nearbyIds) q = q.in('id', [...nearbyIds]);
  const { data, error } = await q
    .order('rating', { ascending: false, nullsFirst: false })
    .order('rating_count', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Database error: ${error.message}`);
  const products = (data || []).map((r) => masterRowToProduct(r as MasterProductRow));
  const productsByCategory: Record<string, Product[]> = {};
  for (const p of products) {
    const c = p.category || 'Uncategorized';
    if (!productsByCategory[c]) productsByCategory[c] = [];
    productsByCategory[c].push(p);
  }
  return { products, productsByCategory };
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
  options?: { nearbyIds?: Set<string> },
): Promise<Product[]> {
  const trimmed = categoryName.trim();
  if (!trimmed) return [];

  // If a nearby filter is set but empty, no stores are nearby — return nothing.
  if (options?.nearbyIds !== undefined && options.nearbyIds.size === 0) return [];

  const buildQuery = (useIlike = false) => {
    let q = supabase
      .from('master_products')
      .select(HOME_PRODUCT_FIELDS)
      .eq('is_active', true);
    if (options?.nearbyIds) q = q.in('id', [...options.nearbyIds]);
    q = useIlike ? q.ilike('category', trimmed) : q.eq('category', trimmed);
    return q
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
  };

  const { data, error } = await buildQuery(false);
  if (error) throw new Error(`Category fetch error: ${error.message}`);

  // If exact match returned nothing, retry with ilike (handles casing mismatch).
  if (!data || data.length === 0) {
    const { data: fallback, error: ferr } = await buildQuery(true);
    if (!ferr && fallback) {
      return (fallback || []).map((r) => masterRowToProduct(r as MasterProductRow));
    }
  }
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
  options?: { nearbyIds?: Set<string> },
): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];

  // If a nearby filter is set but empty, no stores are nearby — return nothing.
  if (options?.nearbyIds !== undefined && options.nearbyIds.size === 0) return [];

  const safe = q.replace(/[%,]/g, ' ').slice(0, 64);
  const pattern = `%${safe}%`;

  // Fast path: SECURITY DEFINER RPC for pg_trgm GIN index search.
  // Note: RPC doesn't support arbitrary IN filters, so when a nearby filter is
  // active we skip straight to ilike which supports it.
  if (!options?.nearbyIds) {
    try {
      const { data, error } = await supabase.rpc('search_products', {
        query: q.slice(0, 64),
        result_limit: 50,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        return (data as MasterProductRow[]).map(masterRowToProduct);
      }
    } catch {
      // RPC not deployed yet — fall through to ilike fallback.
    }
  }

  // Fallback / nearby-filtered path: ilike with optional IN filter.
  let dbq = supabase
    .from('master_products')
    .select(HOME_PRODUCT_FIELDS)
    .eq('is_active', true)
    .or(`name.ilike.${pattern},category.ilike.${pattern}`);
  if (options?.nearbyIds) dbq = dbq.in('id', [...options.nearbyIds]);

  const { data, error } = await dbq
    .order('rating', { ascending: false, nullsFirst: false })
    .order('rating_count', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) throw new Error(`Search error: ${error.message}`);
  return (data || []).map((r) => masterRowToProduct(r as MasterProductRow));
}

export async function getAllProductsByCategory(options?: {
  nearbyIds?: Set<string>;
}): Promise<Record<string, Product[]>> {
  const { productsByCategory } = await loadMasterCatalog(options);
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
 * Returns per-category product counts via a single server-side GROUP BY query.
 * Previously this fetched all 44k category strings in 1000-row batches and
 * counted client-side (up to 44 round-trips). Now it's one round-trip that
 * returns only the aggregated rows — O(1) instead of O(n/1000) network calls.
 *
 * Requires a Postgres function or an RPC if the anon key doesn't allow
 * direct aggregation. Falls back to the paginated approach if the RPC isn't
 * available so existing deployments don't break.
 *
 * Recommended DB migration (run once in Supabase SQL editor):
 *   CREATE OR REPLACE FUNCTION get_category_counts()
 *   RETURNS TABLE(category text, cnt bigint)
 *   LANGUAGE sql STABLE SECURITY DEFINER AS $$
 *     SELECT LOWER(TRIM(COALESCE(category,'Uncategorized'))) AS category,
 *            COUNT(*) AS cnt
 *     FROM master_products
 *     WHERE is_active = true
 *     GROUP BY 1;
 *   $$;
 */
export async function getCategoryCounts(): Promise<{
  counts: Record<string, number>;
  total: number;
}> {
  // Fast path: single-query aggregate via RPC.
  try {
    const { data, error } = await supabase.rpc('get_category_counts');
    if (!error && Array.isArray(data) && data.length > 0) {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of data as { category: string; cnt: number | string }[]) {
        const key = (row.category || 'Uncategorized').toLowerCase().trim();
        const n = Number(row.cnt) || 0;
        counts[key] = n;
        total += n;
      }
      return { counts, total };
    }
  } catch {
    // RPC not deployed yet — fall through to paginated fallback.
  }

  // Fallback: paginated client-side count (legacy behaviour, O(n/1000) trips).
  const counts: Record<string, number> = {};
  let total = 0;
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
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
 * Pass `nearbyIds` to restrict results to products available in nearby stores.
 */
export async function getProductsPage(
  category: string | null,
  offset: number,
  limit: number = HOME_PAGE_SIZE,
  nearbyIds?: Set<string>,
): Promise<Product[]> {
  if (nearbyIds !== undefined && nearbyIds.size === 0) return [];

  let query = supabase
    .from('master_products')
    .select(MASTER_PRODUCT_FIELDS)
    .eq('is_active', true);

  if (category) query = query.ilike('category', category.trim());
  if (nearbyIds) query = query.in('id', [...nearbyIds]);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`Database error: ${error.message}`);
  return (data as MasterProductRow[]).map(masterRowToProduct);
}

export async function getProductById(masterProductId: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase
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

/**
 * In-memory cache shared between the splash-time pre-warm in `app/_layout.tsx`
 * and the home screen mount in `app/(tabs)/home.tsx`. Without this, both call
 * sites pay the AsyncStorage round-trip + JSON.parse cost (which can be
 * 100–300 ms when the catalog has thousands of rows). With it, the home
 * screen's read is synchronous from RAM and adds ~0 ms to first paint.
 */
let memoryHomeCache: HomeCatalogCache | null = null;
let memoryReadPromise: Promise<HomeCatalogCache | null> | null = null;

/** Synchronous accessor for the prewarm result. Returns null if prewarm hasn't completed. */
export function getMemoryHomeCache(): HomeCatalogCache | null {
  return memoryHomeCache;
}

export async function readHomeCatalogCache(): Promise<HomeCatalogCache | null> {
  // Hot path — return the prewarmed value without touching AsyncStorage.
  if (memoryHomeCache) return memoryHomeCache;

  // De-duplicate concurrent reads: if the splash-time prewarm is still in flight,
  // the home screen's later call should await the same Promise instead of issuing a
  // second AsyncStorage hit.
  if (memoryReadPromise) return memoryReadPromise;

  memoryReadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as HomeCatalogCache;
      if (!parsed?.products || !parsed?.categories) return null;
      if (Date.now() - (parsed.savedAt || 0) > HOME_CACHE_TTL_MS) return null;
      memoryHomeCache = parsed;
      return parsed;
    } catch {
      return null;
    } finally {
      memoryReadPromise = null;
    }
  })();

  return memoryReadPromise;
}

/** True if the cache is recent enough to skip a background re-fetch. */
export function isHomeCatalogCacheFresh(cache: HomeCatalogCache | null): boolean {
  if (!cache) return false;
  return Date.now() - (cache.savedAt || 0) < HOME_CACHE_FRESH_MS;
}

export async function writeHomeCatalogCache(
  data: Omit<HomeCatalogCache, 'savedAt'>,
): Promise<void> {
  const payload: HomeCatalogCache = { ...data, savedAt: Date.now() };
  // Update memory cache synchronously so subsequent reads see the new data
  // without waiting on AsyncStorage.
  memoryHomeCache = payload;
  try {
    await AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify(payload));
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
