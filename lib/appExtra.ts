/**
 * Typed access to `Constants.expoConfig.extra` (CONTRACTS §2.24).
 *
 * This is the ONLY place `extra` is cast — and only to `AppExtra`, never to a loose type. Everything
 * else reads `getAppExtra().<key>`. Keys are populated by `app.config.js` from `EXPO_PUBLIC_*` env
 * vars; a key that is unset there arrives as `''` or `undefined`, so callers that need a fallback
 * chain use `||` (an empty string must never win — see `getDevPin()` in lib/devFlags.ts).
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';

export type AppExtra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  googleMapsApiKey?: string;
  sentryDsn?: string;
  devPanelPin?: string;
  supportPhone?: string;
  supportEmail?: string;
  /** 'local' | 'development' | 'preview' | 'production' */
  buildProfile?: string;
  savedMethodsEnabled?: string;
  eas?: { projectId?: string };
};

export type BuildProfile = 'local' | 'development' | 'preview' | 'production';

/** `(Constants.expoConfig?.extra ?? {}) as AppExtra` — the single cast. Always returns an object. */
export function getAppExtra(): AppExtra {
  return (Constants.expoConfig?.extra ?? {}) as AppExtra;
}

/** expo-application reads are null on web and can throw in odd runtimes — never let a version string crash a screen. */
function safeNative(read: () => string | null | undefined): string | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

/**
 * `{ version: expoConfig.version ?? nativeApplicationVersion ?? '—', build: android.versionCode ??
 * nativeBuildVersion ?? '—' }`. Web-safe (both fall through to '—' when nothing is known).
 * Locally today: `{ version: '1.0.1', build: '5' }`.
 */
export function getAppVersion(): { version: string; build: string } {
  const cfg = Constants.expoConfig;
  const version = cfg?.version ?? safeNative(() => Application.nativeApplicationVersion) ?? '—';
  const versionCode = cfg?.android?.versionCode;
  const build =
    versionCode != null ? String(versionCode) : (safeNative(() => Application.nativeBuildVersion) ?? '—');
  return { version, build };
}

/** Normalised from `extra.buildProfile`; anything unknown (including unset) → 'local'. */
export function getBuildProfile(): BuildProfile {
  const raw = getAppExtra().buildProfile;
  switch (raw) {
    case 'development':
    case 'preview':
    case 'production':
      return raw;
    default:
      return 'local';
  }
}
