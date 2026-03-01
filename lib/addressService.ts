import { supabaseAdmin } from './supabase';

export interface SavedAddress {
  id: string;
  customer_id: string;
  label: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
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
  const { data, error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .select('*')
    .eq('customer_id', userId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as SavedAddress[];
}

export async function createAddress(
  userId: string,
  payload: {
    label: string;
    address: string;
    city?: string;
    state?: string;
    pincode?: string;
    latitude: number;
    longitude: number;
    contact_name?: string;
    contact_phone?: string;
    landmark?: string;
    delivery_instructions?: string;
    is_default?: boolean;
    delivery_for?: 'self' | 'others';
    receiver_name?: string;
    receiver_phone?: string;
  },
): Promise<SavedAddress> {
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
      country: 'India',
      latitude: payload.latitude,
      longitude: payload.longitude,
      contact_name: payload.contact_name || null,
      contact_phone: payload.contact_phone || null,
      landmark: payload.landmark || null,
      delivery_instructions: payload.delivery_instructions || '',
      is_default: payload.is_default ?? false,
      is_active: true,
      delivery_for: payload.delivery_for || 'self',
      receiver_name: payload.receiver_name || null,
      receiver_phone: payload.receiver_phone || null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create address');
  return data as SavedAddress;
}

export async function deleteAddress(addressId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', addressId)
    .eq('customer_id', userId);

  if (error) throw new Error(error.message);
}

export async function setDefaultAddress(addressId: string, userId: string): Promise<void> {
  await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_default: false })
    .eq('customer_id', userId);

  await supabaseAdmin
    .from('customer_saved_addresses')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', addressId)
    .eq('customer_id', userId);
}
