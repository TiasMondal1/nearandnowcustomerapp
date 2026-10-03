import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { applyDevNetworkSeams, recordNetworkLog, type NetworkLogEntry } from './apiClient';
import { getDevFlag } from './devFlags';

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

/** Hostname of the configured project (e.g. `abcd.supabase.co`), or `''` when unconfigured. Dev panel Environment tab only — never the key. */
export const SUPABASE_HOST: string = (() => {
  if (!SUPABASE_URL) return '';
  try {
    return new URL(SUPABASE_URL).hostname;
  } catch {
    return '';
  }
})();

// `typeof fetch` is overloaded (lib.dom takes `RequestInfo | URL`, React Native's
// global takes `RequestInfo` = string | Request). The arrow below is contextually
// typed with the widest input, so the helpers spell that union out explicitly.
type FetchInput = string | Request | URL;

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  const maybe = input as { url?: unknown; href?: unknown };
  if (typeof maybe.url === 'string') return maybe.url;
  if (typeof maybe.href === 'string') return maybe.href;
  return String(input);
}

// React Native's fetch typing takes `string | Request`; a URL instance (the
// wider lib.dom signature) is passed through as its href. Spelled out rather
// than named `RequestInfo`, which resolves to Node's wider global here.
function toRequestInfo(input: FetchInput): string | Request {
  if (typeof input === 'string') return input;
  const maybe = input as { href?: unknown; url?: unknown };
  if (typeof maybe.href === 'string' && typeof maybe.url !== 'string') return maybe.href;
  return input as Request;
}

function describeRequest(input: FetchInput, init?: RequestInit): { method: string; path: string } {
  const url = requestUrl(input);
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string
  }
  const inputMethod = typeof input !== 'string' ? (input as { method?: unknown }).method : undefined;
  const method = String(init?.method ?? (typeof inputMethod === 'string' ? inputMethod : 'GET')).toUpperCase();
  return { method, path };
}

// Same offline / latency / fail-rate seams as apiFetch so catalog loads slow
// down and fail on demand too (kepler #27). Plain pass-through when dev mode
// is locked. Timing + status land in the dev panel's network log when
// `Dev_Perf_inhibit_NetworkLog` is on; a seam rejection is logged by
// applyDevNetworkSeams itself, so only the real fetch is recorded here.
const devFetch: typeof fetch = async (input, init) => {
  await applyDevNetworkSeams('supabase');
  const target = toRequestInfo(input);
  if (!getDevFlag('Dev_Perf_inhibit_NetworkLog')) return fetch(target, init);

  const { method, path } = describeRequest(input, init);
  const startedAt = Date.now();
  let status: NetworkLogEntry['status'] = 'error';
  try {
    const response = await fetch(target, init);
    status = response.status;
    return response;
  } catch (err) {
    status = err instanceof Error && err.message.includes('Network request failed') ? 'offline' : 'error';
    throw err;
  } finally {
    recordNetworkLog({ method, path, ms: Date.now() - startedAt, status });
  }
};

// Supabase Auth is never used (the phone-OTP session is the backend's own
// JWT), so GoTrue's session persistence / refresh timer are pure overhead and
// an AsyncStorage write we don't want (MAP C52). `x-client` tags our requests
// in the project's logs.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: devFetch, headers: { 'x-client': 'nn-customer-app' } },
});
