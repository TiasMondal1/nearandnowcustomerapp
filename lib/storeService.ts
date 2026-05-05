import { supabase } from './supabase';
import { calculateDistance } from './distanceUtils';

export interface NearbyStore {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

export const NEARBY_RADIUS_KM = 4;

/**
 * Fetches all active stores, filters to those within radiusKm of the customer,
 * and returns them sorted by distance (nearest first).
 */
export async function getNearbyActiveStores(
  lat: number,
  lng: number,
  radiusKm = NEARBY_RADIUS_KM,
): Promise<NearbyStore[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, latitude, longitude')
    .eq('is_active', true);

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; latitude: number; longitude: number }>)
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => ({
      ...s,
      distanceKm: calculateDistance(lat, lng, s.latitude, s.longitude),
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Returns the set of master_product_ids that are actively stocked in the given stores.
 */
export async function getMasterProductIdsForStores(storeIds: string[]): Promise<Set<string>> {
  if (!storeIds.length) return new Set();

  const { data, error } = await supabase
    .from('products')
    .select('master_product_id')
    .in('store_id', storeIds)
    .eq('is_active', true);

  if (error || !data) return new Set();

  const ids = new Set<string>();
  for (const row of data as { master_product_id: string | null }[]) {
    if (row.master_product_id) ids.add(row.master_product_id);
  }
  return ids;
}

/**
 * Single call that returns which stores are nearby and which master products
 * they carry. Call this once per location change, then pass the result to
 * product-fetching functions.
 *
 * Returns null if the location is invalid.
 * Returns { storeIds: [], productIds: new Set() } if no stores are nearby.
 */
export async function getNearbyProductFilter(
  lat: number,
  lng: number,
  radiusKm = NEARBY_RADIUS_KM,
): Promise<{ storeIds: string[]; productIds: Set<string> } | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const stores = await getNearbyActiveStores(lat, lng, radiusKm);
  const storeIds = stores.map((s) => s.id);
  const productIds = await getMasterProductIdsForStores(storeIds);
  return { storeIds, productIds };
}
