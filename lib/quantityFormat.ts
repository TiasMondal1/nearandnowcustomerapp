import { formatWeight } from './looseQuantity';

/**
 * Loose/fractional-quantity items (CartContext steps them by 50 g) rendered
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
 * `isLoose || !Number.isInteger(quantity)` → a weight: "250 g", "1.5 kg", "750 ml"; whole packaged
 * counts → `${quantity}` (e.g. "2"). `formatQuantityDisplay(2)` → "2", `formatQuantityDisplay(0.5)` → "500 g".
 */
export function formatQuantityDisplay(quantity: number, isLoose?: boolean, unit?: string | null): string {
  if (isLoose || !Number.isInteger(quantity)) {
    // A loose unit is "per kg"; products a shopkeeper adds are saved as "1kg" / "1l",
    // which would read "0.25 1kg", so a leading "1" is dropped. Under 1 kg reads in
    // grams ("750 g"), now that amounts go in 50 g steps (2026-11-16).
    const label = typeof unit === 'string' ? unit.trim().replace(/^1\s*(?=[a-z])/i, '') : '';
    return formatWeight(quantity, label || 'kg');
  }
  return `${quantity}`;
}

/** A bare per-kg / per-litre unit, as loose products carry it. "1 kg" is NOT one: that's a packaged 1 kg bag. */
const LOOSE_UNIT = /^(kg|kgs|l|ltr|litre|liter)$/i;

/**
 * Whether an order line is a loose (weighed) item. Order lines carry no
 * isLoose flag, and a fractional quantity alone missed whole amounts: 2 kg
 * of onions read "×2", like two packets. Loose products' unit is a bare
 * "kg" while packaged ones carry a size ("1 kg", "500 ml"), so the unit
 * settles it.
 */
export function isLooseOrderLine(quantity: number, unit?: string | null): boolean {
  return !Number.isInteger(quantity) || LOOSE_UNIT.test((unit ?? '').trim());
}
