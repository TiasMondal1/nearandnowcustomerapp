// codename: kepler
// Module-store cart (kepler) with feedback inside the mutations (sirius).
// `useCart()` / `useCartQty()` are `useSyncExternalStore` facades over the
// store below; `CartProvider` keeps only the logout-clear effect. Hydration
// is `loadCartStore()` at app/_layout.tsx module scope.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { computeCouponDiscount, type CouponKind } from '../lib/couponMath';
import { getDevFlag, subscribeDevFlags } from '../lib/devFlags';
import { feedback } from '../lib/feedback';
import { logSilentFailure } from '../lib/logSilentFailure';
import { useAuth } from './AuthContext';

const CART_STORAGE_KEY = 'nn_cart_items';
const COUPON_STORAGE_KEY = 'nn_cart_coupon';
/** Persisted envelope `{ version: 2, items }`; a bare array is the legacy v1 payload and still hydrates. */
const CART_PAYLOAD_VERSION = 2;
/** Debounce for the AsyncStorage write after a mutation; flushed early on AppState → background. */
const PERSIST_DEBOUNCE_MS = 200;
const LOOSE_STEP = 0.25;

// Client-side ceiling only — the backend independently enforces each
// product's own master_products.min_quantity/max_quantity at order-creation
// time, which is the real security boundary. This is just so the cart itself
// can never be pushed to an absurd quantity in the UI.
export const MAX_QUANTITY_PER_ITEM = 99;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CartItem = {
  product_id: string;
  name: string;
  price: number;
  unit?: string;
  image_url?: string;
  quantity: number;
  // Loose/weighed products (e.g. produce sold by weight) step in 0.25 kg
  // increments instead of whole units — matches the website cart and the
  // backend's own validateQuantity(), which now accepts fractional
  // quantities for these products.
  isLoose?: boolean;
};

export type Coupon = {
  id: string;
  code: string;
  // Matches the DB enum public.coupon_type.
  type: CouponKind;
  value: number;
  max_discount?: number;
  min_order_value?: number;
};

/** `silent` = no haptic/sound for this mutation (batch mutations, undo restores, hydration). */
export type CartMutationOptions = { silent?: boolean };
export type AddResult = 'added' | 'incremented' | 'max';
export type IncrementResult = 'ok' | 'removed' | 'max' | 'missing';
export type PriceDrift = { product_id: string; name: string; oldPrice: number; newPrice: number };

export type CartSnapshot = {
  items: CartItem[];
  isHydrated: boolean;
  subtotal: number;
  /** Sum of quantities (a loose line counts as 1) — what badges and the CartBar show. */
  totalQty: number;
  /** Distinct lines. */
  itemCount: number;
  appliedCoupon: Coupon | null;
  discount: number;
  // False once the cart's subtotal drops below the applied coupon's own
  // min_order_value (e.g. after removing an item) — the coupon stays
  // "applied" so the customer can top the cart back up and reclaim it, but
  // discount is 0 and coupon_id is withheld from order placement while this
  // is false.
  isCouponEligible: boolean;
  /** ms timestamp of the last USER mutation; 0 until the first one (CartBar bounce guard — hydration/logout don't count). */
  lastUserMutationAt: number;
};

