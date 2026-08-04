export const PLATFORM_FEE = 9.5;
export const HANDLING_FEE = 5.5;
// ₹0 always — delivery is free. Was a flat ₹25; see git history to restore.
export const DELIVERY_FEE = 0;
// 5% GST on Platform Fee + Handling Fee, matching the website's FEE_GST_RATE
// (near-and-now/frontend/src/utils/checkoutCalculations.ts) so an identical
// cart totals the same on both platforms.
export const GST_RATE = 0.05;

export function calcDeliveryFee(): number {
  return DELIVERY_FEE;
}

/**
 * Informational-only GST breakdown embedded in PLATFORM_FEE + HANDLING_FEE —
 * shared by the live checkout bill and the read-only order detail/confirmation
 * screens (which reconstruct the same breakdown from an already-placed order,
 * where only subtotal/delivery/discount/tip/total are actually persisted).
 */
export function calcFeeGst(): number {
  const feesGstInclusive = PLATFORM_FEE + HANDLING_FEE;
  return Math.round((feesGstInclusive - feesGstInclusive / (1 + GST_RATE)) * 100) / 100;
}

/**
 * Bill = item total + platform fee + handling charges + delivery fee (₹0).
 * PLATFORM_FEE/HANDLING_FEE are already GST-inclusive final amounts (matching
 * the website's checkoutCalculations.ts, which reverse-extracts GST from the
 * same fixed ₹9.50/₹5.50 rather than adding it) — `gst` below is purely an
 * informational breakdown for display, not an additional charge. Previously
 * this added `gst` on top of the already-inclusive fees too, silently
 * charging GST on the fee portion twice: for a ₹100 cart this billed ₹116
 * here vs. the website's ₹115 for an identical order. Only the **final
 * payable** is rounded to the nearest rupee so the pay button / Razorpay /
 * DB agree on the same integer total.
 */
export function calcOrderTotal(
  subtotal: number,
  totalItems: number,
  distanceKm: number = 2,
  discount = 0,
): {
  platformFee: number;
  handlingFee: number;
  deliveryFee: number;
  gst: number;
  projected: number;
  finalPayable: number;
} {
  const platformFee = PLATFORM_FEE;
  const handlingFee = HANDLING_FEE;
  const deliveryFee = calcDeliveryFee();
  const gst = calcFeeGst();
  const projected = subtotal + platformFee + handlingFee + deliveryFee;
  const finalPayable = Math.round(Math.max(projected - discount, 0));
  return { platformFee, handlingFee, deliveryFee, gst, projected, finalPayable };
}
