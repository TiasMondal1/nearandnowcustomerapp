export const PLATFORM_FEE = 9.5;
export const HANDLING_FEE = 5.5;

export function calcDeliveryFee(distanceKm: number): number {
  if (distanceKm <= 1) return 15;
  if (distanceKm <= 2) return 20;
  if (distanceKm <= 3) return 25;
  if (distanceKm <= 4) return 30;
  return 30;
}

export function calcConvFee(subtotal: number): number {
  if (subtotal <= 0) return 0;
  if (subtotal < 100) return 60;
  if (subtotal <= 300) return 30;
  return 0;
}

export function calcPackagingFee(totalItems: number): number {
  if (totalItems === 0) return 0;
  return Math.ceil(totalItems / 3) * 5;
}

export function calcOrderTotal(
  subtotal: number,
  totalItems: number,
  distanceKm: number = 2,
  discount = 0,
): {
  platformFee: number;
  handlingFee: number;
  convFee: number;
  packagingFee: number;
  deliveryFee: number;
  projected: number;
  finalPayable: number;
} {
  const platformFee = PLATFORM_FEE;
  const handlingFee = HANDLING_FEE;
  const convFee = calcConvFee(subtotal);
  const packagingFee = calcPackagingFee(totalItems);
  const deliveryFee = calcDeliveryFee(distanceKm);
  const projected = subtotal + platformFee + handlingFee + convFee + packagingFee + deliveryFee;
  const finalPayable = Math.max(projected - discount, 0);
  return { platformFee, handlingFee, convFee, packagingFee, deliveryFee, projected, finalPayable };
}