export type CartActions = {
  /** First add → quantity = step (0.25 loose / 1 unit); existing line → +step. `isLoose` MUST be passed by callers. Plays `add` unless silent; 'max' plays nothing. */
  addItem(item: Omit<CartItem, 'quantity'>, opts?: CartMutationOptions): AddResult;
  /** One commit, one persist. `quantity` (when given) is ADDED to an existing line or used as the new line's quantity; lines already at 99 are skipped. Silent unless `{ silent: false }`. */
  addMany(items: (Omit<CartItem, 'quantity'> & { quantity?: number })[], opts?: CartMutationOptions): { added: number; skipped: number };
  /** Returns the removed line (for Undo) or null when absent. Plays `remove` unless silent. */
  removeItem(productId: string, opts?: CartMutationOptions): CartItem | null;
  /** Undo for removeItem: re-inserts with its own quantity (clamped to 99; replaces the line if it exists). Silent unless `{ silent: false }` (then `add`). */
  restoreItem(item: CartItem, opts?: CartMutationOptions): void;
  /** Absolute quantity (callers computing from a render snapshot); ≤ 0 removes; clamped to 99. Silent unless `{ silent: false }`. */
  updateQty(productId: string, qty: number, opts?: CartMutationOptions): void;
  /** ±one step, step read from the stored line's `isLoose`; MAX 99; reaching ≤ 0 removes. +1 plays `add`, −1 plays `remove` (unless silent); 'max'/'missing' play nothing. */
  incrementQty(productId: string, direction: 1 | -1, opts?: CartMutationOptions): IncrementResult;
  /** Empties items + coupon; returns the previous `{ items, coupon }` for Undo. Plays `remove` once unless silent (nothing when already empty). */
  clearCart(opts?: CartMutationOptions): { items: CartItem[]; coupon: Coupon | null };
  /** Undo for clearCart: restores both in one commit. Silent unless `{ silent: false }`. */
  restoreCart(items: CartItem[], coupon?: Coupon | null, opts?: CartMutationOptions): void;
  applyCoupon(coupon: Coupon): void;
  removeCoupon(): void;
  /**
   * Checkout-mount price revalidation: `lookup(product_id)` returns the catalog
   * price (or undefined = unknown, left alone). Lines differing by ≥ ₹0.01 are
   * updated in ONE silent commit and returned as the drift list.
   * `Dev_Checkout_inhibit_PriceDrift` REPORTS +₹1 on the first line (drift
   * entry only — the stored price is never changed, so repeated checkout
   * focuses cannot compound it); no-op under `Dev_Kepler_inhibit_Feature`.
   */
  revalidatePrices(lookup: (productId: string) => number | undefined): PriceDrift[];
};

// ─── Module store ─────────────────────────────────────────────────────────────

let items: CartItem[] = [];
let coupon: Coupon | null = null;
let hydrated = false;
let lastUserMutationAt = 0;
/** product_id → quantity; the per-product subscription reads this, never `items`. */
const qtyIndex = new Map<string, number>();
const globalListeners = new Set<() => void>();
const qtyListeners = new Map<string, Set<() => void>>();
const EMPTY_ITEMS: CartItem[] = [];

function stepFor(isLoose: boolean | undefined): number {
  return isLoose ? LOOSE_STEP : 1;
}

/** Round off float drift from repeated 0.25 addition/subtraction. */
function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

function clampQty(qty: number): number {
  return Math.min(qty, MAX_QUANTITY_PER_ITEM);
}

function buildSnapshot(): CartSnapshot {
  let subtotal = 0;
  let totalQty = 0;
  for (const line of items) {
    subtotal += line.price * line.quantity;
    totalQty += line.isLoose ? 1 : line.quantity;
  }
  const isCouponEligible = coupon
    ? !coupon.min_order_value || subtotal >= coupon.min_order_value
    : false;
  // Mirrors the backend's computeCouponDiscount (database.service.ts), which
  // sets the amount actually charged: 'flat' is rupees off; 'percent' and
  // 'first_order_discount' are both a percentage capped at max_discount; the
  // result is always clamped to [0, subtotal]. 'first_order_discount' used to
  // fall through to `return 0`, so the cart showed no discount and the full
  // total while checkout charged the discounted amount. (2026-10-02, found
  // while fixing audit C2.)
  const discount =
    coupon && isCouponEligible
      ? computeCouponDiscount(
          { type: coupon.type, value: coupon.value, maxDiscount: coupon.max_discount },
          subtotal,
        )
      : 0;
  return {
    items,
    isHydrated: hydrated,
    subtotal,
    totalQty,
    itemCount: items.length,
    appliedCoupon: coupon,
    discount,
    isCouponEligible,
    lastUserMutationAt,
  };
}

/** Rebuilt ONLY inside commit() so getCartSnapshot() is referentially stable between commits (useSyncExternalStore requirement). */
let snapshot: CartSnapshot = buildSnapshot();
/** Memoised empty view for Dev_Cart_inhibit_SimulateEmpty; invalidated on every commit and on the flag flip. */
let emptySnapshot: CartSnapshot | null = null;

function notifyQty(productId: string): void {
  const set = qtyListeners.get(productId);
  if (!set) return;
  for (const cb of Array.from(set)) cb();
}

function notifyAllQty(): void {
  for (const set of Array.from(qtyListeners.values())) {
    for (const cb of Array.from(set)) cb();
  }
}

function notifyGlobal(): void {
  for (const cb of Array.from(globalListeners)) cb();
}

/**
 * The single write path. Diffs `qtyIndex` against `nextItems` and notifies only
 * the changed product ids, rebuilds the snapshot, notifies global listeners,
 * then schedules the debounced persist (unless `persist: false`).
 */
