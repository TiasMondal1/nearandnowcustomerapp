import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Two-layer fallback: Metro-inlined process.env (local + EAS builds with vars set)
// → Constants.expoConfig.extra (always baked in by app.config.js, catches any case
// where Metro inlining didn't fire — e.g. no EAS env vars configured).
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || '';

// Previously this only logged to the console on a missing config and kept
// going — invisible on a real device (nobody's watching Metro logs on a
// shipped build), so the app would silently limp along with every Supabase
// call failing deep inside individual screens instead of one clear signal.
// `isSupabaseConfigured` lets the root layout fail fast with a dedicated
// error screen instead. The unused `assertSupabaseConfigured()` this
// replaced was never actually called anywhere — dead code sitting next to
// the very bug it looked like it was meant to prevent.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.error('⚠️ CRITICAL: Supabase credentials missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in EAS dashboard (expo.dev → project → Environment Variables).');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
