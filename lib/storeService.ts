import { setEtaSource } from './deliveryEta';
import { getDevFlag } from './devFlags';
import { calculateDistance } from './distanceUtils';
import { logSilentFailure } from './logSilentFailure';
import { cached, invalidate, peek, QC_KEYS, seedFromDisk } from './queryCache';
import { supabase } from './supabase';

export interface NearbyStore {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

export const NEARBY_RADIUS_KM = 4;

/**
 * Result of `getNearbyProductFilter()`.
 * - `storeIds`: verified + online stores inside the radius (`[]` = none nearby)
 * - `productIds`: master product ids those stores stock. Same `Set` instance
 *   for the same cached payload, so screens can use it as a stable dependency.
 * - `nearestKm` / `nearestStoreName`: nearest store (feeds the delivery ETA); null when no stores.
 */
export type NearbyFilter = {
  storeIds: string[];
  productIds: Set<string>;
  nearestKm: number | null;
  nearestStoreName: string | null;
};

/** `${lat.toFixed(3)},${lng.toFixed(3)}` (~110 m grid) — the location key shared by the nearby cache and the ETA source. */
export function nearbyKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// ─── Stores ────────────────────────────────────────────────────────────────

type StoreRow = { id: string; name: string; latitude: number | null; longitude: number | null };

/**
 * Throwing variant used inside `cached()` fetchers: a Supabase error must
 * propagate so nothing is cached (C5 class). The `stores` table is small, so
 * one `.limit(1000)` page is the whole table (MAP §2.6 #25).
 */
async function fetchNearbyStoresOrThrow(lat: number, lng: number, radiusKm: number): Promise<NearbyStore[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, latitude, longitude')
    .eq('is_active', true)
    .eq('is_approved', true)
    .limit(1000);

  if (error) throw new Error(`Database error: ${error.message}`);

  return ((data ?? []) as StoreRow[])
    .filter((s): s is StoreRow & { latitude: number; longitude: number } => s.latitude != null && s.longitude != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      distanceKm: calculateDistance(lat, lng, s.latitude, s.longitude),
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Fetches verified + online stores, filters to those within `radiusKm`
 * (default 4) of the customer, sorted nearest first. Resolves `[]` on error
 * (unchanged public behaviour); the cached nearby filter uses the throwing
 * variant internally so a failure is never memoised.
 *
 * `is_approved` = admin-verified shopkeeper; `is_active` = shop is online.
 */
export async function getNearbyActiveStores(
  lat: number,
  lng: number,
  radiusKm = NEARBY_RADIUS_KM,
): Promise<NearbyStore[]> {
  try {
    return await fetchNearbyStoresOrThrow(lat, lng, radiusKm);
  } catch (err) {
    logSilentFailure('Fetch nearby stores', err);
    return [];
  }
}

// ─── Store inventory → master product ids ──────────────────────────────────

const PRODUCTS_PAGE_SIZE = 1000;
/** Max ids per `.in()` — ~400 UUIDs hit the 16 KB gateway URL limit (MAP §7.11 C6); 150 leaves headroom for the rest of the query. */
const IN_CHUNK_SIZE = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One store-id batch (≤ IN_CHUNK_SIZE), paged past the 1000-row cap. Throws on a Supabase error. */
async function fetchProductIdsForStoreBatch(storeIds: string[], into: Set<string>): Promise<void> {
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('master_product_id')
      .in('store_id', storeIds)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + PRODUCTS_PAGE_SIZE - 1);

    if (error) throw new Error(`Database error: ${error.message}`);

    const rows = (data ?? []) as { master_product_id: string | null }[];
    for (const row of rows) {
      if (row.master_product_id) into.add(row.master_product_id);
    }
    if (rows.length < PRODUCTS_PAGE_SIZE) break;
    from += PRODUCTS_PAGE_SIZE;
  }
}

/**
 * Master product ids actively stocked in the given stores.
 * Pages with `.range(from, from + 999)` until a page comes back short, so
 * inventories above PostgREST's silent 1000-row cap are complete (C4).
 * Ordered by `id` so offset paging is stable while rows change underneath.
 * THROWS on a Supabase error — never returns an empty Set for a failure (C5).
 * `storeIds.length === 0` → empty Set (not an error).
 */
export async function getMasterProductIdsForStores(storeIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!storeIds.length) return ids;
  // Store ids go out in ≤ 150-id batches (URL length, W3 R1-05); the Set merge dedupes across batches.
  await Promise.all(chunk(storeIds, IN_CHUNK_SIZE).map((batch) => fetchProductIdsForStoreBatch(batch, ids)));
  return ids;
}

