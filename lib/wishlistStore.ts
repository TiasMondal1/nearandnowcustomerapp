// codename: halley
// Wishlist store (CONTRACTS §2.9). The list lives in queryCache under QC_KEYS.wishlist
// (userScope → dropped on logout); this module adds the sync membership mirror, per-product
// subscriptions and optimistic POST / DELETE with rollback. Endpoints verified in the tree
// (app/wishlist.tsx): GET /api/wishlist → { success, items }, POST /api/wishlist { productId },
// DELETE /api/wishlist/:productId.
import { apiFetch } from './apiClient';
import { logSilentFailure } from './logSilentFailure';
import type { Product } from './productService';
import { cached, invalidate, peek, QC_KEYS, setCached, subscribe } from './queryCache';

export type WishlistItem = {
  wishlistItemId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  basePrice: number;
  discountedPrice: number;
  unit: string;
  isLoose: boolean;
  gstRate: number | null;
  isActive: boolean;
};

const WISHLIST_KEY = QC_KEYS.wishlist;
const WISHLIST_TTL_MS = 60_000;
const EMPTY: WishlistItem[] = [];

/** Membership mirror of the cached list — kept in step by the module-level subscription below. */
let ids = new Set<string>();
const idSubscribers = new Map<string, Set<() => void>>();

// ─── Internals ──────────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normaliseItem(row: unknown): WishlistItem | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const productId = r.productId != null ? String(r.productId) : '';
  if (!productId) return null;
  const gst = r.gstRate;
  return {
    wishlistItemId: r.wishlistItemId != null ? String(r.wishlistItemId) : productId,
    productId,
    name: typeof r.name === 'string' ? r.name : '',
    imageUrl: typeof r.imageUrl === 'string' && r.imageUrl ? r.imageUrl : null,
    basePrice: toNumber(r.basePrice),
    discountedPrice: toNumber(r.discountedPrice),
    unit: typeof r.unit === 'string' && r.unit ? r.unit : 'piece',
    isLoose: r.isLoose === true,
    gstRate: gst == null || gst === '' ? null : toNumber(gst),
    isActive: r.isActive !== false,
  };
}

function normaliseItems(raw: unknown): WishlistItem[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : [];
  const out: WishlistItem[] = [];
  for (const row of rows) {
    const item = normaliseItem(row);
    if (item) out.push(item);
  }
  return out;
}

function notifyIds(changed: Iterable<string>): void {
  for (const id of changed) {
    const subs = idSubscribers.get(id);
    if (!subs) continue;
    for (const cb of Array.from(subs)) {
      try {
        cb();
      } catch (err) {
        logSilentFailure(`wishlist id subscriber (${id})`, err);
      }
    }
  }
}

/** Rebuilds the membership set from the cache and pings only the products whose membership flipped. */
function syncIds(): void {
  const list = peek<WishlistItem[]>(WISHLIST_KEY);
  const next = new Set<string>();
  if (list) for (const it of list) next.add(it.productId);
  const changed: string[] = [];
  for (const id of next) if (!ids.has(id)) changed.push(id);
  for (const id of ids) if (!next.has(id)) changed.push(id);
  ids = next;
  if (changed.length > 0) notifyIds(changed);
}

// Module-level and never removed: the store must track logout (clearUserScoped) and every
// cached() resolve even when no screen is mounted.
subscribe(WISHLIST_KEY, syncIds);

/** Optimistic row for a product that is not in the server list yet; `discountedPrice` carries the GST-inclusive card price with gstRate null so wishlistItemToProduct reproduces it. */
function syntheticItem(product: { id: string; name: string; image_url?: string; price: number; unit: string; isLoose?: boolean }): WishlistItem {
  return {
    wishlistItemId: `local:${product.id}`,
    productId: product.id,
    name: product.name,
    imageUrl: product.image_url ?? null,
    basePrice: 0,
    discountedPrice: toNumber(product.price),
    unit: product.unit || 'piece',
    isLoose: product.isLoose === true,
    gstRate: null,
    isActive: true,
  };
}