function commit(
  nextItems: CartItem[],
  nextCoupon: Coupon | null,
  opts: { user: boolean; persist?: boolean },
): void {
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const line of nextItems) {
    seen.add(line.product_id);
    if (qtyIndex.get(line.product_id) !== line.quantity) {
      qtyIndex.set(line.product_id, line.quantity);
      changed.push(line.product_id);
    }
  }
  for (const id of Array.from(qtyIndex.keys())) {
    if (!seen.has(id)) {
      qtyIndex.delete(id);
      changed.push(id);
    }
  }

  items = nextItems;
  coupon = nextCoupon;
  if (opts.user) lastUserMutationAt = Date.now();
  snapshot = buildSnapshot();
  emptySnapshot = null;

  for (const id of changed) notifyQty(id);
  notifyGlobal();
  if (opts.persist !== false) schedulePersist();
}

// ─── Persistence (debounced, flushed on background) ───────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscribed = false;

function flushPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!hydrated) return;
  if (getDevFlag('Dev_Cart_inhibit_Persist')) return;

  AsyncStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({ version: CART_PAYLOAD_VERSION, items }),
  ).catch((err) => logSilentFailure('Persist cart', err));

  if (coupon) {
    AsyncStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(coupon)).catch((err) =>
      logSilentFailure('Persist applied coupon', err),
    );
  } else {
    AsyncStorage.removeItem(COUPON_STORAGE_KEY).catch((err) =>
      logSilentFailure('Clear persisted coupon', err),
    );
  }
}

// One listener per module, added lazily on the first scheduled write so the
// module has no import-time side effects.
function ensureAppStateListener(): void {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state: AppStateStatus) => {
    if ((state === 'background' || state === 'inactive') && persistTimer) flushPersist();
  });
}

// Debounced 200 ms: a stepper tap burst is one write, not one per tick
// (MAP P27). Not scheduled before hydration (nothing to overwrite yet — the
// pre-hydration mutation is persisted by loadCartStore once it resolves).
function schedulePersist(): void {
  if (!hydrated) return;
  if (getDevFlag('Dev_Cart_inhibit_Persist')) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
  ensureAppStateListener();
}

// Logout clear (rev. 2): cancel the pending debounced write FIRST, then commit
// the empty cart silently with persistence suppressed, then remove the keys —
// a 200 ms write must never re-create `nn_cart_items` after logout. Kept in
// one place so the order is enforced.
function clearForLogout(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  commit([], null, { user: false, persist: false });
  AsyncStorage.multiRemove([CART_STORAGE_KEY, COUPON_STORAGE_KEY]).catch((err) =>
    logSilentFailure('Clear persisted cart on logout', err),
  );
}

// ─── Dev flag: Dev_Cart_inhibit_SimulateEmpty ─────────────────────────────────

let devFlagsSubscribed = false;
let lastSimulateEmpty = false;

function ensureDevFlagSubscription(): void {
  if (devFlagsSubscribed) return;
  devFlagsSubscribed = true;
  lastSimulateEmpty = getDevFlag('Dev_Cart_inhibit_SimulateEmpty');
  subscribeDevFlags(() => {
    const now = getDevFlag('Dev_Cart_inhibit_SimulateEmpty');
    if (now === lastSimulateEmpty) return;
    lastSimulateEmpty = now;
    emptySnapshot = null;
    notifyAllQty();
    notifyGlobal();
  });
}

// ─── Hydration ────────────────────────────────────────────────────────────────

function sanitizeItem(raw: unknown): CartItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.product_id !== 'string' || !r.product_id) return null;
  if (typeof r.name !== 'string') return null;
  const price = typeof r.price === 'number' ? r.price : Number(r.price);
  const quantity = typeof r.quantity === 'number' ? r.quantity : Number(r.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) return null;
  const line: CartItem = {
    product_id: r.product_id,
    name: r.name,
    price,
    quantity: clampQty(roundQty(quantity)),
  };
  if (typeof r.unit === 'string') line.unit = r.unit;
  if (typeof r.image_url === 'string') line.image_url = r.image_url;
  if (typeof r.isLoose === 'boolean') line.isLoose = r.isLoose;
  return line;
}

function parseStoredItems(raw: string | null): CartItem[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  const list: unknown = Array.isArray(parsed)
    ? parsed // legacy v1: a bare array
    : parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === CART_PAYLOAD_VERSION
      ? (parsed as { items?: unknown }).items
      : [];
  if (!Array.isArray(list)) return [];
  const out: CartItem[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const line = sanitizeItem(entry);
    if (line && !seen.has(line.product_id)) {
      seen.add(line.product_id);
      out.push(line);
    }
  }
  return out;
}

