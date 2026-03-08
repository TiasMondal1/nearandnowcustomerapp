import { supabase } from './supabase';

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'customer' | 'shopkeeper' | 'delivery_partner';
  is_activated: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  user_id: string;
  name: string;
  surname: string | null;
  phone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  landmark: string;
  delivery_instructions: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: AppUser;
  customer?: Customer;
  token: string;
}

const getApiBase = () =>
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').toString().replace(/\/$/, '');

export async function sendOTP(phone: string): Promise<void> {
  const apiBase = getApiBase();
  const url = apiBase ? `${apiBase}/api/auth/send-otp` : '/api/auth/send-otp';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });

  if (!response.ok) {
    let message = 'Failed to send OTP';
    try {
      const text = await response.text();
      try {
        const error = JSON.parse(text);
        message = error.message || error.error || message;
      } catch {
        if (text) message = text;
      }
    } catch {}
    throw new Error(message);
  }
}

export async function verifyOTP(
  phone: string,
  otp: string,
  name = 'Customer',
): Promise<AuthResponse> {
  const apiBase = getApiBase();
  const url = apiBase ? `${apiBase}/api/auth/verify-otp` : '/api/auth/verify-otp';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp: String(otp).trim(), name }),
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data.message || data.error || 'Invalid OTP';
    throw new Error(String(message));
  }

  if (!data.user || !data.token) {
    throw new Error('Invalid response from server');
  }

  return {
    user: data.user as AppUser,
    customer: data.customer,
    token: data.token,
  };
}

export async function getCurrentUserFromSession(
  userId: string,
): Promise<{ user: AppUser; customer?: Customer } | null> {
  try {
    const { data: appUser, error } = await supabase
      .from('app_users')
      .select('id, name, email, phone, role, is_activated, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !appUser) return null;

    if (appUser.role === 'customer') {
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('user_id', appUser.id)
        .single();

      return { user: appUser as AppUser, customer: customer || undefined };
    }

    return { user: appUser as AppUser };
  } catch {
    return null;
  }
}

export async function updateCustomerProfile(
  userId: string,
  updates: {
    name?: string;
    email?: string;
    surname?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    landmark?: string;
    delivery_instructions?: string;
  },
): Promise<void> {
  if (updates.name || updates.email) {
    const appUserUpdates: Record<string, string> = {};
    if (updates.name) appUserUpdates.name = updates.name;
    if (updates.email) appUserUpdates.email = updates.email;

    await supabase.from('app_users').update(appUserUpdates).eq('id', userId);
  }

  const customerUpdates: Record<string, string | undefined> = {};
  if (updates.name) customerUpdates.name = updates.name;
  if (updates.surname !== undefined) customerUpdates.surname = updates.surname;
  if (updates.address !== undefined) customerUpdates.address = updates.address;
  if (updates.city !== undefined) customerUpdates.city = updates.city;
  if (updates.state !== undefined) customerUpdates.state = updates.state;
  if (updates.pincode !== undefined) customerUpdates.pincode = updates.pincode;
  if (updates.landmark !== undefined) customerUpdates.landmark = updates.landmark;
  if (updates.delivery_instructions !== undefined)
    customerUpdates.delivery_instructions = updates.delivery_instructions;

  if (Object.keys(customerUpdates).length > 0) {
    await supabase.from('customers').update(customerUpdates).eq('user_id', userId);
  }
}
