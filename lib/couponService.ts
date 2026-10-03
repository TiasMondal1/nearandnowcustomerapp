// codename: juno
import type { Coupon } from '../context/CartContext';
import { apiFetch } from './apiClient';
import { computeCouponDiscount, couponValidityState, type CouponKind } from './couponMath';
import { cached, peek, QC_KEYS } from './queryCache';

/** Row shape of `GET /api/coupons/active` (DB enum `public.coupon_type`; real column names). */
export type ActiveCoupon = {
  id: string;
  code: string;
  description: string;
  coupon_type: CouponKind;
  discount_value: number;
  max_discount_amount?: number;
  min_order_value?: number;
  valid_from?: string;
  valid_until?: string | null;
};

const COUPONS_TTL_MS = 300_000; // 5 min

function isCouponRow(value: unknown): value is ActiveCoupon {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { coupon_type?: unknown }).coupon_type === 'string'
  );
}

/** The endpoint returns a bare array today; tolerate `{ coupons: [...] }` and drop malformed rows. */
function normaliseCoupons(res: unknown): ActiveCoupon[] {
  const list = Array.isArray(res)
    ? res
    : res && typeof res === 'object' && Array.isArray((res as { coupons?: unknown }).coupons)
      ? ((res as { coupons: unknown[] }).coupons)
      : [];
  return list.filter(isCouponRow).map((c) => ({
    ...c,
    id: String(c.id),
    discount_value: Number(c.discount_value) || 0,
    max_discount_amount: c.max_discount_amount == null ? undefined : Number(c.max_discount_amount),
    min_order_value: c.min_order_value == null ? undefined : Number(c.min_order_value),
  }));
}

async function fetchActiveCoupons(): Promise<ActiveCoupon[]> {
  return normaliseCoupons(await apiFetch<unknown>('/api/coupons/active'));
}

/**
 * Currently active coupons (server-filtered by validity window).
 * `cached(QC_KEYS.coupons, 5 min)`; `force` (pull-to-refresh) skips memory.
 * Rejects on a network error (nothing cached) — the coupons sheet shows Retry.
 */
export async function getActiveCoupons(opts?: { force?: boolean }): Promise<ActiveCoupon[]> {
  return cached<ActiveCoupon[]>(QC_KEYS.coupons, fetchActiveCoupons, {
    ttlMs: COUPONS_TTL_MS,
    force: opts?.force,
  });
}

/** Synchronous memory read (may be stale beyond 5 min); `undefined` before the first fetch. */
export function peekActiveCoupons(): ActiveCoupon[] | undefined {
  return peek<ActiveCoupon[]>(QC_KEYS.coupons);
}

/** API row → `context/CartContext` `Coupon` (`coupon_type → type`, `discount_value → value`, `max_discount_amount → max_discount`). */
export function toCartCoupon(c: ActiveCoupon): Coupon {
  return {
    id: c.id,
    code: c.code,
    type: c.coupon_type,
    value: c.discount_value,
    max_discount: c.max_discount_amount,
    min_order_value: c.min_order_value,
  };
}

function minOrder(c: ActiveCoupon): number {
  return c.min_order_value ?? 0;
}

/**
 * Best coupon for the bill — display only; the backend re-derives the
 * discount (`lib/couponMath.ts` mirror). Considers coupons that are active at
 * `now` (`couponValidityState`) and eligible (`min_order_value <= subtotal`);
 * ranks by `computeCouponDiscount`, largest first, ties → lower min order.
 * `null` when none applies or the discount would be 0.
 */
export function findBestCoupon(
  coupons: ActiveCoupon[],
  subtotal: number,
  now: number = Date.now(),
): { coupon: ActiveCoupon; discount: number } | null {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return null;
  let best: { coupon: ActiveCoupon; discount: number } | null = null;
  for (const c of coupons) {
    if (couponValidityState(c, now) !== 'active') continue;
    if (minOrder(c) > subtotal) continue;
    const discount = computeCouponDiscount(
      { type: c.coupon_type, value: c.discount_value, maxDiscount: c.max_discount_amount ?? null },
      subtotal,
    );
    if (discount <= 0) continue;
    if (
      !best ||
      discount > best.discount ||
      (discount === best.discount && minOrder(c) < minOrder(best.coupon))
    ) {
      best = { coupon: c, discount };
    }
  }
  return best;
}

/** Case-insensitive, trimmed code match; `undefined` for an empty or unknown code. */
export function findCouponByCode(coupons: ActiveCoupon[], code: string): ActiveCoupon | undefined {
  const needle = code.trim().toLowerCase();
  if (!needle) return undefined;
  return coupons.find((c) => c.code.trim().toLowerCase() === needle);
}