/** After a successful mutation: keep the optimistic list on screen but make the next loadWishlist() reconcile with the server (ttl → 0; cached() restores 60 s on resolve). */
function markStale(): void {
  const current = peek<WishlistItem[]>(WISHLIST_KEY);
  if (current) setCached(WISHLIST_KEY, current, { ttlMs: 0, userScope: true });
}

/**
 * Optimistic writes a GET in flight may not reflect (R1-18). queryCache commits the server
 * list over any setCached made during the flight ("server wins", queryCache.ts:137-143) and
 * `force` dedupes onto that same promise, so the fetcher re-applies these on top of the
 * response instead. A write leaves the list once it has settled AND no GET is in flight: a
 * write settled before a request is sent is already reflected by the server (or failed and
 * was rolled back); one settled during the flight may have raced the request on the server.
 */
type LocalWrite = { productId: string; action: 'add' | 'remove'; item: WishlistItem | null; settled: 'pending' | 'ok' | 'failed' };
let localWrites: LocalWrite[] = [];
let fetchesInFlight = 0;

function pruneSettledWrites(): void {
  if (localWrites.length > 0) localWrites = localWrites.filter((w) => w.settled === 'pending');
}

function settleWrite(write: LocalWrite, outcome: 'ok' | 'failed'): void {
  write.settled = outcome;
  if (fetchesInFlight === 0) pruneSettledWrites();
}

/** Replays the pending / just-settled writes over a server list, oldest first, so the last toggle of a product wins. Returns `list` itself when nothing applies. */
function applyLocalWrites(list: WishlistItem[]): WishlistItem[] {
  let out = list;
  for (const w of localWrites) {
    if (w.settled === 'failed') continue;
    const has = out.some((it) => it.productId === w.productId);
    if (w.action === 'remove') {
      if (has) out = out.filter((it) => it.productId !== w.productId);
    } else if (!has && w.item) {
      out = [w.item, ...out];
    }
  }
  return out;
}

async function fetchWishlist(): Promise<WishlistItem[]> {
  pruneSettledWrites();
  fetchesInFlight += 1;
  try {
    return applyLocalWrites(normaliseItems(await apiFetch<unknown>('/api/wishlist')));
  } finally {
    fetchesInFlight -= 1;
    if (fetchesInFlight === 0) pruneSettledWrites();
  }
}

