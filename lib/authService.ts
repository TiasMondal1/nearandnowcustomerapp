import Constants from 'expo-constants';
import { apiFetch } from './apiClient';

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  email_verified_at?: string | null;
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
  landmark?: string | null;
  delivery_instructions?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: AppUser;
  customer?: Customer;
  token: string;
  isNewUser: boolean;
}

const getApiBase = () => {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return (
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    extra.apiBaseUrl ||
    'https://near-and-now-backend.vercel.app'
  ).replace(/\/+$/, '');
};

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Request timed out. Check your connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOTP(phone: string): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('API base URL is not configured.');
  const url = `${apiBase}/api/auth/send-otp`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });

  if (!response.ok) {
    let message = 'Failed to send OTP';
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        message = parsed.message || parsed.error || message;
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
  email?: string,
): Promise<AuthResponse> {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('API base URL is not configured.');
  const url = `${apiBase}/api/auth/verify-otp`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp: String(otp).trim(), name, email }),
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
    isNewUser: Boolean(data.isNewUser),
  };
}

/**
 * Fetches the caller's own profile from the backend, identified solely by
 * the session token apiFetch attaches automatically — no userId parameter
 * needed (or trusted) any more. Replaces the old direct-Supabase-admin-client
 * read, which took a bare userId with zero verification against the actual
 * authenticated session (an IDOR — anyone who knew/guessed another user's id
 * could read their full profile).
 */
export async function getCurrentUserFromSession(): Promise<{ user: AppUser; customer?: Customer } | null> {
  try {
    const data = await apiFetch<{ user: AppUser; customer?: Customer }>('/api/customers/me');
    return data;
  } catch {
    return null;
  }
}

export async function updateCustomerProfile(
  updates: {
    name?: string;
    surname?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    landmark?: string;
    delivery_instructions?: string;
  },
): Promise<void> {
  // Email is intentionally excluded here — it now goes through the verified-email
  // flow (changeEmail / verifyEmailCode below), which requires backend-owned
  // code generation and sending, not a direct client write.
  await apiFetch('/api/customers/me', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/** Sets (first time) or stages a change of (subsequent times) the customer's email. Sends a 4-digit code. */
export async function changeCustomerEmail(email: string): Promise<void> {
  await apiFetch('/api/customers/email/change', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Confirms the 4-digit code emailed by changeCustomerEmail/resendEmailVerificationCode. */
export async function verifyCustomerEmailCode(code: string): Promise<{ email: string }> {
  return apiFetch<{ email: string }>('/api/customers/email/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/** Regenerates and resends the verification code for whichever email is currently unverified. */
export async function resendEmailVerificationCode(): Promise<void> {
  await apiFetch('/api/customers/email/resend', { method: 'POST' });
}
