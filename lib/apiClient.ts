import AsyncStorage from '@react-native-async-storage/async-storage';

const getApiBase = () =>
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

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

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await AsyncStorage.getItem('userToken');
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
