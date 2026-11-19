// Photo aisles for Home: keywords paired with a bundled photo, nothing more. Categories are server-driven, so
// no category name or slug lives here. At run time each aisle takes one live category whose name matches; the
// tile shows that category's own name and opens its own slug. An aisle with no match draws nothing.
// Type-only import: `constants/` never pulls a component barrel in (same as `constants/banners.ts`).
import type { PhotoSlot } from '../components/brand/photos';

export type AisleDef = {
  id: string;
  photo: PhotoSlot;
  /** Lower-case keywords; one must start a word of the category name. */
  match: readonly string[];
  /** Lower-case keywords that rule a category out (same word-start rule). */
  not?: readonly string[];
};

export const AISLES: readonly AisleDef[] = [
  { id: 'fruits', photo: 'aisleFruits', match: ['fruit'], not: ['dry', 'dried'] },
  { id: 'vegetables', photo: 'aisleVegetables', match: ['vegetable', 'sabzi'], not: ['oil'] },
  { id: 'dairy', photo: 'aisleDairy', match: ['dairy', 'milk', 'curd', 'paneer'] },
  { id: 'staples', photo: 'aisleStaples', match: ['atta', 'rice', 'dal', 'stapl', 'flour', 'grain', 'pulse'] },
  { id: 'spices', photo: 'aisleSpices', match: ['masala', 'spice'] },
  { id: 'bakery', photo: 'aisleBakery', match: ['bakery', 'bread'] },
  // The photo is coffee beans, so only coffee names match; add 'tea' when a tea photo is bundled.
  { id: 'beverages', photo: 'aisleBeverages', match: ['coffee'] },
  { id: 'eggs', photo: 'aisleEggs', match: ['egg'] },
];

export type AisleMatch<T> = { id: string; photo: PhotoSlot; category: T };

/** Escapes a keyword so it can sit verbatim inside a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The keyword must start a word: preceded by the start of the string or a non-alphanumeric. The right end
 * stays open so plurals and stems match. Same rule as `constants/categoryGroups.ts`. Names are lower-cased
 * before the test.
 */
function compile(keywords: readonly string[] | undefined): RegExp[] {
  return (keywords ?? []).map((kw) => new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(kw)));
}

/** One pattern per keyword, compiled once at module load. */
const AISLE_PATTERNS: { aisle: AisleDef; match: RegExp[]; not: RegExp[] }[] = AISLES.map((aisle) => ({
  aisle,
  match: compile(aisle.match),
  not: compile(aisle.not),
}));

/**
 * Pairs each aisle with the first category (in the given order) whose name hits a `match` keyword, hits no
 * `not` keyword, has a non-empty slug and was not taken by an earlier aisle. Aisles with no category are
 * skipped. The result is in `AISLES` order.
 */
export function matchAisles<T extends { id: string; name: string; slug?: string | null }>(
  categories: readonly T[],
): AisleMatch<T>[] {
  const taken = new Set<string>();
  const out: AisleMatch<T>[] = [];
  for (const { aisle, match, not } of AISLE_PATTERNS) {
    for (const category of categories) {
      if (taken.has(category.id)) continue;
      if (typeof category.slug !== 'string' || category.slug.length === 0) continue;
      const name = (category.name || '').toLowerCase();
      if (!name) continue;
      if (!match.some((re) => re.test(name))) continue;
      if (not.some((re) => re.test(name))) continue;
      taken.add(category.id);
      out.push({ id: aisle.id, photo: aisle.photo, category });
      break;
    }
  }
  return out;
}
