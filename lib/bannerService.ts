// codename: deneb
// Optional remote banners (DECISIONS D3: "optional Supabase `banners` table read that fails silently"; D6: no
// schema work, so the table may not exist at all). One bounded select, every row validated before it becomes an
// ImageBanner, and EVERY failure — offline, missing table, malformed rows, the dev network seams — resolves to `[]`
// through logSilentFailure. Never throws, never caches: the Home screen calls this once per mount (and again on
// pull-to-refresh) and merges the result with constants/banners.ts via getActiveBanners(now, [...BANNERS, ...remote]).
import type { Href } from 'expo-router';

import type { Banner, ImageBanner } from '../constants/banners';
import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';
import { supabase } from './supabase';

/** Local banners sort 1–3; remote rows without a sort land after them, in row order. */
const REMOTE_SORT_BASE = 100;
/** accessibilityLabel when a row ships neither `alt` nor `title`. */
const DEFAULT_ALT = 'Promotion';

/**
 * Where a remote banner may navigate. A row may only point INSIDE the app, at one of these routes, with no query or
 * hash and exactly one segment per dynamic slot — anything else (external URLs, auth/payment screens, relative paths,
 * typos) is dropped, so a mistyped or hostile row can never become a navigation.
 */
const STATIC_ALLOWED_HREFS: readonly string[] = ['/(tabs)/categories', '/product/coupons', '/wallet'];
/** `/category/<slug>` and `/product/<id>` — one segment from the RFC 3986 unreserved set. */
const DYNAMIC_ALLOWED_HREF = /^\/(?:category|product)\/[A-Za-z0-9._~-]+$/;

/** The string half of the typed `Href` union — what a validated row narrows to (a type guard, never a cast). */
type RouteHref = Extract<Href, string>;

function isAllowedHref(value: unknown): value is RouteHref {
  if (typeof value !== 'string') return false;
  if (STATIC_ALLOWED_HREFS.includes(value)) return true;
  return DYNAMIC_ALLOWED_HREF.test(value);
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** `sort` / `sort_order` / `display_order`, numeric or numeric string; otherwise after the local banners, in row order. */
function sortOf(row: Row, index: number): number {
  const raw = row.sort ?? row.sort_order ?? row.display_order;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : REMOTE_SORT_BASE + index;
}

/**
 * One row → ImageBanner, or null when it is inactive, has no https `image_url`, no id, or a `href` outside the
 * allowlist. Ids are prefixed so a remote row can never collide with (or override) a local banner id.
 */
function toImageBanner(value: unknown, index: number): ImageBanner | null {
  const row = asRow(value);
  if (!row) return null;
  if (row.is_active === false) return null;

  const image = optionalString(row.image_url);
  if (!image || !/^https:\/\//i.test(image)) return null;

  const href = row.href;
  if (!isAllowedHref(href)) return null;

  const rawId = row.id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  if (!id) return null;

  return {
    kind: 'image',
    id: `remote:${id}`,
    image,
    alt: optionalString(row.alt) ?? optionalString(row.title) ?? DEFAULT_ALT,
    href,
    sort: sortOf(row, index),
    activeFrom: optionalString(row.active_from),
    activeTo: optionalString(row.active_to),
  };
}

/**
 * The optional remote banners: `supabase.from('banners').select('*').limit(10)` mapped to `ImageBanner`s whose
 * hrefs pass the allowlist. Resolves `[]` immediately under `Dev_Deneb_inhibit_RemoteBanners` or
 * `Dev_Deneb_inhibit_Feature`, and `[]` on ANY error (offline, missing table, RLS, parse) after a
 * `logSilentFailure('Remote banners', err)`. Never throws; never caches.
 */
export async function getRemoteBanners(): Promise<Banner[]> {
  if (getDevFlag('Dev_Deneb_inhibit_Feature') || getDevFlag('Dev_Deneb_inhibit_RemoteBanners')) return [];
  try {
    const { data, error } = await supabase.from('banners').select('*').limit(10); // rev. 2 — every select limits (MAP §7.11)
    if (error) throw new Error(error.message);

    const rows: unknown[] = Array.isArray(data) ? data : [];
    const banners: Banner[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const banner = toImageBanner(rows[i], i);
      if (!banner || seen.has(banner.id)) continue;
      seen.add(banner.id);
      banners.push(banner);
    }
    return banners;
  } catch (err) {
    logSilentFailure('Remote banners', err);
    return [];
  }
}
