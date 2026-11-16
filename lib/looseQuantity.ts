/**
 * Loose (weighed) items: amounts by weight in 50 g steps, or by the piece.
 *
 * Mirrors the backend (near-and-now backend/src/utils/quantity.ts), which
 * re-prices every line, so these only decide what the customer sees:
 * - by weight: any multiple of 50 g from 50 g up to the product's max (kg);
 * - by the piece (products with `pieceWeightG`): whole pieces at a FIXED
 *   price, per-kg price x average piece weight, rounded to the rupee. The
 *   line's unit is "pc (~180 g)", which is what the store and rider see.
 */

import type { CartItem } from '../context/CartContext';
import type { Product } from './productService';

/** The +/- step and the smallest amount by weight. */
export const LOOSE_STEP_KG = 0.05;

/** Quick picks on the product page; the +/- buttons move 50 g. */
export const WEIGHT_PRESETS_KG = [0.25, 0.5, 1, 2, 5] as const;

/** Round off float drift (0.1 + 0.2) to whole grams. */
export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

/** Nearest 50 g, never below 50 g. */
export function snapToStep(kg: number): number {
  return Math.max(LOOSE_STEP_KG, roundKg(Math.round(kg / LOOSE_STEP_KG) * LOOSE_STEP_KG));
}

/**
 * A weight for display: "50 g", "750 g", "1 kg", "1.25 kg" (kg units);
 * "250 ml", "1.5 l" (litre units). Any other unit: "<n> <unit>".
 */
export function formatWeight(amount: number, unit = 'kg'): string {
  const u = unit.trim().toLowerCase();
  const n = roundKg(amount);
  if (u === 'kg' || u === 'kgs') return n < 1 ? `${Math.round(n * 1000)} g` : `${n} kg`;
  if (u === 'l' || u === 'ltr' || u === 'litre' || u === 'liter') return n < 1 ? `${Math.round(n * 1000)} ml` : `${n} l`;
  return `${n} ${unit.trim()}`;
}

/** The fixed price of one piece (backend piecePrice). */
export function piecePrice(perKgPrice: number, pieceWeightG: number): number {
  return Math.max(1, Math.round((perKgPrice * pieceWeightG) / 1000));
}

/** The unit a by-piece line carries: "pc (~180 g)" (backend pieceUnitLabel). */
export function pieceUnitLabel(pieceWeightG: number): string {
  const g = Math.round(pieceWeightG);
  return g >= 1000 ? `pc (~${Number((g / 1000).toFixed(2))} kg)` : `pc (~${g} g)`;
}

/** The product's kg limit in pieces (backend maxPieces); 99 when it has none. */
export function maxPieces(maxQuantityKg: number | undefined, pieceWeightG: number): number {
  if (maxQuantityKg == null || !(maxQuantityKg > 0)) return 99;
  return Math.max(1, Math.floor((maxQuantityKg * 1000) / pieceWeightG + 1e-9));
}

/** Whether an order line's unit marks it as bought by the piece. */
export function isPieceUnit(unit?: string | null): boolean {
  return /^pc \(~/.test((unit ?? '').trim());
}

/** The cart line for a loose product bought by weight (kg, 50 g steps) or by the piece. */
export function looseCartLine(
  product: Pick<Product, 'id' | 'name' | 'image_url' | 'price' | 'unit' | 'maxQuantity' | 'pieceWeightG'>,
  mode: 'weight' | 'piece',
): Omit<CartItem, 'quantity'> {
  const base = { product_id: product.id, name: product.name, image_url: product.image_url };
  if (mode === 'piece' && product.pieceWeightG) {
    return {
      ...base,
      price: piecePrice(product.price, product.pieceWeightG),
      unit: pieceUnitLabel(product.pieceWeightG),
      isLoose: false,
      sellBy: 'piece',
      maxQty: maxPieces(product.maxQuantity, product.pieceWeightG),
    };
  }
  return { ...base, price: product.price, unit: product.unit, isLoose: true, maxQty: product.maxQuantity };
}

/**
 * The amount for grams the customer typed: nearest 50 g (at least 50 g), capped at the product's
 * max. `note` says when it was rounded or capped; `error` when the input isn't a number of grams.
 */
export function amountFromTypedGrams(
  input: string,
  maxKg: number | undefined,
  unit = 'kg',
): { kg: number; note: string | null } | { error: string } {
  const t = input.trim();
  const g = Number(t);
  if (!t || !Number.isFinite(g) || g <= 0) return { error: 'Enter grams, e.g. 750' };
  const kg = snapToStep(g / 1000);
  if (maxKg != null && maxKg > 0 && kg > maxKg) return { kg: maxKg, note: `Most you can order is ${formatWeight(maxKg, unit)}` };
  if (Math.abs(kg * 1000 - g) > 0.5) return { kg, note: `Rounded to ${formatWeight(kg, unit)} (we weigh in 50 g steps)` };
  return { kg, note: null };
}
