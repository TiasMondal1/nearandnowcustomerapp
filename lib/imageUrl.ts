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

const CDN_BASE = 'https://cdn.nearandnow.in';

/** Hostnames we trust to already be on a fast, cached CDN. */
const FAST_HOSTS_RE =
  /(^|\.)(grofers\.com|blinkit\.com|cloudflare\.com|cloudfront\.net|akamaihd\.net|akamaized\.net|imagekit\.io|cloudinary\.com|imgix\.net|supabase\.co|supabase\.in|vercel\.app|vercel-storage\.com|nearandnow\.in)$/i;

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

/**
 * Wrap a URL so it's served via our Cloudflare image proxy. Slow / uncached
 * sources become globally cached on first hit.
 *
 * When `width` is provided, hints the worker to return a resized variant so
 * grid thumbnails don't download full-resolution originals (often 5–10× the
 * bytes they'd need at 3-column render size).
 *
 * @example
 * cdnImage('https://thumbs.dreamstime.com/b/bakery.jpg', 240)
 *   // → 'https://cdn.nearandnow.in/?u=<encoded>&w=240'
 *
 * cdnImage('https://cdn.grofers.com/.../tomato.png')
 *   // → 'https://cdn.grofers.com/.../tomato.png'  (already fast, untouched)
 */
export function cdnImage(
  url: string | undefined | null,
  width?: number,
): string | undefined {
  if (!url) return undefined;
  if (isAlreadyFast(url)) return url;
  const base = `${CDN_BASE}/?u=${encodeURIComponent(url)}`;
  return width && Number.isFinite(width) ? `${base}&w=${Math.round(width)}` : base;
}
