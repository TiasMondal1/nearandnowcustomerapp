/**
 * Image URL helpers.
 *
 * `cdnImage(url)` routes uncached image URLs (random origins like dreamstime.com,
 * unsplash, scraped sources, etc.) through our Cloudflare worker at
 * `cdn.nearandnow.in`. The worker fetches once from the origin, then Cloudflare's
 * global edge cache serves every subsequent request in <10 ms — even on slow Indian
 * 4G networks.
 *
 * URLs that are *already* on a fast CDN (Cloudflare Images, Supabase Storage,
 * Vercel image optimization, etc.) are returned as-is — no wasteful double-proxy.
 */

import { Image } from 'expo-image';
import { PixelRatio, Platform } from 'react-native';

import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';

const CDN_BASE = 'https://cdn.nearandnow.in';

/** Hostnames we trust to already be on a fast, cached CDN. */
const FAST_HOSTS_RE =
  /(^|\.)(grofers\.com|blinkit\.com|cloudflare\.com|cloudfront\.net|akamaihd\.net|akamaized\.net|imagekit\.io|cloudinary\.com|imgix\.net|supabase\.co|supabase\.in|vercel\.app|vercel-storage\.com|nearandnow\.in)$/i;

/**
 * Device pixel ratio used for the width hint, capped at 2: a 3× phone gets
 * the same bytes as a 2× one — the extra density is invisible on a 100 px
 * thumbnail and costs 2.25× the download (kepler, 2026-10-03).
 */
const DPR_CAP = 2;
const dprScale: number = (() => {
  try {
    return Math.min(PixelRatio.get(), DPR_CAP);
  } catch {
    return 1;
  }
})();

// Bounded memo: the Home feed asks for the same ~100 URLs on every render of
// every cell; `new URL()` + encodeURIComponent per call is measurable on
// mid-range Android. Keyed by `${url}|${width}` (the DPR is constant per
// device so it is not part of the key). Oldest entries are evicted beyond
// MEMO_MAX using Map insertion order.
const MEMO_MAX = 500;
const memo = new Map<string, string>();

/** Returns true for relative paths, data URIs, and known-fast CDN hosts. */
function isAlreadyFast(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('data:') || url.startsWith('file:')) return true;
  if (!url.startsWith('http')) return true;
  try {
    const u = new URL(url);
    return FAST_HOSTS_RE.test(u.hostname);
  } catch {
    return true;
  }
}

function buildCdnUrl(url: string, width?: number): string {
  if (isAlreadyFast(url)) return url;
  const base = `${CDN_BASE}/?u=${encodeURIComponent(url)}`;
  if (!width || !Number.isFinite(width) || width <= 0) return base;
  return `${base}&w=${Math.round(width * dprScale)}`;
}

/**
 * Wrap a URL so it's served via our Cloudflare image proxy. Slow / uncached
 * sources become globally cached on first hit.
 *
 * When `width` is provided, hints the worker to return a resized variant so
 * grid thumbnails don't download full-resolution originals (often 5–10× the
 * bytes they'd need at 3-column render size). The hint is the RENDERED width
 * in dp; it is multiplied by `min(PixelRatio.get(), 2)` here, so callers pass
 * layout numbers (e.g. 120 for a grid tile, 400 for a hero), not pre-scaled ones.
 *
 * Memoised (bounded Map, 500 entries). Under `Dev_Images_inhibit_CdnProxy` the
 * raw origin URL is returned unchanged (and not memoised).
 *
 * @example
 * cdnImage('https://thumbs.dreamstime.com/b/bakery.jpg', 120)
 *   // → 'https://cdn.nearandnow.in/?u=<encoded>&w=240'   (on a 2× device)
 *
 * cdnImage('https://cdn.grofers.com/.../tomato.png')
 *   // → 'https://cdn.grofers.com/.../tomato.png'  (already fast, untouched)
 */
export function cdnImage(
  url: string | undefined | null,
  width?: number,
): string | undefined {
  if (!url) return undefined;
  if (getDevFlag('Dev_Images_inhibit_CdnProxy')) return url;

  const key = `${url}|${width ?? ''}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const out = buildCdnUrl(url, width);
  memo.set(key, out);
  if (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return out;
}

/**
 * Warms expo-image's memory-disk cache for a batch of product images (boot:
 * the first 9 Home tiles; press-in: a product's hero) at the given rendered
 * width. Fire-and-forget: never awaited, failures go to logSilentFailure.
 * No-op on web and under `Dev_Images_inhibit_Prefetch`.
 */
export function prefetchImages(urls: (string | undefined)[], width: number): void {
  if (Platform.OS === 'web') return;
  if (getDevFlag('Dev_Images_inhibit_Prefetch')) return;

  const resolved: string[] = [];
  for (const url of urls) {
    const cdn = cdnImage(url, width);
    if (cdn) resolved.push(cdn);
  }
  if (resolved.length === 0) return;

  Image.prefetch(resolved, { cachePolicy: 'memory-disk' }).catch((err) =>
    logSilentFailure('Prefetch images', err),
  );
}