function parseStoredCoupon(raw: string | null): Coupon | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.code !== 'string' || typeof r.type !== 'string') return null;
  if (typeof r.value !== 'number') return null;
  const out: Coupon = { id: r.id, code: r.code, type: r.type as CouponKind, value: r.value };
  if (typeof r.max_discount === 'number') out.max_discount = r.max_discount;
  if (typeof r.min_order_value === 'number') out.min_order_value = r.min_order_value;
  return out;
}

let loadPromise: Promise<void> | null = null;

/**
 * Idempotent hydrate from `nn_cart_items` (v2 envelope `{ version: 2, items }`
 * or the legacy v1 array) + `nn_cart_coupon`. Call once at app/_layout.tsx
 * module scope. A user mutation that lands before the read resolves is MERGED
 * with the stored cart: in-memory lines win on conflict, stored lines absent
 * from memory are kept (never silently dropped), and the in-memory coupon wins
 * when set. Never rejects; `isHydrated` flips true either way.
 */
export function loadCartStore(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let storedItems: CartItem[] = [];
    let storedCoupon: Coupon | null = null;
    try {
      const pairs = await AsyncStorage.multiGet([CART_STORAGE_KEY, COUPON_STORAGE_KEY]);
      const byKey = new Map(pairs);
      storedItems = parseStoredItems(byKey.get(CART_STORAGE_KEY) ?? null);
      storedCoupon = parseStoredCoupon(byKey.get(COUPON_STORAGE_KEY) ?? null);
    } catch (err) {
      logSilentFailure('Hydrate cart', err);
    }
    hydrated = true;
    if (lastUserMutationAt > 0) {
      // Something was added before the disk read came back — merge rather
      // than let it replace the stored cart (R1-21): stored order first with
      // the in-memory line winning on conflict, then the lines that only
      // exist in memory. Written out now that persistence is allowed.
      const inMemory = new Map(items.map((line) => [line.product_id, line] as const));
      const merged: CartItem[] = storedItems.map((stored) => inMemory.get(stored.product_id) ?? stored);
      const storedIds = new Set(storedItems.map((line) => line.product_id));
      for (const line of items) if (!storedIds.has(line.product_id)) merged.push(line);
      commit(merged, coupon ?? storedCoupon, { user: false });
    } else {
      commit(storedItems, storedCoupon, { user: false, persist: false });
    }
    ensureDevFlagSubscription();
  })();
  return loadPromise;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Stable reference between commits. Under `Dev_Cart_inhibit_SimulateEmpty` an (also stable) empty view; the persisted cart is untouched. */
export function getCartSnapshot(): CartSnapshot {
  if (getDevFlag('Dev_Cart_inhibit_SimulateEmpty')) {
    if (!emptySnapshot) {
      emptySnapshot = {
        items: EMPTY_ITEMS,
        isHydrated: hydrated,
        subtotal: 0,
        totalQty: 0,
        itemCount: 0,
        appliedCoupon: null,
        discount: 0,
        isCouponEligible: false,
        lastUserMutationAt,
      };
    }
    return emptySnapshot;
  }
  return snapshot;
}

/** Sync quantity for one product (0 when absent or under `Dev_Cart_inhibit_SimulateEmpty`). */
export function getCartQty(productId: string): number {
  if (getDevFlag('Dev_Cart_inhibit_SimulateEmpty')) return 0;
  return qtyIndex.get(productId) ?? 0;
}

function getTotalQty(): number {
  return getCartSnapshot().totalQty;
}

/** Fires after every commit (any line, coupon, hydration) and on the SimulateEmpty flag flip. */
export function subscribeCart(cb: () => void): () => void {
  ensureDevFlagSubscription();
  globalListeners.add(cb);
  return () => {
    globalListeners.delete(cb);
  };
}

