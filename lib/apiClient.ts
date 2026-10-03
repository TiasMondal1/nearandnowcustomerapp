import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { getDevFlag } from './devFlags';

// ─── User-facing messages (shared with lib/network.ts, OfflineBanner, tests) ──

export const OFFLINE_MESSAGE = 'No internet connection. Please check your network and try again.';
export const TIMEOUT_MESSAGE = 'Request timeout. Please check your internet connection and try again.';
export const SERVER_ERROR_MESSAGE = 'Server error. Please try again later.';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiFetchOptions = RequestInit & {
  /** Per-call timeout in ms. Default 30000; polls pass 8000. `Dev_Network_inhibit_TimeoutMs` (> 0) overrides it. */
  timeoutMs?: number;
  /**
   * Default true. `false` = never attach a bearer token AND never look one up
   * (no SecureStore / AsyncStorage read at all) — lib/authService.ts uses this
   * for the OTP endpoints, which run before any token exists.
   */
  auth?: boolean;
};

export type NetworkLogEntry = {
  /** Date.now() when the entry was recorded (end of the request). */
  at: number;
  /** Upper-cased HTTP method; 'SEAM' for a dev-seam rejection; 'CACHE' for queryCache resolves. */
  method: string;
  /** Request path (apiFetch), Supabase pathname, or the queryCache key. */
  path: string;
  /** Wall-clock duration in ms (0 for seam rejections). */
  ms: number;
  status: number | 'error' | 'offline' | 'timeout' | 'cache';
  cacheHit?: boolean;
};

// ─── Base URL ─────────────────────────────────────────────────────────────────

const _extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const DEFAULT_API_BASE = 'https://near-and-now-backend.vercel.app';
const API_TIMEOUT_MS = 30000; // 30 seconds — the default for mutations

/**
 * Backend origin without a trailing slash. `Dev_Network_inhibit_ApiBaseUrl`
 * wins when it is non-empty and starts with http(s)://; otherwise the
 * existing env → extra → default chain (unchanged).
 */
export function getApiBase(): string {
  const override = getDevFlag('Dev_Network_inhibit_ApiBaseUrl');
  if (override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  return (
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    _extra.apiBaseUrl ||
    DEFAULT_API_BASE
  ).replace(/\/+$/, '');
}

// ─── Network log (dev panel Session tab) ─────────────────────────────────────

const NETWORK_LOG_MAX = 50;
let networkLog: NetworkLogEntry[] = [];

/**
 * Appends to a 50-entry ring buffer. No-op unless `Dev_Perf_inhibit_NetworkLog`
 * is on (one cheap flag read), so hot paths may call it unconditionally.
 */
export function recordNetworkLog(entry: Omit<NetworkLogEntry, 'at'>): void {
  if (!getDevFlag('Dev_Perf_inhibit_NetworkLog')) return;
  networkLog.push({ at: Date.now(), ...entry });
  if (networkLog.length > NETWORK_LOG_MAX) {
    networkLog.splice(0, networkLog.length - NETWORK_LOG_MAX);
  }
}

/** Copy of the ring buffer, oldest first (at most 50 entries). */
export function getNetworkLog(): NetworkLogEntry[] {
  return networkLog.slice();
}

export function clearNetworkLog(): void {
  networkLog = [];
}

// ─── Dev network seams (shared by apiFetch and the Supabase client) ──────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDevNetworkSeams(): Promise<void> {
  if (getDevFlag('Dev_Network_inhibit_Offline')) throw new Error(OFFLINE_MESSAGE);
  const failRate = getDevFlag('Dev_Network_inhibit_FailRate');
  if (failRate > 0 && Math.random() < failRate) throw new Error(SERVER_ERROR_MESSAGE);
  const latencyMs = getDevFlag('Dev_Network_inhibit_LatencyMs');
  if (latencyMs > 0) await sleep(latencyMs);
}

