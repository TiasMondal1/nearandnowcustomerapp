import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch } from './apiClient';

// ─── Saved-address cache ────────────────────────────────────────────────────
// Mirrors the home-catalog SWR pattern: paint from the last-known list
// instantly so the "Select Location" sheet never shows a blank screen, then
// revalidate from Supabase in the background. The cache is keyed per user so
// two accounts on the same device don't leak into each other.
const ADDRESS_CACHE_VERSION = 1;
const ADDRESS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const addressCacheKey = (userId: string) =>
  `nn_saved_addresses_v${ADDRESS_CACHE_VERSION}:${userId}`;

export interface SavedAddressCache {
  version: number;
  savedAt: number;
  addresses: SavedAddress[];
}

export async function readAddressesCache(
  userId: string,
): Promise<SavedAddress[] | null> {
  if (!userId) return null;
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

export async function getUserAddresses(userId: string): Promise<SavedAddress[]> {
  const rows = await apiFetch<SavedAddress[]>(`/api/customers/${userId}/addresses`);
  // Refresh the local cache on every successful fetch so subsequent cold
  // starts can paint instantly from disk.
  writeAddressesCache(userId, rows).catch(() => {});
  return rows;
}

export async function createAddress(
  userId: string,
  payload: {
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
  },
): Promise<SavedAddress> {
  const data = await apiFetch<SavedAddress>(`/api/customers/${userId}/addresses`, {
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

  invalidateAddressesCache(userId).catch(() => {});
  return data;
}

export async function updateAddress(
  addressId: string,
  userId: string,
  payload: {
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
  },
): Promise<SavedAddress> {
  // JSON.stringify drops keys whose value is `undefined`, so this only ever
  // sends the fields the caller actually set — the backend's PATCH endpoint
  // (customers.controller.ts's updateAddress) only touches whitelisted
  // fields present in the body, same "only update what's provided" behavior
  // the old per-field spread had.
  const data = await apiFetch<SavedAddress>(`/api/customers/addresses/${addressId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  invalidateAddressesCache(userId).catch(() => {});
  return data;
}

export async function deleteAddress(addressId: string, userId: string): Promise<void> {
  await apiFetch(`/api/customers/addresses/${addressId}`, { method: 'DELETE' });
  invalidateAddressesCache(userId).catch(() => {});
}

export async function setDefaultAddress(addressId: string, userId: string): Promise<void> {
  // The backend's update endpoint already unsets every other address's
  // is_default before setting this one (customers.controller.ts's
  // updateAddress → database.service.ts's updateCustomerSavedAddress),
  // same two-step behavior this used to do directly against Supabase.
  await apiFetch(`/api/customers/addresses/${addressId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_default: true }),
  });
  invalidateAddressesCache(userId).catch(() => {});
}