/** Fires only when THIS product's quantity changes (or the SimulateEmpty flag flips). */
export function subscribeCartQty(productId: string, cb: () => void): () => void {
  ensureDevFlagSubscription();
  let set = qtyListeners.get(productId);
  if (!set) {
    set = new Set();
    qtyListeners.set(productId, set);
  }
  set.add(cb);
  return () => {
    const current = qtyListeners.get(productId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) qtyListeners.delete(productId);
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

function findLine(productId: string): CartItem | undefined {
  return items.find((p) => p.product_id === productId);
}

function withoutLine(list: CartItem[], productId: string): CartItem[] {
  return list.filter((p) => p.product_id !== productId);
}

function withQuantity(list: CartItem[], productId: string, quantity: number): CartItem[] {
  return list.map((p) => (p.product_id === productId ? { ...p, quantity } : p));
}

/** Module-level, identity-stable — usable from lib/, screens and hosts without a hook. */
export const cartActions: CartActions = {
  addItem(item, opts) {
    const existing = findLine(item.product_id);
    const step = stepFor(item.isLoose);
    let result: AddResult;
    let next: CartItem[];
    if (existing) {
      if (existing.quantity >= MAX_QUANTITY_PER_ITEM) return 'max';
      next = withQuantity(items, item.product_id, clampQty(roundQty(existing.quantity + step)));
      result = 'incremented';
    } else {
      next = [...items, { ...item, quantity: step }];
      result = 'added';
    }
    commit(next, coupon, { user: true });
    if (!opts?.silent) feedback.add();
    return result;
  },

  addMany(list, opts) {
    let next = items;
    let added = 0;
    let skipped = 0;
    for (const entry of list) {
      const { quantity, ...rest } = entry;
      const step = stepFor(rest.isLoose);
      const wanted = quantity != null && Number.isFinite(quantity) && quantity > 0 ? quantity : step;
      const existing = next.find((p) => p.product_id === rest.product_id);
      if (existing) {
        if (existing.quantity >= MAX_QUANTITY_PER_ITEM) {
          skipped += 1;
          continue;
        }
        next = withQuantity(next, rest.product_id, clampQty(roundQty(existing.quantity + wanted)));
      } else {
        next = [...next, { ...rest, quantity: clampQty(roundQty(wanted)) }];
      }
      added += 1;
    }
    if (added > 0) {
      commit(next, coupon, { user: true });
      if (opts?.silent === false) feedback.add();
    }
    return { added, skipped };
  },

  removeItem(productId, opts) {
    const line = findLine(productId) ?? null;
    if (!line) return null;
    commit(withoutLine(items, productId), coupon, { user: true });
    if (!opts?.silent) feedback.remove();
    return line;
  },

  restoreItem(item, opts) {
    const quantity = clampQty(roundQty(item.quantity));
    if (!(quantity > 0)) return;
    const restored: CartItem = { ...item, quantity };
    const next = findLine(item.product_id)
      ? items.map((p) => (p.product_id === item.product_id ? restored : p))
      : [...items, restored];
    commit(next, coupon, { user: true });
    if (opts?.silent === false) feedback.add();
  },

  updateQty(productId, qty, opts) {
    const existing = findLine(productId);
    if (!existing) return;
    if (qty <= 0) {
      commit(withoutLine(items, productId), coupon, { user: true });
      if (opts?.silent === false) feedback.remove();
      return;
    }
    const clampedQty = clampQty(qty);
    if (clampedQty === existing.quantity) return;
    commit(withQuantity(items, productId, clampedQty), coupon, { user: true });
    if (opts?.silent === false) {
      if (clampedQty > existing.quantity) feedback.add();
      else feedback.remove();
    }
  },

  // Unlike updateQty (which sets an absolute value the caller computed from
  // a render-time snapshot — safe for direct numeric input, but racy for
  // +/- steppers, where two taps landing before a re-render both compute
  // the same target from the same stale quantity), this reads the current
  // quantity from the module store at call time, so N rapid taps always net
  // exactly N regardless of React's batching/render timing.
  //
  // `direction` is a sign, not a magnitude — every call site passes ±1 to
  // mean "one step up/down." The actual step size (0.25 kg for loose
  // products, matching the website cart and the backend's own
  // validateQuantity(); 1 unit otherwise) is resolved here from the item's
  // own isLoose flag, so callers don't need to know or care about it.
  incrementQty(productId, direction, opts) {
    const existing = findLine(productId);
    if (!existing) return 'missing';
    const step = stepFor(existing.isLoose);
    if (direction > 0 && existing.quantity >= MAX_QUANTITY_PER_ITEM) return 'max';
    const rounded = roundQty(existing.quantity + Math.sign(direction) * step);
    let result: IncrementResult;
    let next: CartItem[];
    if (rounded <= 0) {
      next = withoutLine(items, productId);
      result = 'removed';
    } else {
      next = withQuantity(items, productId, clampQty(rounded));
      result = 'ok';
    }
    commit(next, coupon, { user: true });
    if (!opts?.silent) {
      if (direction > 0) feedback.add();
      else feedback.remove();
    }
    return result;
  },

  clearCart(opts) {
    const previous = { items, coupon };
    if (items.length === 0 && !coupon) return previous;
    commit([], null, { user: true });
    if (!opts?.silent) feedback.remove();
    return previous;
  },

  restoreCart(list, restoredCoupon, opts) {
    const next: CartItem[] = [];
    const seen = new Set<string>();
    for (const line of list) {
      const quantity = clampQty(roundQty(line.quantity));
      if (!(quantity > 0) || seen.has(line.product_id)) continue;
      seen.add(line.product_id);
      next.push({ ...line, quantity });
    }
    commit(next, restoredCoupon ?? null, { user: true });
    if (opts?.silent === false && next.length > 0) feedback.add();
  },

  applyCoupon(nextCoupon) {
    commit(items, nextCoupon, { user: true });
  },

  removeCoupon() {
    if (!coupon) return;
    commit(items, null, { user: true });
  },

  revalidatePrices(lookup) {
    if (getDevFlag('Dev_Kepler_inhibit_Feature')) return [];
    const fakeDrift = getDevFlag('Dev_Checkout_inhibit_PriceDrift');
    const drifts: PriceDrift[] = [];
    let changed = false;
    const next = items.map((line, index) => {
      if (fakeDrift && index === 0) {
        // Report-only simulation (R2-09): surface the row, leave the line —
        // and therefore the persisted cart — untouched.
        const fakePrice = Math.round((line.price + 1) * 100) / 100;
        drifts.push({ product_id: line.product_id, name: line.name, oldPrice: line.price, newPrice: fakePrice });
        return line;
      }
      const newPrice = lookup(line.product_id);
      if (
        newPrice !== undefined &&
        Number.isFinite(newPrice) &&
        Math.abs(newPrice - line.price) >= 0.01
      ) {
        drifts.push({ product_id: line.product_id, name: line.name, oldPrice: line.price, newPrice });
        changed = true;
        return { ...line, price: newPrice };
      }
      return line;
    });
    if (changed) commit(next, coupon, { user: false });
    return drifts;
  },
};

// ─── Provider (logout clear only) ─────────────────────────────────────────────

/**
 * Keeps ONLY the logout-clear effect. Hydration is `loadCartStore()` at
 * app/_layout.tsx module scope; reads go through the hooks below.
 */
export function CartProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Clears the cart on a genuine logout (true -> false transition only, not
  // on initial mount while auth is still restoring) — otherwise a shared/
  // reused device keeps showing the previous customer's cart to whoever
  // logs in next. CartProvider is rendered inside AuthProvider (see
  // app/_layout.tsx), so this is safe with no circular-dependency issue.
  // Silent: a logout is not a cart gesture, so no haptic/sound.
  const { isAuthenticated } = useAuth();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
    } else if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      clearForLogout();
    }
  }, [isAuthenticated]);

  return <>{children}</>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Whole-cart snapshot + the identity-stable actions. Re-renders on every commit — list cells use `useCartQty` instead. */