/**
 * Dev seams, applied before fetch by BOTH transports:
 * `Dev_Network_inhibit_Offline` → throws OFFLINE_MESSAGE;
 * `Dev_Network_inhibit_FailRate` (0–1) → throws SERVER_ERROR_MESSAGE with that
 * probability; `Dev_Network_inhibit_LatencyMs` → awaits that long. Pure
 * pass-through when every flag is at its default (three cheap flag reads; the
 * registry returns defaults while dev mode is locked and on web). A rejection
 * is recorded in the network log as `{ method: 'SEAM', path: label }`.
 * `label` names the caller for that log ('supabase', or the apiFetch path).
 */
export async function applyDevNetworkSeams(label: string): Promise<void> {
  try {
    await runDevNetworkSeams();
  } catch (err) {
    recordNetworkLog({
      method: 'SEAM',
      path: label,
      ms: 0,
      status: err instanceof Error && err.message === OFFLINE_MESSAGE ? 'offline' : 'error',
    });
    throw err;
  }
}

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw error;
  }
}

// ─── Session expiry hook ─────────────────────────────────────────────────────

// Registered by AuthContext on mount so a 401 from ANY apiFetch call — not
// just ones AuthContext itself makes — can clear the stored session and flip
// isAuthenticated immediately, regardless of which screen the user is on.
// Without this, a truly expired session (25 days of inactivity) just threw an
// error on every subsequent call while the app kept believing it was logged in.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

/** Dev panel action: runs the registered session-expired handler (same path as a real 401). */
export function simulateSessionExpiry(): void {
  onSessionExpired?.();
}

// ─── Bearer token: in-memory memo + SecureStore fallback ─────────────────────

// `undefined` = not yet known this process (no restore ran, no request looked
// it up); `null` = known to be absent (guest / logged out); string = bearer.
// AuthContext owns the transitions: setAuthToken(token) on restore and after
// OTP verification, setAuthToken(null) in clearStoredSession. Keeping it here
// means a request never pays the Android Keystore round trip (5–40 ms) once
// the token is known (MAP P5; kepler #3).
let memoToken: string | null | undefined;

/** In-memory bearer. AuthContext calls this on restore / verify / logout. */
export function setAuthToken(token: string | null): void {
  memoToken = token;
}

/** `undefined` = unknown (not yet restored), `null` = no session, string = bearer. Sync; no storage read. */
export function getAuthTokenSync(): string | null | undefined {
  return memoToken;
}

// One-time migration: installs from before the SecureStore switch have the
// token sitting in plain AsyncStorage under the same key. Checked here too
// (not just AuthContext.restoreSession) so a request firing before that
// migration runs still finds the token instead of silently 401ing.
//
// SecureStore.getItemAsync can itself throw on a real device (Android Keystore
// invalidated by an OS security patch, biometric re-enrollment, some OEM bugs)
// — this used to propagate as a raw native exception straight out of apiFetch,
// bypassing every friendly-message path below. Falls back to the legacy
// AsyncStorage token first (covers the migration-window case). Only if
// SecureStore actually threw AND no legacy token exists either do we treat
// this as an unrecoverable session and force a clean logout+redirect via
// onSessionExpired — a plain guest who was never logged in also has nothing
// in either store, but must NOT be treated as "expired."
async function getStoredToken(): Promise<string | null> {
  let secureStoreFailed = false;
  try {
    const secureToken = await SecureStore.getItemAsync('userToken');
    if (secureToken) return secureToken;
  } catch {
    secureStoreFailed = true;
  }

  const legacyToken = await AsyncStorage.getItem('userToken');
  if (legacyToken) {
    try {
      await SecureStore.setItemAsync('userToken', legacyToken);
      await AsyncStorage.removeItem('userToken');
    } catch {
      // Migration write failed too — still use the legacy token this
      // session; a later successful write will migrate it.
    }
    return legacyToken;
  }

  if (secureStoreFailed) onSessionExpired?.();
  return null;
}