async function fetchAllActiveProductIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('stores')
    .select('id')
    .eq('is_active', true)
    .eq('is_approved', true)
    .limit(1000);
  if (error) throw new Error(`Database error: ${error.message}`);
  const storeIds = ((data ?? []) as { id: string }[]).map((s) => s.id);
  return getMasterProductIdsForStores(storeIds);
}

/**
 * Master product ids listed in ANY verified + online store, regardless of
 * location. Base filter so a master product no eligible store carries is
 * never shown. `cached(QC_KEYS.activeProductIds, 10 min)`; the fetcher throws
 * on error so a failure is never cached — the catch resolves the last known
 * value (`peek`) or an empty Set that is NOT stored (C5).
 * `Dev_Location_inhibit_NearbyFilter` / `Dev_Home_inhibit_NoStoresNearby` do not apply here.
 */
export async function getAllActiveProductIds(): Promise<Set<string>> {
  try {
    return await cached<Set<string>>(QC_KEYS.activeProductIds, fetchAllActiveProductIds, { ttlMs: 600_000 });
  } catch (err) {
    logSilentFailure('Fetch active product ids', err);
    return peek<Set<string>>(QC_KEYS.activeProductIds) ?? new Set<string>();
  }
}

// ─── Nearby filter (cached per location key) ───────────────────────────────

/** JSON-safe persisted shape (`productIds` is an array on disk; the Set is memoised per payload object). */
type NearbyPayload = {
  locationKey: string;
  storeIds: string[];
  productIds: string[];
  nearestKm: number | null;
  nearestStoreName: string | null;
};

const NEARBY_TTL_MS = 300_000;
const NEARBY_PERSIST = { key: 'nn:qc:nearby', version: 1, maxAgeMs: 86_400_000 } as const;
const DEV_ALL_STORES_NAME = 'All stores (dev)';

/** One `NearbyFilter` (and therefore one `Set`) per payload object → stable identity across calls. */
const filterByPayload = new WeakMap<NearbyPayload, NearbyFilter>();