export function useCart(): CartSnapshot & CartActions {
  const snap = useSyncExternalStore(subscribeCart, getCartSnapshot, getCartSnapshot);
  return useMemo(() => ({ ...snap, ...cartActions }), [snap]);
}

/** One product's quantity; the component re-renders only when THAT quantity changes (MAP P1 / F-CARTQTY). */
export function useCartQty(productId: string): number {
  const subscribe = useCallback((cb: () => void) => subscribeCartQty(productId, cb), [productId]);
  const read = useCallback(() => getCartQty(productId), [productId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** `totalQty` (loose lines count as 1) — badges and the CartBar. */
export function useCartCount(): number {
  return useSyncExternalStore(subscribeCart, getTotalQty, getTotalQty);
}

/**
 * Lightweight selector hook: returns a Map of product_id → cart item. Kept for
 * non-list consumers; NEVER put it in a renderItem dependency list (a new Map
 * per cart change would re-render every cell — MAP P1). Cells use useCartQty.
 */
export function useCartItemMap(): Map<string, CartItem> {
  const { items: current } = useSyncExternalStore(subscribeCart, getCartSnapshot, getCartSnapshot);
  return useMemo(() => {
    const m = new Map<string, CartItem>();
    for (const it of current) m.set(it.product_id, it);
    return m;
  }, [current]);
}
