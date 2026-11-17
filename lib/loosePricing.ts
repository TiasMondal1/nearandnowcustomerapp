/**
 * Daily loose prices (2026-11-17): a loose item sells at today's price of the
 * area of the nearest shop that has it (the server's loose_prices_near, the
 * same function checkout charges with). The prices arrive with the nearby
 * filter for the customer's location (storeService) and are laid over the
 * catalogue price here, so product cards, the product page, the cart and
 * checkout all show what the customer will pay.
 *
 * The cached catalogue keeps the catalogue price: an overlaid product is a
 * copy that remembers its catalogue original, so moving to another area or
 * passing midnight never stacks one area's price on another's.
 */
import type { Product } from './productService';

let current: ReadonlyMap<string, number> = new Map();
let version = 0;

/** The catalogue original of an overlaid copy. */
const baseOf = new WeakMap<object, Product>();
/** One overlaid copy per catalogue product per price set (stable identity for memoised rows). */
const copyOf = new WeakMap<object, { version: number; out: Product }>();
/** One overlaid list per source list per price set. */
const listOf = new WeakMap<readonly Product[], { version: number; out: Product[] }>();

function sameMap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Today's loose prices for the customer's location (from the nearby filter). Unchanged prices keep every copy. */
export function setLoosePrices(prices: ReadonlyMap<string, number>): void {
  if (sameMap(current, prices)) return;
  current = prices;
  version++;
}

/** The loose price for an item here today, if there is one. */
export function getLoosePrice(productId: string): number | undefined {
  return current.get(productId);
}

/** A product with today's loose price for this location (the product itself when nothing changes). */
export function withLoosePrice<T extends Product>(p: T): T {
  if (!p || !p.isLoose) return p;
  const base = (baseOf.get(p) as T | undefined) ?? p;
  const price = current.get(base.id);
  if (price == null || price === base.price) return base;
  const hit = copyOf.get(base);
  if (hit && hit.version === version) return hit.out as T;
  const out = { ...base, price } as T;
  baseOf.set(out, base);
  copyOf.set(base, { version, out });
  return out;
}

/** A list with today's loose prices, the same array object until the prices change. */
export function withLoosePrices(list: readonly Product[]): Product[] {
  if (!list.length || current.size === 0) return list as Product[];
  const hit = listOf.get(list);
  if (hit && hit.version === version) return hit.out;
  let changed = false;
  const out = list.map((p) => {
    const q = withLoosePrice(p);
    if (q !== p) changed = true;
    return q;
  });
  const result = changed ? out : (list as Product[]);
  listOf.set(list, { version, out: result });
  return result;
}

/** Test seam. */
export function __resetLoosePricesForTests(): void {
  current = new Map();
  version++;
}
