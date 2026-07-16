import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const _extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const getApiBase = () =>
  (
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    _extra.apiBaseUrl ||
    'https://near-and-now-backend.vercel.app'
  ).replace(/\/+$/, '');

const API_TIMEOUT_MS = 30000; // 30 seconds

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
      throw new Error('Request timeout. Please check your internet connection and try again.');
    }
    throw error;
  }
}

// Registered by AuthContext on mount so a 401 from ANY apiFetch call — not
// just ones AuthContext itself makes — can clear the stored session and flip
// isAuthenticated immediately, regardless of which screen the user is on.
// Without this, a truly expired session (25 days of inactivity) just threw an
// error on every subsequent call while the app kept believing it was logged in.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

// One-time migration: installs from before the SecureStore switch have the
// token sitting in plain AsyncStorage under the same key. Checked here too
// (not just AuthContext.restoreSession) so a request firing before that
// migration runs still finds the token instead of silently 401ing.
async function getStoredToken(): Promise<string | null> {
  const secureToken = await SecureStore.getItemAsync('userToken');
  if (secureToken) return secureToken;

  const legacyToken = await AsyncStorage.getItem('userToken');
  if (legacyToken) {
    await SecureStore.setItemAsync('userToken', legacyToken);
    await AsyncStorage.removeItem('userToken');
    return legacyToken;
  }

  return null;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getStoredToken();
  const apiBase = getApiBase();

  if (!apiBase) {
    throw new Error('API configuration missing. Please contact support.');
  }

  const url = `${apiBase}${path}`;

  try {
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string> | undefined),
      },
    }, API_TIMEOUT_MS);

    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `Request failed (${response.status})`;

      if (response.status === 401) {
        // Only treat this as a real session expiry if we actually sent a token —
        // a 401 on a call made with no token at all just means "this needs auth",
        // not "your session died," and shouldn't force-clear/redirect a guest.
        if (token) onSessionExpired?.();
        throw new Error('Session expired. Please log in again.');
      } else if (response.status === 403) {
        throw new Error('Access denied. Please contact support.');
      } else if (response.status === 404) {
        throw new Error('Resource not found.');
      } else if (response.status >= 500) {
        throw new Error('Server error. Please try again later.');
      }

      throw new Error(String(message));
    }

    return data as T;
  } catch (error) {
    if ((error as Error).message.includes('Network request failed')) {
      throw new Error('No internet connection. Please check your network and try again.');
    }
    throw error;
  }
}
