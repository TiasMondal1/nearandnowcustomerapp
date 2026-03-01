import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const adminKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
export const supabaseAdmin = createClient(SUPABASE_URL, adminKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