function toFilter(payload: NearbyPayload): NearbyFilter {
  let filter = filterByPayload.get(payload);
  if (!filter) {
    filter = {
      storeIds: payload.storeIds,
      productIds: new Set(payload.productIds),
      nearestKm: payload.nearestKm,
      nearestStoreName: payload.nearestStoreName,
    };
    filterByPayload.set(payload, filter);
  }
  return filter;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cacheKeyFor(lat: number, lng: number, radiusKm: number): string {
  const base = QC_KEYS.nearby(lat, lng);
  // Callers all use the default radius; a custom one gets its own entry so
  // it can never be served another radius's id list.
  return radiusKm === NEARBY_RADIUS_KM ? base : `${base}:r${radiusKm}`;
}

async function fetchNearbyPayload(lat: number, lng: number, radiusKm: number): Promise<NearbyPayload> {
  const stores = await fetchNearbyStoresOrThrow(lat, lng, radiusKm);
  const storeIds = stores.map((s) => s.id);
  const productIds = await getMasterProductIdsForStores(storeIds);
  const nearest = stores[0];
  return {
    locationKey: nearbyKey(lat, lng),
    storeIds,
    productIds: Array.from(productIds),
    nearestKm: nearest ? round2(nearest.distanceKm) : null,
    nearestStoreName: nearest ? nearest.name : null,
  };
}

function publishEta(locationKey: string, filter: NearbyFilter): void {
  setEtaSource({
    locationKey,
    nearestKm: filter.nearestKm,
    nearestStoreName: filter.nearestStoreName,
    storeCount: filter.storeIds.length,
  });
}

/** One frozen "no stores nearby" filter — a stable identity for consumers keyed on `productIds` (W3 R1-20). */
const EMPTY_FILTER: NearbyFilter = Object.freeze({
  storeIds: [],
  productIds: new Set<string>(),
  nearestKm: null,
  nearestStoreName: null,
});

function emptyFilter(): NearbyFilter {
  return EMPTY_FILTER;
}

/** `Dev_Location_inhibit_NearbyFilter` filter, memoised per active-id Set so repeated calls return one object. */
const devFilterByIds = new WeakMap<Set<string>, NearbyFilter>();

function devAllStoresFilter(productIds: Set<string>): NearbyFilter {
  let filter = devFilterByIds.get(productIds);
  if (!filter) {
    filter = { storeIds: ['*'], productIds, nearestKm: 1, nearestStoreName: DEV_ALL_STORES_NAME };
    devFilterByIds.set(productIds, filter);
  }
  return filter;
}

/**
 * Which stores are nearby and which master products they carry — the one
 * call every browse surface makes per location change.
 *
 * - `null` for non-finite coordinates (invariant kept)
 * - `{ storeIds: [], productIds: new Set(), nearestKm: null, nearestStoreName: null }` when no stores are nearby
 * - otherwise `cached(QC_KEYS.nearby(lat, lng), 5 min, persist 'nn:qc:nearby' v1, maxAge 24 h)`;
 *   two calls for the same `lat.toFixed(3),lng.toFixed(3)` share one round trip and one `Set` instance
 * - after EVERY resolve (hit or miss) `setEtaSource()` is called so the delivery ETA updates
 * - `Dev_Home_inhibit_NoStoresNearby` → the empty filter (ETA 'closed'), no network
 * - `Dev_Location_inhibit_NearbyFilter` → `{ storeIds: ['*'], productIds: <all active ids>, nearestKm: 1, nearestStoreName: 'All stores (dev)' }`
 *   so callers see a non-empty Set and the platform-wide catalog (dev only)
 *
 * The persisted payload carries its `locationKey`; a disk seed for a
 * different location (single persist key) is never served — it is refetched
 * with `force` for the requested key.
 */
export async function getNearbyProductFilter(
  lat: number,
  lng: number,
  radiusKm = NEARBY_RADIUS_KM,
): Promise<NearbyFilter | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const locationKey = nearbyKey(lat, lng);

  if (getDevFlag('Dev_Home_inhibit_NoStoresNearby')) {
    const filter = emptyFilter();
    publishEta(locationKey, filter);
    return filter;
  }

  if (getDevFlag('Dev_Location_inhibit_NearbyFilter')) {
    const filter = devAllStoresFilter(await getAllActiveProductIds());
    publishEta(locationKey, filter);
    return filter;
  }

  const key = cacheKeyFor(lat, lng, radiusKm);
  const fetcher = () => fetchNearbyPayload(lat, lng, radiusKm);
  let payload = await cached<NearbyPayload>(key, fetcher, { ttlMs: NEARBY_TTL_MS, persist: NEARBY_PERSIST });
  if (payload.locationKey !== locationKey) {
    payload = await cached<NearbyPayload>(key, fetcher, { ttlMs: NEARBY_TTL_MS, persist: NEARBY_PERSIST, force: true });
  }

  const filter = toFilter(payload);
  publishEta(locationKey, filter);
  return filter;
}

/**
 * Synchronous memory read of the nearby filter for first paint (may be stale
 * beyond the TTL). Same `Set` instance `getNearbyProductFilter()` resolved.
 * Honours the two dev flags the async path honours. `undefined` when nothing
 * is cached for that key.
 */
export function peekNearbyProductFilter(lat: number, lng: number): NearbyFilter | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (getDevFlag('Dev_Home_inhibit_NoStoresNearby')) return emptyFilter();
  if (getDevFlag('Dev_Location_inhibit_NearbyFilter')) {
    const productIds = peek<Set<string>>(QC_KEYS.activeProductIds);
    return productIds ? devAllStoresFilter(productIds) : undefined;
  }
  const payload = peek<NearbyPayload>(QC_KEYS.nearby(lat, lng));
  if (!payload || payload.locationKey !== nearbyKey(lat, lng)) return undefined;
  return toFilter(payload);
}

/**
 * Loads the persisted `nn:qc:nearby` row into memory for `lat,lng` (TTL 0, so the first `getNearbyProductFilter()`
 * still revalidates while `peekNearbyProductFilter()` paints Home on frame 1). The single persist row carries its
 * own `locationKey`; a row for another location is dropped again so it can never be served. Never rejects.
 */
export async function seedNearbyFromDisk(lat: number, lng: number): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const key = QC_KEYS.nearby(lat, lng);
  const payload = await seedFromDisk<NearbyPayload>(key, NEARBY_PERSIST);
  if (payload && payload.locationKey !== nearbyKey(lat, lng)) invalidate(key);
}

/** Drops every nearby entry and the active-id set from memory. Dev action + logout (`AuthContext.clearStoredSession`). */
export function resetStoreServiceCaches(): void {
  invalidate('nearby:');
  invalidate(QC_KEYS.activeProductIds);
}
