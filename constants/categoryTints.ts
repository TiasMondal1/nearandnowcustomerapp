// Category tile tints + fallback glyphs (owner: W1-config-tokens; CONTRACTS §1.3).
// THE one sanctioned home for category tint data (W3 F11 — lead decision, final). Pure data:
// the 8 washes below live here rather than in `C` because they sit behind category art, never
// on UI chrome, and nothing else may declare a category tint literal — Home's shop-by-category
// grid and app/(tabs)/categories.tsx (which inlined these as CAT_TINTS / FALLBACK_ICONS until
// 2026-10-03) read `categoryTint()` / `categoryFallbackIcon()`. No `C` token maps onto these
// pastels today; if one is ever added, reference it from here instead of duplicating the hex.
//
// TYPE-ONLY import on purpose: a value import of the components/ui barrel from
// constants/ would evaluate every primitive at constants load and create a cycle.
import type { IconName } from '../components/ui/types';

/** Pastel tile washes, one per category index, cycled with `% 8`. These are the only
 *  colour literals outside constants/colors.ts: they are tints behind category art,
 *  never UI chrome, so they stay out of `C` (the W3 hex audit covers app/ + components/). */
export const CATEGORY_TINTS = [
  '#E8F5E9',
  '#FFF8E1',
  '#E3F2FD',
  '#FCE4EC',
  '#EDE7F6',
  '#E0F7FA',
  '#FBE9E7',
  '#F9FBE7',
] as const;

/** `index % length`, hardened: negatives/floats/NaN wrap or fall back to 0 instead of
 *  indexing `undefined` (list indices are always non-negative ints, so this never changes
 *  the mapping for real callers). */
function wrapIndex(index: number, length: number): number {
  return Number.isFinite(index) ? Math.abs(Math.trunc(index)) % length : 0;
}

/** CATEGORY_TINTS[index % 8]. */
export function categoryTint(index: number): string {
  return CATEGORY_TINTS[wrapIndex(index, CATEGORY_TINTS.length)];
}

/** Fallback glyphs when a category row has no icon — the 8 from
 *  app/(tabs)/home.tsx FALLBACK_ICONS, verbatim and in order. */
export const CATEGORY_FALLBACK_ICONS: readonly IconName[] = [
  'apple',
  'leaf',
  'cow',
  'cookie',
  'cup',
  'sack',
  'food-apple-outline',
  'basket-outline',
];

/** CATEGORY_FALLBACK_ICONS[index % 8] — picked by list INDEX, never by `name.length`
 *  (MAP K25: length-based picks gave two neighbouring categories the same glyph). */
export function categoryFallbackIcon(index: number): IconName {
  return CATEGORY_FALLBACK_ICONS[wrapIndex(index, CATEGORY_FALLBACK_ICONS.length)];
}
