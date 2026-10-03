// codename: kepler
// Auth + customer-profile calls. Every request goes through `apiFetch` (K17): the OTP endpoints pass
// `{ auth: false, timeoutMs: 15000 }` because they run before any session exists — `auth: false` means
// no token is attached AND no SecureStore/AsyncStorage lookup happens, and a 401 on such a call never
// fires the session-expired handler (apiClient only does that when a token was actually sent).
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

/** Pre-session calls (send/verify OTP) get the shorter budget the old private `fetchWithTimeout` used. */
const OTP_TIMEOUT_MS = 15000;

/**
 * apiFetch maps EVERY 401 to this string. On the OTP endpoints no session exists, so a 401 there is the
 * backend rejecting the request (e.g. a wrong/expired code), not an expired session. The two OTP wrappers
 * swap it back for the user-facing default they have always shown, so neither screen ever says
 * "Session expired" to a user who is still logging in.
 */
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please log in again.';

function errorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  return message && message !== SESSION_EXPIRED_MESSAGE ? message : fallback;
}

export async function sendOTP(phone: string): Promise<void> {
  try {
    await apiFetch<unknown>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      auth: false,
      timeoutMs: OTP_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(errorMessage(err, 'Failed to send OTP'));
  }
}

type VerifyOtpBody = Partial<{
  user: AppUser;
  customer: Customer;
  token: string;
  isNewUser: boolean;
}>;

export async function verifyOTP(
  phone: string,
  otp: string,
  name = 'Customer',
  email?: string,
): Promise<AuthResponse> {
  let data: VerifyOtpBody;
  try {
    data = await apiFetch<VerifyOtpBody>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp: String(otp).trim(), name, email }),
      auth: false,
      timeoutMs: OTP_TIMEOUT_MS,
    });
  } catch (err) {
    // The backend's own message is preserved verbatim for 4xx bodies — app/otp.tsx matches on the
    // "email" substring to route brand-new signups back to /phone (auth.controller.ts rejects
    // new accounts without an email).
    throw new Error(errorMessage(err, 'Invalid OTP'));
  }

  if (!data || typeof data !== 'object' || !data.user || !data.token) {
    throw new Error('Invalid response from server');
  }

  return {
    user: data.user,
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
 *
 * `opts.timeoutMs` is forwarded to apiFetch (AuthContext's session restore
 * races this against its own budget as well). Resolves `null` on any failure.
 */
export async function getCurrentUserFromSession(
  opts?: { timeoutMs?: number },
): Promise<{ user: AppUser; customer?: Customer } | null> {
  try {
    const data = await apiFetch<{ user: AppUser; customer?: Customer }>(
      '/api/customers/me',
      opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined,
    );
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
