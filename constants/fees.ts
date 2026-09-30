export const PLATFORM_FEE = 9.5;
export const HANDLING_FEE = 5.5;
// ₹0 always — delivery is free. Was a flat ₹25; see git history to restore.
export const DELIVERY_FEE = 0;
// Display-only "was" price shown struck through next to "FREE" on the delivery-fee
// bill row — a promotional framing choice, not a second real charge. The actual
// fee charged is always DELIVERY_FEE (₹0) regardless of this value.
export const DELIVERY_FEE_WAS = 20;

export function calcDeliveryFee(): number {
  return DELIVERY_FEE;
}

/**
 * Bill = item total + platform fee + handling charges + delivery fee (₹0).
 * No separate GST line is shown or charged — GST is not broken out on the
 * bill at all, matching the website's checkout, which never displayed one
 * either. Only the **final payable** is rounded to the nearest rupee so the
 * pay button / Razorpay / DB agree on the same integer total.
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
  projected: number;
  finalPayable: number;
} {
  const platformFee = PLATFORM_FEE;
  const handlingFee = HANDLING_FEE;
  const deliveryFee = calcDeliveryFee();
  const projected = subtotal + platformFee + handlingFee + deliveryFee;
  const finalPayable = Math.round(Math.max(projected - discount, 0));
  return { platformFee, handlingFee, deliveryFee, projected, finalPayable };
}
