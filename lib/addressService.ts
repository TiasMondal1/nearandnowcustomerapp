import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch } from './apiClient';
import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';
import { cached, peek, QC_KEYS, setCached } from './queryCache';

// ─── Saved-address disk cache ───────────────────────────────────────────────
// Mirrors the home-catalog SWR pattern: paint from the last-known list
// instantly so the "Select Location" sheet never shows a blank screen, then
// revalidate from the API in the background. The cache is keyed per user so
// two accounts on the same device don't leak into each other.
//
// W15-location-foundations (2026-10-03, kepler): this disk envelope is now the
// SEED under the queryCache memory layer (`QC_KEYS.addresses(userId)`, 5 min,
// user-scoped — cleared by `clearUserScoped()` on logout). Mutations are
// optimistic against that memory list (MAP P31 / speed-and-ease #33).
const ADDRESS_CACHE_VERSION = 1;
const ADDRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
/** Memory TTL: one address-book session; `force` (pull-to-refresh / focus revalidate) bypasses it. */
const ADDRESSES_MEMORY_TTL_MS = 300_000;

const addressCacheKey = (userId: string) =>
  `nn_saved_addresses_v${ADDRESS_CACHE_VERSION}:${userId}`;

export interface SavedAddressCache {
  version: number;
  savedAt: number;
  addresses: SavedAddress[];
}

