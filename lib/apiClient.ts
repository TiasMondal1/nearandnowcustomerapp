import AsyncStorage from '@react-native-async-storage/async-storage';

const getApiBase = () =>
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await AsyncStorage.getItem('userToken');
  const url = `${getApiBase()}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      String(data?.message || data?.error || `Request failed (${response.status})`),
    );
  }

  return data as T;
}
