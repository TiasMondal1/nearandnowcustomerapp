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
 */
export function formatQuantityDisplay(quantity: number, isLoose?: boolean): string {
  if (isLoose || !Number.isInteger(quantity)) {
    return `${quantity} kg`;
  }
  return `${quantity}`;
}