// Memo when known, unless the dev panel asks for the pre-kepler behaviour
// (`Dev_Kepler_inhibit_TokenMemo`, or the Kepler master switch); otherwise the
// storage path above, whose result then primes the memo.
async function resolveToken(): Promise<string | null> {
  const memoInhibited =
    getDevFlag('Dev_Kepler_inhibit_TokenMemo') || getDevFlag('Dev_Kepler_inhibit_Feature');
  if (memoToken !== undefined && !memoInhibited) return memoToken;
  const token = await getStoredToken();
  memoToken = token;
  return token;
}

// ─── apiFetch ─────────────────────────────────────────────────────────────────

/**
 * JSON transport for everything user-owned. Attaches `Content-Type: application/json`
 * and the bearer token (unless `auth: false`), applies the dev network seams,
 * times out after `timeoutMs` (default 30000), and throws an `Error` whose
 * message is user-readable — callers show `err.message`, never re-map it.
 * Status handling (unchanged): 401 → "Session expired…" + the session-expired
 * handler when a token was sent; 403 → the backend message (and the handler
 * when it mentions a suspension); 404 → "Resource not found."; ≥ 500 →
 * SERVER_ERROR_MESSAGE; "Network request failed" → OFFLINE_MESSAGE.
 * `Dev_Network_inhibit_Force500` treats every response as 500 after the real
 * fetch. Every call records `{ method, path, ms, status }` when
 * `Dev_Perf_inhibit_NetworkLog` is on.
 */
export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { timeoutMs = API_TIMEOUT_MS, auth = true, ...init } = options ?? {};
  const apiBase = getApiBase();

  if (!apiBase) {
    throw new Error('API configuration missing. Please contact support.');
  }

  const url = `${apiBase}${path}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const startedAt = Date.now();
  let logStatus: NetworkLogEntry['status'] = 'error';

  try {
    await runDevNetworkSeams();
    const token = auth ? await resolveToken() : null;
    const timeoutOverride = getDevFlag('Dev_Network_inhibit_TimeoutMs');
    const response = await fetchWithTimeout(
      url,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      },
      timeoutOverride > 0 ? timeoutOverride : timeoutMs,
    );

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    const status = getDevFlag('Dev_Network_inhibit_Force500') ? 500 : response.status;
    const ok = status >= 200 && status < 300;
    logStatus = status;

    if (!ok) {
      const body = (data && typeof data === 'object' ? data : {}) as { message?: unknown; error?: unknown };
      const message = String(body.message || body.error || `Request failed (${status})`);

      if (status === 401) {
        // Only treat this as a real session expiry if we actually sent a token —
        // a 401 on a call made with no token at all just means "this needs auth",
        // not "your session died," and shouldn't force-clear/redirect a guest.
        if (token) onSessionExpired?.();
        throw new Error('Session expired. Please log in again.');
      } else if (status === 403) {
        // Previously always overridden with a generic "Access denied" string,
        // discarding whatever the backend actually said — including
        // requireCustomer's real "This account has been suspended." message,
        // which then never reached the user at all. A suspended account
        // 403s on every subsequent authenticated call, so — unlike a one-off
        // "not authorized for this specific resource" 403 — this needs to
        // force a logout the same way an expired session does, otherwise the
        // user stays stuck "logged in," repeatedly hitting the same
        // unexplained error on every action with no way out.
        if (token && message.toLowerCase().includes('suspended')) {
          onSessionExpired?.();
        }
        throw new Error(message);
      } else if (status === 404) {
        throw new Error('Resource not found.');
      } else if (status >= 500) {
        throw new Error(SERVER_ERROR_MESSAGE);
      }

      throw new Error(message);
    }

    return data as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Network request failed')) {
      logStatus = 'offline';
      throw new Error(OFFLINE_MESSAGE);
    }
    if (typeof logStatus !== 'number') {
      logStatus = message === OFFLINE_MESSAGE ? 'offline' : message === TIMEOUT_MESSAGE ? 'timeout' : 'error';
    }
    throw error;
  } finally {
    recordNetworkLog({ method, path, ms: Date.now() - startedAt, status: logStatus });
  }
}
