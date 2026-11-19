import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { applyDevNetworkSeams, recordNetworkLog, type NetworkLogEntry } from './apiClient';
import { getDevFlag } from './devFlags';
import { reportSupabaseResponse } from './reportHandled';

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

/** No Supabase request may run longer than this (ms). */
const SUPABASE_TIMEOUT_MS = 15_000;

// A request on a dead connection never settles on its own: React Native builds its OkHttp client with connect /
// read / write timeouts of 0, and only apiFetch had a timer. A hung read left Home in its skeleton until the app
// was killed. Every Supabase request now aborts after 15 s. A caller-supplied signal (`.abortSignal()`) is
// chained, not replaced: either one aborts the request. The rejection keeps the name "AbortError" on purpose —
// postgrest-js retries any OTHER fetch failure of a GET three more times with backoff, which would turn one 15 s
// timeout into a minute; an AbortError is returned to the caller at once as `{ error }`.
async function fetchWithTimeout(target: string | Request, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? (typeof target === 'string' ? undefined : target.signal);
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', onCallerAbort);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SUPABASE_TIMEOUT_MS);

  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch (err) {
    if (!timedOut) throw err;
    const timeout = new Error(`Supabase request timed out after ${SUPABASE_TIMEOUT_MS / 1000} s`);
    timeout.name = 'AbortError';
    throw timeout;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

// Same offline / latency / fail-rate seams as apiFetch so catalog loads slow
// down and fail on demand too (kepler #27). Plain pass-through when dev mode
// is locked. Timing + status land in the dev panel's network log when
// `Dev_Perf_inhibit_NetworkLog` is on; a seam rejection is logged by
// applyDevNetworkSeams itself, so only the real fetch is recorded here.
const devFetch: typeof fetch = async (input, init) => {
  await applyDevNetworkSeams('supabase');
  const target = toRequestInfo(input);
  if (!getDevFlag('Dev_Perf_inhibit_NetworkLog')) {
    const response = await fetchWithTimeout(target, init);
    // Failed queries the screens handle quietly → Sentry. A success costs one check.
    if (response.status >= 400) reportSupabaseResponse(input, init, response);
    return response;
  }

  const { method, path } = describeRequest(input, init);
  const startedAt = Date.now();
  let status: NetworkLogEntry['status'] = 'error';
  try {
    const response = await fetchWithTimeout(target, init);
    status = response.status;
    if (response.status >= 400) reportSupabaseResponse(input, init, response);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    status = message.includes('Network request failed') ? 'offline' : message.includes('timed out') ? 'timeout' : 'error';
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
