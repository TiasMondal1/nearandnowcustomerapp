import AsyncStorage from '@react-native-async-storage/async-storage';

import { assertSupabaseAdminConfigured, supabaseAdmin } from './supabase';

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
  assertSupabaseAdminConfigured();
  const { data, error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .select('*')
    .eq('customer_id', userId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SavedAddress[];
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
  assertSupabaseAdminConfigured();
  if (payload.is_default) {
    await supabaseAdmin
      .from('customer_saved_addresses')
      .update({ is_default: false })
      .eq('customer_id', userId);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .insert({
      customer_id: userId,
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
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create address');
  invalidateAddressesCache(userId).catch(() => {});
  return data as SavedAddress;
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
  assertSupabaseAdminConfigured();

  if (payload.is_default) {
    await supabaseAdmin
      .from('customer_saved_addresses')
      .update({ is_default: false })
      .eq('customer_id', userId);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .update({
      ...(payload.label !== undefined ? { label: payload.label } : {}),
      ...(payload.address !== undefined ? { address: payload.address } : {}),
      ...(payload.city !== undefined ? { city: payload.city } : {}),
      ...(payload.state !== undefined ? { state: payload.state } : {}),
      ...(payload.pincode !== undefined ? { pincode: payload.pincode } : {}),
      ...(payload.country !== undefined ? { country: payload.country } : {}),
      ...(payload.latitude !== undefined ? { latitude: payload.latitude } : {}),
      ...(payload.longitude !== undefined ? { longitude: payload.longitude } : {}),
      ...(payload.google_place_id !== undefined
        ? { google_place_id: payload.google_place_id }
        : {}),
      ...(payload.google_formatted_address !== undefined
        ? { google_formatted_address: payload.google_formatted_address }
        : {}),
      ...(payload.google_place_data !== undefined
        ? { google_place_data: payload.google_place_data }
        : {}),
      ...(payload.contact_name !== undefined ? { contact_name: payload.contact_name } : {}),
      ...(payload.contact_phone !== undefined ? { contact_phone: payload.contact_phone } : {}),
      ...(payload.landmark !== undefined ? { landmark: payload.landmark } : {}),
      ...(payload.delivery_instructions !== undefined
        ? { delivery_instructions: payload.delivery_instructions }
        : {}),
      ...(payload.delivery_for !== undefined ? { delivery_for: payload.delivery_for } : {}),
      ...(payload.receiver_name !== undefined ? { receiver_name: payload.receiver_name } : {}),
      ...(payload.receiver_address !== undefined
        ? { receiver_address: payload.receiver_address }
        : {}),
      ...(payload.receiver_phone !== undefined ? { receiver_phone: payload.receiver_phone } : {}),
      ...(payload.is_default !== undefined ? { is_default: payload.is_default } : {}),
      ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', addressId)
    .eq('customer_id', userId)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to update address');
  invalidateAddressesCache(userId).catch(() => {});
  return data as SavedAddress;
}

export async function deleteAddress(addressId: string, userId: string): Promise<void> {
  assertSupabaseAdminConfigured();
  const { error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', addressId)
    .eq('customer_id', userId);

  if (error) throw new Error(error.message);
  invalidateAddressesCache(userId).catch(() => {});
}

export async function setDefaultAddress(addressId: string, userId: string): Promise<void> {
  assertSupabaseAdminConfigured();
  await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_default: false })
    .eq('customer_id', userId);

  await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', addressId)
    .eq('customer_id', userId);
  invalidateAddressesCache(userId).catch(() => {});
}