/** Last-known list from disk, or `null` on miss / version mismatch / expiry / parse error / `Dev_Cache_inhibit_Addresses`. */
export async function readAddressesCache(
  userId: string,
): Promise<SavedAddress[] | null> {
  if (!userId) return null;
  if (getDevFlag('Dev_Cache_inhibit_Addresses')) return null;
  try {
    const raw = await AsyncStorage.getItem(addressCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedAddressCache;
    if (!parsed || parsed.version !== ADDRESS_CACHE_VERSION) return null;
    if (Date.now() - parsed.savedAt > ADDRESS_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.addresses) ? parsed.addresses : null;
  } catch {
    return null;
  }
}

export async function writeAddressesCache(
  userId: string,
  addresses: SavedAddress[],
): Promise<void> {
  if (!userId) return;
  const payload: SavedAddressCache = {
    version: ADDRESS_CACHE_VERSION,
    savedAt: Date.now(),
    addresses,
  };
  try {
    await AsyncStorage.setItem(
      addressCacheKey(userId),
      JSON.stringify(payload),
    );
  } catch {
    // Cache writes are best-effort; a failure here just means the next launch
    // falls back to network-first.
  }
}

export async function invalidateAddressesCache(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(addressCacheKey(userId));
  } catch {
    // Ignore — worst case the stale entry is overwritten on the next write.
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SavedAddress {
  id: string;
  customer_id: string;
  label: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  google_place_id?: string;
  google_formatted_address?: string;
  google_place_data?: Record<string, unknown> | null;
  contact_name?: string;
  contact_phone?: string;
  landmark?: string;
  delivery_instructions?: string;
  is_default: boolean;
  is_active: boolean;
  delivery_for: 'self' | 'others';
  receiver_name?: string;
  receiver_address?: string;
  receiver_phone?: string;
  created_at?: string;
  updated_at?: string;
}

export type CreateAddressPayload = {
  label: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  latitude: number;
  longitude: number;
  google_place_id?: string;
  google_formatted_address?: string;
  google_place_data?: Record<string, unknown> | null;
  contact_name?: string;
  contact_phone?: string;
  landmark?: string;
  delivery_instructions?: string;
  is_default?: boolean;
  delivery_for?: 'self' | 'others';
  receiver_name?: string;
  receiver_address?: string;
  receiver_phone?: string;
};

export type UpdateAddressPayload = {
  label?: string;
  address?: string;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  latitude?: number;
  longitude?: number;
  google_place_id?: string | null;
  google_formatted_address?: string | null;
  google_place_data?: Record<string, unknown> | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  landmark?: string | null;
  delivery_instructions?: string | null;
  delivery_for?: 'self' | 'others';
  receiver_name?: string | null;
  receiver_address?: string | null;
  receiver_phone?: string | null;
  is_default?: boolean;
  is_active?: boolean;
};

// ─── returnTo (quartz) ──────────────────────────────────────────────────────
// A `returnTo` search param becomes an Href ONLY through `parseReturnTo` — never
// a cast (PLAN §5.5: no any-casts / Href casts). The allowlist is the places the
// address flow is entered from: checkout, the three tabs and the address book
// (the Categories / Order-again header pills were added in W3 — R6-16).

export type ReturnTo = '/support/checkout' | '/(tabs)/home' | '/(tabs)/categories' | '/(tabs)/order-again' | '/location';

export const RETURN_TO_ALLOWLIST = [
  '/support/checkout',
  '/(tabs)/home',
  '/(tabs)/categories',
  '/(tabs)/order-again',
  '/location',
] as const satisfies readonly ReturnTo[];

/** The matching allowlisted literal, or `null` for everything else (external URLs, typos, arrays with no match). */
export function parseReturnTo(raw: string | string[] | undefined): ReturnTo | null {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  for (const allowed of RETURN_TO_ALLOWLIST) {
    if (trimmed === allowed) return allowed;
  }
  return null;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

async function fetchAddressesFromApi(userId: string): Promise<SavedAddress[]> {
  const rows = await apiFetch<SavedAddress[]>(`/api/customers/${encodeURIComponent(userId)}/addresses`);
  const list = Array.isArray(rows) ? rows : [];
  // Refresh the disk seed on every successful fetch so the next cold start
  // paints instantly from disk.
  writeAddressesCache(userId, list).catch((err) => logSilentFailure('Write addresses cache', err));
  return list;
}

/**
 * Background network refresh of the memory entry. `force` skips the memory read but still shares one
 * in-flight request with every concurrent caller; the resolve is dropped by queryCache when the entry
 * was invalidated or the user logged out mid-flight (no cross-user leak). Never throws.
 */
function revalidateAddresses(userId: string): void {
  cached(QC_KEYS.addresses(userId), () => fetchAddressesFromApi(userId), {
    ttlMs: ADDRESSES_MEMORY_TTL_MS,
    userScope: true,
    force: true,
  }).catch((err) => logSilentFailure('Revalidate addresses', err));
}

/**
 * The user's saved addresses. Memory (5 min, user-scoped, in-flight deduped) → disk seed → API.
 * The FIRST call of a session (nothing in memory yet) resolves from the disk envelope when one exists
 * (instant first paint) and kicks a background API refresh that replaces it; once memory holds a list —
 * fresh or stale — an awaited call goes to the network (screens paint the stale list through
 * `peekAddresses` / `useCachedValue` meanwhile). `{ force: true }` skips memory and disk (focus
 * revalidate, pull-to-refresh). `Dev_Cache_inhibit_Addresses` makes the disk seed miss, so every open
 * takes the network path.
 */
export async function getUserAddresses(userId: string, opts?: { force?: boolean }): Promise<SavedAddress[]> {
  if (!userId) return [];
  const key = QC_KEYS.addresses(userId);
  const force = !!opts?.force;
  const seed = { fromDisk: false };

  const rows = await cached<SavedAddress[]>(
    key,
    async () => {
      // `peek` is undefined while the entry is in flight with no value yet — exactly the first-paint case.
      if (!force && peek<SavedAddress[]>(key) === undefined) {
        const disk = await readAddressesCache(userId);
        if (disk) {
          seed.fromDisk = true;
          return disk;
        }
      }
      return fetchAddressesFromApi(userId);
    },
    { ttlMs: ADDRESSES_MEMORY_TTL_MS, userScope: true, force },
  );

  // The `await` above resumes only after queryCache committed the disk list, so the forced
  // refresh below really hits the network (an in-flight entry would have deduped onto the seed).
  if (seed.fromDisk) revalidateAddresses(userId);
  return rows;
}

/** Sync memory read for first paint (may be older than the TTL); `undefined` before the first resolve. */
export function peekAddresses(userId: string): SavedAddress[] | undefined {
  if (!userId) return undefined;
  return peek<SavedAddress[]>(QC_KEYS.addresses(userId));
}

// ─── Optimistic helpers ─────────────────────────────────────────────────────

/** Writes `next` to memory (notifying subscribers) and to the disk seed. */
function commitList(userId: string, next: SavedAddress[]): void {
  setCached(QC_KEYS.addresses(userId), next, { ttlMs: ADDRESSES_MEMORY_TTL_MS, userScope: true });
  writeAddressesCache(userId, next).catch((err) => logSilentFailure('Write addresses cache', err));
}

/** Restores the pre-mutation list after a failed API call (memory + disk). With no base list nothing was patched, so nothing moves. */
function rollbackList(userId: string, prev: SavedAddress[] | undefined): void {
  if (prev) commitList(userId, prev);
}

/** Server-confirmed list → memory + disk, then a background refetch reconciles ordering / server-side fields. */
function settleList(userId: string, next: SavedAddress[] | undefined): void {
  if (next) commitList(userId, next);
  revalidateAddresses(userId);
}

function clearDefaults(list: SavedAddress[]): SavedAddress[] {
  return list.map((a) => (a.is_default ? { ...a, is_default: false } : a));
}

const NULLABLE_STRING_KEYS = [
  'city',
  'state',
  'pincode',
  'country',
  'google_place_id',
  'google_formatted_address',
  'contact_name',
  'contact_phone',
  'landmark',
  'delivery_instructions',
  'receiver_name',
  'receiver_address',
  'receiver_phone',
] as const;

/** The row as the backend will return it after a PATCH: provided keys win, `null` clears, `undefined` keeps. */
function applyUpdatePatch(a: SavedAddress, p: UpdateAddressPayload): SavedAddress {
  const next: SavedAddress = { ...a, updated_at: new Date().toISOString() };
  if (p.label !== undefined) next.label = p.label;
  if (p.address !== undefined) next.address = p.address;
  if (p.latitude !== undefined) next.latitude = p.latitude;
  if (p.longitude !== undefined) next.longitude = p.longitude;
  if (p.google_place_data !== undefined) next.google_place_data = p.google_place_data;
  if (p.delivery_for !== undefined) next.delivery_for = p.delivery_for;
  if (p.is_default !== undefined) next.is_default = p.is_default;
  if (p.is_active !== undefined) next.is_active = p.is_active;
  for (const key of NULLABLE_STRING_KEYS) {
    const v = p[key];
    if (v !== undefined) next[key] = v ?? undefined;
  }
  return next;
}

/** The row as the backend will return it after a POST, under a temporary id until the server row replaces it. */
function optimisticRow(userId: string, payload: CreateAddressPayload, tempId: string): SavedAddress {
  const now = new Date().toISOString();
  return {
    id: tempId,
    customer_id: userId,
    label: payload.label,
    address: payload.address,
    city: payload.city || undefined,
    state: payload.state || undefined,
    pincode: payload.pincode || undefined,
    country: payload.country || 'India',
    latitude: payload.latitude,
    longitude: payload.longitude,
    google_place_id: payload.google_place_id || undefined,
    google_formatted_address: payload.google_formatted_address || undefined,
    google_place_data: payload.google_place_data ?? null,
    contact_name: payload.contact_name || undefined,
    contact_phone: payload.contact_phone || undefined,
    landmark: payload.landmark || undefined,
    delivery_instructions: payload.delivery_instructions || '',
    is_default: payload.is_default ?? false,
    is_active: true,
    delivery_for: payload.delivery_for || 'self',
    receiver_name: payload.receiver_name || undefined,
    receiver_address: payload.receiver_address || undefined,
    receiver_phone: payload.receiver_phone || undefined,
    created_at: now,
    updated_at: now,
  };
}

// ─── Mutations (optimistic; signatures unchanged) ───────────────────────────
// Each one: patch the memory list + disk seed first, call the API, roll back + rethrow on failure,
// commit the server-confirmed list + refetch in the background on success. With nothing in memory
// (screen never loaded the list) there is nothing to patch — the API call runs and the next read
// fetches fresh. `Dev_Network_inhibit_FailRate = 1` exercises the rollback path.

export async function createAddress(
  userId: string,
  payload: CreateAddressPayload,
): Promise<SavedAddress> {
  const prev = peekAddresses(userId);
  const tempId = `optimistic:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const temp = optimisticRow(userId, payload, tempId);
  if (prev) commitList(userId, [...(temp.is_default ? clearDefaults(prev) : prev), temp]);

  let data: SavedAddress;
  try {
    data = await apiFetch<SavedAddress>(`/api/customers/${encodeURIComponent(userId)}/addresses`, {
      method: 'POST',
      body: JSON.stringify({
        label: payload.label,
        address: payload.address,
        city: payload.city || null,
        state: payload.state || null,
        pincode: payload.pincode || null,
        country: payload.country || 'India',
        latitude: payload.latitude,
        longitude: payload.longitude,
        google_place_id: payload.google_place_id || null,
        google_formatted_address: payload.google_formatted_address || null,
        google_place_data: payload.google_place_data ?? null,
        contact_name: payload.contact_name || null,
        contact_phone: payload.contact_phone || null,
        landmark: payload.landmark || null,
        delivery_instructions: payload.delivery_instructions || '',
        is_default: payload.is_default ?? false,
        is_active: true,
        delivery_for: payload.delivery_for || 'self',
        receiver_name: payload.receiver_name || null,
        receiver_address: payload.receiver_address || null,
        receiver_phone: payload.receiver_phone || null,
      }),
    });
  } catch (err) {
    rollbackList(userId, prev);
    throw err;
  }

  // Swap the temporary row for the server row (real id, server timestamps) in whatever the list is NOW —
  // another mutation may have landed while this one was in flight.
  const current = peekAddresses(userId);
  const confirmed: SavedAddress = data && typeof data === 'object' && data.id ? data : temp;
  if (current) {
    const base = confirmed.is_default ? clearDefaults(current) : current;
    const swapped = base.some((a) => a.id === tempId)
      ? base.map((a) => (a.id === tempId ? confirmed : a))
      : [...base, confirmed];
    settleList(userId, swapped);
  } else {
    settleList(userId, undefined);
  }
  return confirmed;
}

export async function updateAddress(
  addressId: string,
  userId: string,
  payload: UpdateAddressPayload,
): Promise<SavedAddress> {
  const prev = peekAddresses(userId);
  if (prev) {
    const patched = (payload.is_default ? clearDefaults(prev) : prev)
      .map((a) => (a.id === addressId ? applyUpdatePatch(a, payload) : a))
      .filter((a) => a.is_active !== false);
    commitList(userId, patched);
  }

  // JSON.stringify drops keys whose value is `undefined`, so this only ever
  // sends the fields the caller actually set — the backend's PATCH endpoint
  // (customers.controller.ts's updateAddress) only touches whitelisted
  // fields present in the body, same "only update what's provided" behavior
  // the old per-field spread had.
  let data: SavedAddress;
  try {
    data = await apiFetch<SavedAddress>(`/api/customers/addresses/${encodeURIComponent(addressId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    rollbackList(userId, prev);
    throw err;
  }

  const current = peekAddresses(userId);
  if (current && data && typeof data === 'object' && data.id) {
    const base = data.is_default ? clearDefaults(current) : current;
    settleList(
      userId,
      base.map((a) => (a.id === addressId ? data : a)).filter((a) => a.is_active !== false),
    );
  } else {
    settleList(userId, undefined);
  }
  return data;
}

export async function deleteAddress(addressId: string, userId: string): Promise<void> {
  const prev = peekAddresses(userId);
  if (prev) commitList(userId, prev.filter((a) => a.id !== addressId));

  try {
    await apiFetch(`/api/customers/addresses/${encodeURIComponent(addressId)}`, { method: 'DELETE' });
  } catch (err) {
    rollbackList(userId, prev);
    throw err;
  }

  const current = peekAddresses(userId);
  settleList(userId, current ? current.filter((a) => a.id !== addressId) : undefined);
}

export async function setDefaultAddress(addressId: string, userId: string): Promise<void> {
  const prev = peekAddresses(userId);
  // Clear `is_default` on the others locally — the backend's update endpoint
  // does the same (customers.controller.ts's updateAddress →
  // database.service.ts's updateCustomerSavedAddress) before setting this one.
  const markDefault = (list: SavedAddress[]) => list.map((a) => ({ ...a, is_default: a.id === addressId }));
  if (prev) commitList(userId, markDefault(prev));

  try {
    await apiFetch(`/api/customers/addresses/${encodeURIComponent(addressId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_default: true }),
    });
  } catch (err) {
    rollbackList(userId, prev);
    throw err;
  }

  const current = peekAddresses(userId);
  settleList(userId, current ? markDefault(current) : undefined);
}
