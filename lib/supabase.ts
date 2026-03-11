import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || '';

// Only the anon-key client lives in the app bundle.
// All admin/privileged operations go through the Railway backend API.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

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
      'Supabase admin key is missing. Set EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY (note: do not ship this in a production mobile app).',
    );
  }
}
