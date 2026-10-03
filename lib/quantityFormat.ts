/**
 * Loose/fractional-quantity items (CartContext steps them by 0.25) rendered
 * as a bare decimal everywhere the quantity itself is shown — "0.25" with no
 * indication it's a weight, unlike the product-detail screen's "/ {unit}"
 * label next to the price, which is lost once the item moves into cart/
 * order views. Order items don't carry an explicit isLoose flag end-to-end
 * (would need extending OrderItem's shape, a larger change than this fix
 * covers), so a non-integer quantity is used as the fallback signal — only
 * loose items are ever fractional, packaged items always order in whole
 * counts.
 *
 * C51 (2026-10-03): the unit was hard-coded to "kg", so loose items sold per
 * litre / per 100 g read wrong. `unit` is now an optional third argument;
 * the existing two-argument callers (checkout, orders, confirmation) keep
 * compiling and keep "kg".
 */

/**
 * `isLoose || !Number.isInteger(quantity)` → `${quantity} ${unit || 'kg'}` (e.g. "0.25 kg",
 * "0.5 kg", "1 litre"); whole packaged counts → `${quantity}` (e.g. "2").
 * Backwards compatible: `formatQuantityDisplay(2)` → "2", `formatQuantityDisplay(0.5)` → "0.5 kg".
 */
export function formatQuantityDisplay(quantity: number, isLoose?: boolean, unit?: string): string {
  if (isLoose || !Number.isInteger(quantity)) {
    const label = typeof unit === 'string' ? unit.trim() : '';
    return `${quantity} ${label || 'kg'}`;
  }
  return `${quantity}`;
}