async function mutate(
  action: 'add' | 'remove',
  product: { id: string; name: string; image_url?: string; price: number; unit: string; isLoose?: boolean } | null,
  productId: string,
): Promise<void> {
  const before = peek<WishlistItem[]>(WISHLIST_KEY);
  const base = before ?? EMPTY;
  const previousItem = base.find((it) => it.productId === productId);

  const optimistic = action === 'remove'
    ? base.filter((it) => it.productId !== productId)
    : previousItem
      ? base
      : [product ? syntheticItem(product) : null, ...base].filter((it): it is WishlistItem => it != null);
  const write: LocalWrite = {
    productId,
    action,
    item: action === 'add' ? previousItem ?? (product ? syntheticItem(product) : null) : null,
    settled: 'pending',
  };
  localWrites.push(write);
  setCached(WISHLIST_KEY, optimistic, { userScope: true });

  try {
    if (action === 'remove') {
      await apiFetch(`/api/wishlist/${encodeURIComponent(productId)}`, { method: 'DELETE' });
    } else {
      await apiFetch('/api/wishlist', { method: 'POST', body: JSON.stringify({ productId }) });
    }
    settleWrite(write, 'ok');
    markStale();
  } catch (err) {
    settleWrite(write, 'failed');
    logSilentFailure(action === 'remove' ? 'Remove from wishlist' : 'Add to wishlist', err);
    // Targeted rollback: only this product's membership, so a concurrent toggle elsewhere survives.
    if (before === undefined) {
      invalidate(WISHLIST_KEY);
      return;
    }
    const current = peek<WishlistItem[]>(WISHLIST_KEY) ?? EMPTY;
    if (action === 'remove') {
      if (previousItem && !current.some((it) => it.productId === productId)) {
        setCached(WISHLIST_KEY, [previousItem, ...current], { userScope: true });
      }
    } else {
      setCached(WISHLIST_KEY, current.filter((it) => it.productId !== productId), { userScope: true });
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * GET /api/wishlist through queryCache (60 s TTL, userScope, in-flight dedupe). `force`
 * skips memory (pull-to-refresh). Rejects with apiFetch's user-readable message so screens
 * can show Retry; memory keeps the previous list on failure.
 */
export function loadWishlist(opts?: { force?: boolean }): Promise<WishlistItem[]> {
  return cached<WishlistItem[]>(WISHLIST_KEY, fetchWishlist, { ttlMs: WISHLIST_TTL_MS, userScope: true, force: opts?.force });
}

/** Sync memory; a stable empty array before the first load (and after logout). */
export function getWishlistItems(): WishlistItem[] {
  return peek<WishlistItem[]>(WISHLIST_KEY) ?? EMPTY;
}

/** `true` once loadWishlist() has resolved (or an optimistic write ran) this session; `false` before the first load and after logout. */
export function isWishlistLoaded(): boolean {
  return peek<WishlistItem[]>(WISHLIST_KEY) !== undefined;
}

/** Sync membership check (O(1)); `false` for everything until the list has loaded. */
export function isWishlisted(productId: string): boolean {
  return ids.has(productId);
}

/**
 * Optimistic toggle: inserts a synthetic row (or removes the product) immediately, then
 * POST /api/wishlist { productId } or DELETE /api/wishlist/:productId. On failure the
 * change is rolled back and logged. Never rejects; resolves the product's membership AFTER
 * the call — i.e. the new state on success, the previous state when the request failed.
 */
export async function toggleWishlist(product: {
  id: string;
  name: string;
  image_url?: string;
  price: number;
  unit: string;
  isLoose?: boolean;
}): Promise<boolean> {
  const wasWishlisted = ids.has(product.id);
  await mutate(wasWishlisted ? 'remove' : 'add', product, product.id);
  return ids.has(product.id);
}

/** Optimistic remove + DELETE /api/wishlist/:productId; rolls back and logs on failure (never rejects). No-op when the product is not wishlisted. */
export async function removeFromWishlist(productId: string): Promise<void> {
  if (!ids.has(productId)) return;
  await mutate('remove', null, productId);
}

/** Fires on every list change (load, optimistic write, rollback, logout). Returns the unsubscribe function. */
export function subscribeWishlist(cb: () => void): () => void {
  return subscribe(WISHLIST_KEY, cb);
}

/** Fires only when `productId`'s membership flips — the per-id channel behind useIsWishlisted. Returns the unsubscribe function. */
export function subscribeWishlistId(productId: string, cb: () => void): () => void {
  let subs = idSubscribers.get(productId);
  if (!subs) {
    subs = new Set();
    idSubscribers.set(productId, subs);
  }
  subs.add(cb);
  return () => {
    const current = idSubscribers.get(productId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) idSubscribers.delete(productId);
  };
}

/** AuthContext.clearStoredSession(): drops the list and the membership mirror, notifying every subscriber. */
export function clearWishlistMemory(): void {
  invalidate(WISHLIST_KEY);
}

/**
 * GST-inclusive Product for ProductCard / Stepper, EXACTLY as app/wishlist.tsx:39-44 priced it:
 * gstRate = isLoose ? 0 : Number(gstRate) || 0; price = discountedPrice + discountedPrice·gst/100;
 * original_price = basePrice > 0 ? basePrice + basePrice·gst/100 : undefined. Remaining fields
 * take the catalog mapper's defaults (unit 'piece', in_stock from isActive, category '').
 */
export function wishlistItemToProduct(item: WishlistItem): Product {
  const gstRate = item.isLoose ? 0 : Number(item.gstRate) || 0;
  const price = item.discountedPrice + (item.discountedPrice * gstRate) / 100;
  const originalPrice = item.basePrice > 0 ? item.basePrice + (item.basePrice * gstRate) / 100 : undefined;
  return {
    id: item.productId,
    name: item.name,
    category: '',
    price,
    original_price: originalPrice,
    image_url: item.imageUrl ?? undefined,
    description: undefined,
    in_stock: item.isActive,
    unit: item.unit || 'piece',
    isLoose: item.isLoose,
    created_at: undefined,
    avgRating: undefined,
    reviewCount: undefined,
  };
}
