export const PLATFORM_FEE = 9.5;
export const HANDLING_FEE = 5.5;
export const DELIVERY_FEE = 25;
// 5% GST is applied only on Platform Fee + Handling Charges.
export const GST_RATE = 0.05;

export function calcDeliveryFee(distanceKm: number): number {
  return DELIVERY_FEE;
}

/**
 * Individual fees stay at their true decimal values (9.5, 5.5, 25, 0.75 …).
 * Only the **final payable** is rounded to the nearest rupee so the customer
 * never sees a paise amount at the pay button and Razorpay / DB agree on the
 * same integer total.
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
  const deliveryFee = calcDeliveryFee(distanceKm);
  const gst = (platformFee + handlingFee) * GST_RATE;
  const projected = subtotal + platformFee + handlingFee + deliveryFee + gst;
  const finalPayable = Math.round(Math.max(projected - discount, 0));
  return { platformFee, handlingFee, deliveryFee, gst, projected, finalPayable };
}
