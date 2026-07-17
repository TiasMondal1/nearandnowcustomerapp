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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
}
