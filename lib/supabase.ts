import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Two-layer fallback: Metro-inlined process.env (local + EAS builds with vars set)
// → Constants.expoConfig.extra (always baked in by app.config.js, catches any case
// where Metro inlining didn't fire — e.g. no EAS env vars configured).
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('⚠️ CRITICAL: Supabase credentials missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in EAS dashboard (expo.dev → project → Environment Variables).');
}

// ⚠️ SECURITY NOTE: The service-role key MUST NOT be prefixed with EXPO_PUBLIC_
// — that prefix bundles it into the APK/IPA where anyone with a decompiler can
// read it. Until all privileged operations are moved to the Railway backend,
// the key is read from a non-public env var so it is ONLY available during
// server-side operations (EAS build / dev server). In production builds, the
// server-side key will be absent and `supabaseAdmin` will transparently fall
// back to the anon client (which is safe — RLS will gate access appropriately).
//
// Migration path: move createOrder, getUserOrdersFromSupabase, getCategoryCounts,
// getProductsByCategory, etc. to POST/GET endpoints on the Railway backend and
// remove supabaseAdmin from this file entirely.
//
// ⚠️ TEMPORARY DEV WORKAROUND: For local development only, we fall back to
// EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY if the non-public version isn't available.
// This is NOT secure for production builds - remove before production deployment.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
  '';

if (process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ DEV MODE: Using EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY. This is insecure for production!');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Falls back to the anon client when the service-role key is absent (i.e. in
// production builds). Privileged writes (createOrder, etc.) will fail without
// the key — that is intentional until the Railway backend handles them.
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
}

export function assertSupabaseAdminConfigured() {
  assertSupabaseConfigured();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase admin key is missing. Set SUPABASE_SERVICE_ROLE_KEY (server-side only — never EXPO_PUBLIC_).',
    );
  }
}
