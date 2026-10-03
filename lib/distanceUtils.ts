/**
 * Great-circle distance in kilometres (haversine, Earth radius 6371 km)
 * between two WGS-84 coordinates. Pure; used by `storeService` to rank
 * nearby stores and by the delivery ETA source.
 *
 * The three Supabase-backed per-store / per-product / batched distance
 * helpers that used to live here had no callers and were removed
 * (W1-data-catalog, 2026-10-03) — distances now come from the cached nearby
 * filter instead of per-item queries.
 */
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
