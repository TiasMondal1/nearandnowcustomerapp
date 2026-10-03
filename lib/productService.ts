import AsyncStorage from '@react-native-async-storage/async-storage';

import { getAllCategories, type Category } from './categoryService';
import { getDevFlag } from './devFlags';
import { prefetchImages } from './imageUrl';
import { logSilentFailure } from './logSilentFailure';
import { getAllActiveProductIds } from './storeService';
import { supabase } from './supabase';

// Real schema columns for popularity sorting are `rating` and `rating_count`
// (NOT `avg_rating` / `review_count`).
const MASTER_PRODUCT_FIELDS =
  'id,name,category,base_price,discounted_price,gst_rate,unit,image_url,description,is_loose,is_active,created_at,rating,rating_count';

// Lean field list used by the home catalog load. Excludes the potentially large `description`
// field, which the home screen never renders — slashes payload size & parse time.
const HOME_PRODUCT_FIELDS =
  'id,name,category,base_price,discounted_price,gst_rate,unit,image_url,is_loose,is_active,created_at,rating,rating_count';

/**
 * AsyncStorage key of the slim v2 home catalog envelope
 * `{ version: 2, savedAt, products, categories }`. `productsByCategory` is
 * rebuilt on read (it used to be persisted too — every product twice, C7).
 */
export const HOME_CACHE_KEY = 'nn_home_catalog_v2';
const HOME_CACHE_VERSION = 2;
/** Pre-v2 rows; removed once per session on the first read so they stop occupying AsyncStorage. */
const LEGACY_HOME_CACHE_KEYS = ['nn_home_catalog_v1', 'nn_home_page_v2'];
const HOME_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h; UI re-fetches in background anyway.
/** Disk writes above this many JSON characters are refused — Android's 2 MB CursorWindow makes bigger rows unreadable (MAP §7.12). */
const HOME_CACHE_MAX_CHARS = 1_500_000;
/** Product count of the last refused write; while the catalog is at least this big the stringify is skipped (W3 R1-17). */
let lastRefusedProductCount = Infinity;
let loggedRefusedWrite = false;
/** How recent the cache must be to skip a background refresh entirely. */
export const HOME_CACHE_FRESH_MS = 1000 * 60 * 5; // 5 min

/**
 * Max ids per `.in('id', …)`: ~400 UUIDs hit the 16 KB gateway URL limit and fail silently (MAP §7.11 C6). Every
 * nearby-filtered select below runs one query per ≤ 150-id chunk in parallel, merges, then re-applies the catalog
 * sort + limit client-side (W3 R1-05).
 */
const IN_CHUNK_SIZE = 150;

function chunkIds(ids: Set<string>): string[][] {
  const all = [...ids];
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += IN_CHUNK_SIZE) out.push(all.slice(i, i + IN_CHUNK_SIZE));
  return out;
}

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
  gst_rate?: number | string | null;
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

  // Nearby subset: one query per ≤ 150-id chunk (each returns ≤ 150 rows, so no paging is needed).
  if (nearbyIds) {
    return selectInChunks(
      nearbyIds,
      Number.MAX_SAFE_INTEGER,
      (chunk) => supabase.from('master_products').select(fields).eq('is_active', true).in('id', chunk),
      'Database error',
    );
  }

  const allRows: MasterProductRow[] = [];
  let from = 0;
  // Supabase default row cap per request is 1000. Use the full window to minimize
  // round-trips (fewer network hops = faster cold boot).
  const batchSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const q = supabase
      .from('master_products')
      .select(fields)
      .eq('is_active', true);
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

function parseNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Mirrors the server order used below: rating desc (nulls last), rating_count desc (nulls last), created_at desc. */
function compareCatalogRows(a: MasterProductRow, b: MasterProductRow): number {
  const ar = a.rating == null ? -Infinity : parseNum(a.rating);
  const br = b.rating == null ? -Infinity : parseNum(b.rating);
  if (br !== ar) return br - ar;
  const ac = a.rating_count == null ? -Infinity : parseNum(a.rating_count);
  const bc = b.rating_count == null ? -Infinity : parseNum(b.rating_count);
  if (bc !== ac) return bc - ac;
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

/** Runs `build(chunk)` once per ≤ 150-id chunk in parallel and returns the merged, re-sorted, limited rows. */
async function selectInChunks(
  ids: Set<string>,
  limit: number,
  build: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<MasterProductRow[]> {
  const results = await Promise.all(chunkIds(ids).map((c) => build(c)));
  const rows: MasterProductRow[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`${label}: ${error.message}`);
    if (Array.isArray(data)) rows.push(...(data as MasterProductRow[]));
  }
  rows.sort(compareCatalogRows);
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

function masterRowToProduct(data: MasterProductRow): Product {
  const isLoose = data.is_loose ?? false;
  const gstRate = isLoose ? 0 : parseNum(data.gst_rate);
  const preTax = parseNum(data.discounted_price);
  // Add GST on top of the discounted (pre-tax) price, matching the website.
  const price = preTax + (preTax * gstRate) / 100;
  const preTaxBase = parseNum(data.base_price);
  const originalPrice = preTaxBase > 0
    ? preTaxBase + (preTaxBase * gstRate) / 100
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

/* ───────────── Grouping (the one helper) ───────────── */

const UNCATEGORISED = 'Uncategorized';
const EMPTY_PRODUCTS: Product[] = [];

/** Best-rated first, then most-reviewed, then newest — the home "Top picks" order. */
function comparePopularity(a: Product, b: Product): number {
  const ar = a.avgRating ?? 0;
  const br = b.avgRating ?? 0;
  if (br !== ar) return br - ar;
  const ac = a.reviewCount ?? 0;
  const bc = b.reviewCount ?? 0;
  if (bc !== ac) return bc - ac;
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

/**
 * Pure: groups by `product.category` (empty → 'Uncategorized') and sorts each
 * group by `comparePopularity`. Input is never mutated. Used by
 * `loadMasterCatalog*`, the v2 cache read/write and Home's in-memory nearby view.
 */
export function groupProductsByCategory(products: Product[]): Record<string, Product[]> {
  const byCategory: Record<string, Product[]> = {};
  for (const p of products) {
    const c = p.category || UNCATEGORISED;
    (byCategory[c] ??= []).push(p);
  }
  // Cheap O(n log n) per category — done once per catalog set, never per render.
  for (const key of Object.keys(byCategory)) byCategory[key].sort(comparePopularity);
  return byCategory;
}

type CatalogResult = {
  products: Product[];
  productsByCategory: Record<string, Product[]>;
  categories: Category[];
};

/**
 * Single DB pass for home / categories: active master products grouped by
 * category, plus the (cached) category list. Pass `nearbyIds` (from
 * `getNearbyProductFilter`) to restrict to nearby-store inventory
 * (`undefined` = whole platform, empty Set = nothing).
 * `Dev_Home_inhibit_Catalog` → `{ products: [], productsByCategory: {}, categories }` without a product request.
 */
export async function loadMasterCatalog(options?: {
  nearbyIds?: Set<string>;
}): Promise<CatalogResult> {
  if (getDevFlag('Dev_Home_inhibit_Catalog')) {
    const categories = await getAllCategories();
    return { products: [], productsByCategory: {}, categories };
  }
  // Home catalog does NOT need description text — use the lean field list to shave
  // payload + parse cost noticeably.
  const [rows, categories] = await Promise.all([
    fetchAllMasterProductRows(HOME_PRODUCT_FIELDS, options?.nearbyIds),
    getAllCategories(),
  ]);
  const products = rows.map(masterRowToProduct);
  return { products, productsByCategory: groupProductsByCategory(products), categories };
}

export async function getAllProducts(options?: {
  nearbyIds?: Set<string>;
}): Promise<Product[]> {
  const rows = await fetchAllMasterProductRows(MASTER_PRODUCT_FIELDS, options?.nearbyIds);
  return rows.map(masterRowToProduct);
}

/**
 * Cold-start fast path: the top `limit` (default 500) most-popular in-stock
 * products in a SINGLE round-trip (no pagination). The home screen renders
 * the top few per category, so 500 rows fills every section above the fold;
 * the full catalog is then loaded in the background.
 * `Dev_Home_inhibit_Catalog` → empty products with the category list.
 */
export async function loadMasterCatalogFast(
  limit: number = 500,
  nearbyIds?: Set<string>,
): Promise<CatalogResult> {
  if (getDevFlag('Dev_Home_inhibit_Catalog')) {
    const categories = await getAllCategories();
    return { products: [], productsByCategory: {}, categories };
  }
  // If a nearby filter was requested but no stores are nearby, return nothing.
  if (nearbyIds !== undefined && nearbyIds.size === 0) {
    const categories = await getAllCategories();
    return { products: [], productsByCategory: {}, categories };
  }

  const popular = (ids?: string[]) => {
    let q = supabase
      .from('master_products')
      .select(HOME_PRODUCT_FIELDS)
      .eq('is_active', true);
    if (ids) q = q.in('id', ids);
    return q
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);
  };
  const [rows, categories] = await Promise.all([
    nearbyIds
      ? selectInChunks(nearbyIds, limit, (chunk) => popular(chunk), 'Database error')
      : popular().then(({ data, error }) => {
          if (error) throw new Error(`Database error: ${error.message}`);
          return (data || []) as unknown as MasterProductRow[];
        }),
    getAllCategories(),
  ]);
  const products = rows.map(masterRowToProduct);
  return { products, productsByCategory: groupProductsByCategory(products), categories };
}

/**
 * All in-stock products in a single category (index lookup on
 * `master_products.category`, exact match then `ilike` fallback for casing).
 * Order: best-rated first, falling back to most-recently-added.
 * `.limit(1000)` makes PostgREST's silent cap explicit (rev. 2).
 */
export async function getProductsByCategory(
  categoryName: string,
  options?: { nearbyIds?: Set<string> },
): Promise<Product[]> {
  const trimmed = categoryName.trim();
  if (!trimmed) return [];

  // If a nearby filter is set but empty, no stores are nearby — return nothing.
  if (options?.nearbyIds !== undefined && options.nearbyIds.size === 0) return [];

  const CATEGORY_LIMIT = 1000;
  const buildQuery = (useIlike: boolean, ids?: string[]) => {
    let q = supabase
      .from('master_products')
      .select(HOME_PRODUCT_FIELDS)
      .eq('is_active', true);
    if (ids) q = q.in('id', ids);
    q = useIlike ? q.ilike('category', trimmed) : q.eq('category', trimmed);
    return q
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(CATEGORY_LIMIT);
  };
  const nearbyIds = options?.nearbyIds;
  const run = async (useIlike: boolean): Promise<MasterProductRow[]> => {
    if (nearbyIds) {
      return selectInChunks(nearbyIds, CATEGORY_LIMIT, (chunk) => buildQuery(useIlike, chunk), 'Category fetch error');
    }
    const { data, error } = await buildQuery(useIlike);
    if (error) throw new Error(`Category fetch error: ${error.message}`);
    return (data || []) as unknown as MasterProductRow[];
  };

  const rows = await run(false);
  // If exact match returned nothing, retry with ilike (handles casing mismatch).
  if (rows.length === 0) {
    try {
      const fallback = await run(true);
      return fallback.map(masterRowToProduct);
    } catch {
      return [];
    }
  }
  return rows.map(masterRowToProduct);
}

/**
 * Server-side search: pg_trgm RPC when no nearby filter is given, otherwise
 * `ilike` on `name` / `category` with the IN filter. Up to 50 rows by rating.
 * The `.or()` pattern sanitiser strips `% , . ( )` — all of them are PostgREST
 * filter-grammar characters (C28). `Dev_Search_inhibit_ForceError` throws
 * 'Search is unavailable right now.' so screens can show their error state.
 */
export async function searchProducts(
  query: string,
  options?: { nearbyIds?: Set<string> },
): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];

  if (getDevFlag('Dev_Search_inhibit_ForceError')) {
    throw new Error('Search is unavailable right now.');
  }

  // If a nearby filter is set but empty, no stores are nearby — return nothing.
  if (options?.nearbyIds !== undefined && options.nearbyIds.size === 0) return [];

  const safe = q.replace(/[%,.()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
  if (!safe) return [];
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

  // Fallback / nearby-filtered path: ilike with optional IN filter (chunked — W3 R1-05).
  const SEARCH_LIMIT = 50;
  const ilikeQuery = (ids?: string[]) => {
    let dbq = supabase
      .from('master_products')
      .select(HOME_PRODUCT_FIELDS)
      .eq('is_active', true)
      .or(`name.ilike.${pattern},category.ilike.${pattern}`);
    if (ids) dbq = dbq.in('id', ids);
    return dbq
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .limit(SEARCH_LIMIT);
  };

  if (options?.nearbyIds) {
    const rows = await selectInChunks(options.nearbyIds, SEARCH_LIMIT, (chunk) => ilikeQuery(chunk), 'Search error');
    return rows.map(masterRowToProduct);
  }
  const { data, error } = await ilikeQuery();
  if (error) throw new Error(`Search error: ${error.message}`);
  return (data || []).map((r) => masterRowToProduct(r as MasterProductRow));
}

/* ───────────── Category-name lookups (pre-normalised keys) ───────────── */

/** One lower-cased, trimmed key map per `productsByCategory` object (built on first lookup). */
const normalisedCategoryMaps = new WeakMap<Record<string, Product[]>, Map<string, Product[]>>();

function normalisedCategoryMap(byCategory: Record<string, Product[]>): Map<string, Product[]> {
  let map = normalisedCategoryMaps.get(byCategory);
  if (map) return map;
  map = new Map();
  for (const [key, list] of Object.entries(byCategory)) {
    const norm = key.toLowerCase().trim();
    const existing = map.get(norm);
    if (!existing) {
      map.set(norm, list);
      continue;
    }
    // Two raw keys collapse onto one name ("Dairy" / "dairy"): merge, dedupe by id.
    const merged = existing.slice();
    const seen = new Set(existing.map((p) => p.id));
    for (const p of list) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    map.set(norm, merged);
  }
  normalisedCategoryMaps.set(byCategory, map);
  return map;
}

/**
 * Products grouped under a category NAME, matched case-insensitively against
 * the `master_products.category` keys ("Dairy" vs "dairy"). O(1) after the
 * first call per `byCategory` object. Both argument orders are accepted:
 * `(categoryName, byCategory)` per CONTRACTS §2.15 and the legacy
 * `(byCategory, categoryName)` still used by the pre-W2 screens.
 */
export function getProductsForCategoryName(categoryName: string, byCategory: Record<string, Product[]>): Product[];
export function getProductsForCategoryName(byCategory: Record<string, Product[]>, categoryName: string): Product[];
export function getProductsForCategoryName(
  a: string | Record<string, Product[]>,
  b: string | Record<string, Product[]>,
): Product[] {
  const categoryName = typeof a === 'string' ? a : (b as string);
  const byCategory = typeof a === 'string' ? (b as Record<string, Product[]>) : a;
  if (!byCategory) return EMPTY_PRODUCTS;
  return normalisedCategoryMap(byCategory).get(categoryName.toLowerCase().trim()) ?? EMPTY_PRODUCTS;
}

/**
 * Case-insensitive lookup in a `{ [lowerCategoryKey]: count }` map (the
 * Categories screen derives it from the catalog). Both argument orders are
 * accepted — `(name, counts)` per CONTRACTS §2.15 and the legacy `(counts, name)`.
 */
export function getCountForCategoryName(categoryName: string, counts: Record<string, number>): number;
export function getCountForCategoryName(counts: Record<string, number>, categoryName: string): number;
export function getCountForCategoryName(
  a: string | Record<string, number>,
  b: string | Record<string, number>,
): number {
  const categoryName = typeof a === 'string' ? a : (b as string);
  const counts = typeof a === 'string' ? (b as Record<string, number>) : a;
  if (!counts) return 0;
  return counts[categoryName.toLowerCase().trim()] || 0;
}

/* ───────────── Single product ───────────── */

/**
 * One master product by id, or `null` when it is not carried by any
 * verified + online store / does not exist / the fetch fails.
 * When the product is already in the memory catalog (`getCachedProduct`) the
 * active-ids round trip is skipped and only the row is refreshed; if that
 * refresh fails the cached copy is returned so the PDP still paints.
 */
export async function getProductById(masterProductId: string): Promise<Product | null> {
  const cachedProduct = getCachedProduct(masterProductId);
  try {
    if (!cachedProduct) {
      // The detail screen may be reached with no location context at all
      // (deep link, shared link, stale cached list) — so it can't use
      // `nearbyIds`. Fall back to the location-independent "carried by any
      // approved + online store" filter, matching the is_active/is_approved
      // gate every other product path enforces.
      const activeIds = await getAllActiveProductIds();
      if (!activeIds.has(masterProductId)) return null;
    }

    const { data, error } = await supabase
      .from('master_products')
      .select(MASTER_PRODUCT_FIELDS)
      .eq('id', masterProductId)
      .single();

    if (error || !data) return cachedProduct ?? null;
    return masterRowToProduct(data as MasterProductRow);
  } catch (err) {
    logSilentFailure('Fetch product', err);
    return cachedProduct ?? null;
  }
}

/* ───────────── Home screen SWR cache (v2) ───────────── */

export interface HomeCatalogCache {
  products: Product[];
  productsByCategory: Record<string, Product[]>;
  categories: Category[];
  savedAt: number;
}

/** What actually sits in AsyncStorage under `HOME_CACHE_KEY`. */
interface HomeCatalogEnvelope {
  version: number;
  savedAt: number;
  products: Product[];
  categories: Category[];
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
let legacyKeysRemoved = false;

function removeLegacyHomeCacheRows(): void {
  if (legacyKeysRemoved) return;
  legacyKeysRemoved = true;
  AsyncStorage.multiRemove(LEGACY_HOME_CACHE_KEYS).catch((err) =>
    logSilentFailure('Remove legacy home cache', err),
  );
}

/** Synchronous accessor for the prewarm result. Returns null if prewarm hasn't completed. */
export function getMemoryHomeCache(): HomeCatalogCache | null {
  return memoryHomeCache;
}

/**
 * Reads the v2 envelope, rebuilds `productsByCategory` and seeds the memory
 * cache. Resolves `null` on miss / version mismatch / expiry (24 h) / parse
 * error, when `categories.length === 0` (C8 — an empty chip strip is never a
 * valid cache), and always under `Dev_Cache_inhibit_HomeCatalog`.
 * Concurrent callers share one AsyncStorage read.
 */
export async function readHomeCatalogCache(): Promise<HomeCatalogCache | null> {
  if (getDevFlag('Dev_Cache_inhibit_HomeCatalog')) return null;

  // Hot path — return the prewarmed value without touching AsyncStorage.
  if (memoryHomeCache) return memoryHomeCache;

  // De-duplicate concurrent reads: if the splash-time prewarm is still in flight,
  // the home screen's later call should await the same Promise instead of issuing a
  // second AsyncStorage hit.
  if (memoryReadPromise) return memoryReadPromise;

  memoryReadPromise = (async () => {
    try {
      removeLegacyHomeCacheRows();
      const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<HomeCatalogEnvelope> | null;
      if (!parsed || parsed.version !== HOME_CACHE_VERSION) return null;
      if (!Array.isArray(parsed.products) || !Array.isArray(parsed.categories)) return null;
      if (parsed.categories.length === 0) return null;
      const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
      if (Date.now() - savedAt > HOME_CACHE_TTL_MS) return null;
      const cache: HomeCatalogCache = {
        products: parsed.products,
        productsByCategory: groupProductsByCategory(parsed.products),
        categories: parsed.categories,
        savedAt,
      };
      memoryHomeCache = cache;
      return cache;
    } catch (err) {
      logSilentFailure('Read home cache', err);
      return null;
    } finally {
      memoryReadPromise = null;
    }
  })();

  return memoryReadPromise;
}

/** True if the cache is recent enough (< `HOME_CACHE_FRESH_MS`, 5 min) to skip a background re-fetch. */
export function isHomeCatalogCacheFresh(cache: HomeCatalogCache | null): boolean {
  if (!cache) return false;
  return Date.now() - (cache.savedAt || 0) < HOME_CACHE_FRESH_MS;
}

/**
 * Sets the memory cache synchronously (grouping rebuilt from `products`) and
 * best-effort persists the slim v2 envelope. The disk write is skipped when
 * `categories` is empty (it would read back as a miss) and refused with
 * `logSilentFailure('Home cache too large')` when the JSON exceeds 1.5 M
 * characters. `productsByCategory` is accepted only so pre-W2 callers compile;
 * it is ignored — grouping is always rebuilt so memory and disk agree.
 */
export async function writeHomeCatalogCache(data: {
  products: Product[];
  categories: Category[];
  productsByCategory?: Record<string, Product[]>;
}): Promise<void> {
  const savedAt = Date.now();
  const cache: HomeCatalogCache = {
    products: data.products,
    productsByCategory: groupProductsByCategory(data.products),
    categories: data.categories,
    savedAt,
  };
  // Update memory cache synchronously so subsequent reads see the new data
  // without waiting on AsyncStorage.
  memoryHomeCache = cache;

  if (data.categories.length === 0) {
    logSilentFailure('Home cache skipped', new Error('categories is empty — would read back as a miss'));
    return;
  }

  // Over-cap catalogs: a refused write used to cost a full JSON.stringify on every pull; remember the size instead.
  if (data.products.length >= lastRefusedProductCount) return;

  const envelope: HomeCatalogEnvelope = {
    version: HOME_CACHE_VERSION,
    savedAt,
    products: data.products,
    categories: data.categories,
  };
  let json: string;
  try {
    json = JSON.stringify(envelope);
  } catch (err) {
    logSilentFailure('Home cache serialise', err);
    return;
  }
  if (json.length > HOME_CACHE_MAX_CHARS) {
    lastRefusedProductCount = data.products.length;
    if (!loggedRefusedWrite) {
      loggedRefusedWrite = true;
      logSilentFailure(
        'Home cache too large',
        new Error(`${json.length} chars > ${HOME_CACHE_MAX_CHARS} (${data.products.length} products)`),
      );
    }
    return;
  }
  lastRefusedProductCount = Infinity;
  try {
    await AsyncStorage.setItem(HOME_CACHE_KEY, json);
  } catch (err) {
    logSilentFailure('Write home cache', err);
  }
}

/* ───────────── Derived indexes over the memory catalog ───────────── */
// Each index is (re)built lazily on first use and invalidated by identity:
// a new HomeCatalogCache object (read or write) means a new index.

let productIndexFor: HomeCatalogCache | null = null;
let productIndex: Map<string, Product> | null = null;

/**
 * O(1) lookup of a product in the memory catalog (Map built on the first call
 * per catalog object). `undefined` when the catalog is not loaded or the id is unknown.
 */
export function getCachedProduct(id: string): Product | undefined {
  const cache = memoryHomeCache;
  if (!cache) return undefined;
  if (productIndexFor !== cache || !productIndex) {
    const next = new Map<string, Product>();
    for (const p of cache.products) next.set(p.id, p);
    productIndex = next;
    productIndexFor = cache;
  }
  return productIndex.get(id);
}

let popularFor: HomeCatalogCache | null = null;
let popularOrder: Product[] = EMPTY_PRODUCTS;

/** Most-reviewed first, then best-rated — the home "frequently bought" fallback order. */
function compareByReviews(a: Product, b: Product): number {
  const ac = a.reviewCount ?? 0;
  const bc = b.reviewCount ?? 0;
  if (bc !== ac) return bc - ac;
  return (b.avgRating ?? 0) - (a.avgRating ?? 0);
}

/**
 * The `limit` (default 20) most popular products of the memory catalog —
 * `reviewCount desc, avgRating desc`, computed once per catalog object. `[]`
 * when the catalog is not loaded.
 */
export function getPopularProducts(limit: number = 20): Product[] {
  const cache = memoryHomeCache;
  if (!cache) return EMPTY_PRODUCTS;
  if (popularFor !== cache) {
    popularOrder = cache.products.slice().sort(compareByReviews);
    popularFor = cache;
  }
  return popularOrder.slice(0, Math.max(0, limit));
}

/**
 * Warms the expo-image cache with the first 3 products of the first 3
 * categories that have products, at width 240 (grid thumbnail hint). No-op
 * until `readHomeCatalogCache()` / `writeHomeCatalogCache()` has filled the
 * memory catalog; `prefetchImages` itself honours `Dev_Images_inhibit_Prefetch`.
 */
export function prefetchHomeImages(): void {
  const cache = memoryHomeCache;
  if (!cache) return;
  const urls: (string | undefined)[] = [];
  let categoriesUsed = 0;
  for (const category of cache.categories) {
    if (categoriesUsed >= 3) break;
    const products = getProductsForCategoryName(category.name, cache.productsByCategory);
    if (products.length === 0) continue;
    categoriesUsed += 1;
    for (const p of products.slice(0, 3)) urls.push(p.image_url);
  }
  if (urls.length > 0) prefetchImages(urls, 240);
}
