export const DELIVERY_FEE = 30;

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
  discount = 0,
): {
  convFee: number;
  packagingFee: number;
  deliveryFee: number;
  projected: number;
  finalPayable: number;
} {
  const convFee = calcConvFee(subtotal);
  const packagingFee = calcPackagingFee(totalItems);
  const projected = subtotal + convFee + packagingFee + DELIVERY_FEE;
  const finalPayable = Math.max(projected - discount, 0);
  return { convFee, packagingFee, deliveryFee: DELIVERY_FEE, projected, finalPayable };
}
