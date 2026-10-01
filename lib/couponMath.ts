/**
 * Coupon arithmetic shared by the cart and the coupons screen. Plain TS (no
 * React Native imports) so it can be checked outside the app.
 *
 * Must mirror the backend, which decides what is actually charged:
 *  - computeCouponDiscount  ↔ database.service.ts computeCouponDiscount
 *  - couponValidityState    ↔ getActiveCoupons / is_currently_valid
 */
export type CouponKind = "flat" | "percent" | "first_order_discount";

/** 'flat' is rupees off; 'percent' and 'first_order_discount' are a percentage
 *  capped at maxDiscount; always clamped to [0, subtotal]. */
export function computeCouponDiscount(
  coupon: { type: CouponKind; value: number; maxDiscount?: number | null },
  subtotal: number
): number {
  let raw: number;
  if (coupon.type === "flat") {
    raw = coupon.value;
  } else {
    raw = (subtotal * coupon.value) / 100;
    if (coupon.maxDiscount != null) raw = Math.min(raw, coupon.maxDiscount);
  }
  return Math.max(0, Math.min(raw, subtotal));
}

/** Started and not yet ended, as of `now`. */
export function couponValidityState(
  coupon: { valid_from?: string | null; valid_until?: string | null },
  now = Date.now()
): "active" | "expired" | "not_started" {
  if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now) return "not_started";
  if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now) return "expired";
  return "active";
}
