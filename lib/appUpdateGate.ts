/**
 * "Please update the app" (2026-11-17). The server can ask installs below a build number to update: the
 * `app_min_versions` row for `customer` (public read; 0 asks no one). Needed because loose items sell at a daily
 * area price that builds from before 2026-11-17 can't show, so their checkout is refused once that price is above
 * the catalogue price.
 *
 * Fails open: an unknown build number (web, Expo Go), a failed or slow read, or a missing row never blocks the app.
 */
import { getNativeBuildNumber } from './appExtra';
import { supabase } from './supabase';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nearandnow.customer';
export const DEFAULT_UPDATE_MESSAGE =
  'This version of Near & Now is out of date. Please update to keep ordering with the latest prices.';

export type UpdateRequirement = { required: false } | { required: true; message: string; storeUrl: string };

type MinVersionRow = { min_build: number | null; message: string | null; store_url: string | null };

/** Pure decision, for tests: below the minimum build → update. */
export function decideUpdate(build: number | null, row: MinVersionRow | null): UpdateRequirement {
  if (build == null || !row) return { required: false };
  const min = Number(row.min_build);
  if (!Number.isInteger(min) || min <= 0 || build >= min) return { required: false };
  return {
    required: true,
    message: row.message?.trim() || DEFAULT_UPDATE_MESSAGE,
    storeUrl: row.store_url?.trim() || PLAY_STORE_URL,
  };
}

const READ_TIMEOUT_MS = 8000;

/** Reads this app's minimum build and decides. Never throws. */
export async function checkAppUpdate(build: number | null = getNativeBuildNumber()): Promise<UpdateRequirement> {
  if (build == null) return { required: false };
  try {
    const read = supabase
      .from('app_min_versions')
      .select('min_build, message, store_url')
      .eq('app', 'customer')
      .maybeSingle();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS));
    const result = await Promise.race([read, timeout]);
    if (!result || result.error) return { required: false };
    return decideUpdate(build, (result.data as MinVersionRow | null) ?? null);
  } catch {
    return { required: false };
  }
}
