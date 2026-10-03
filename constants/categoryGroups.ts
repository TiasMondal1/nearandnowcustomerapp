/**
 * Maps each category (by lowercase name/slug keyword) to a display "group"
 * that shows up as a header in the Categories tab — Blinkit-style grouping.
 *
 * The match is tolerant but word-anchored: a keyword counts only when it STARTS
 * a word of the category name (X9). A category named "Dairy, Bread & Eggs"
 * still lands under "Grocery & Kitchen" via "dairy" / "bread" / "egg" (word
 * prefixes, so plurals and stems match), while "Steaks" no longer trips "tea"
 * and "Toiletries" no longer trips "oil".
 *
 * Add new keywords as the master catalog grows. Anything that doesn't match
 * falls into the "More" bucket instead of breaking the layout.
 */

export interface CategoryGroupDef {
  id: string;
  title: string;
  /** Keywords that should live inside this group (lowercase; matched as the start of a word, see `getGroupForCategoryName`). */
  match: string[];
}

export const CATEGORY_GROUPS: CategoryGroupDef[] = [
  {
    id: "grocery",
    title: "Grocery & Kitchen",
    match: [
      "grocery",
      "kitchen",
      "vegetable",
      "fruit",
      "atta",
      "rice",
      "dal",
      "flour",
      "oil",
      "ghee",
      "masala",
      "spice",
      "dairy",
      "milk",
      "bread",
      "egg",
      "paneer",
      "curd",
      "butter",
      "bakery",
      "biscuit",
      "dry fruit",
      "dryfruit",
      "cereal",
      "chicken",
      "meat",
      "fish",
      "seafood",
      "kitchenware",
      "appliance",
      "stapl",
      // Pasta / Noodles / Vermicelli live in the pantry alongside staples.
      "pasta",
      "noodle",
      "vermicelli",
      // Salt & sugar are pantry staples too.
      "salt",
      "sugar",
    ],
  },
  {
    id: "snacks",
    title: "Snacks & Drinks",
    match: [
      "snack",
      "chip",
      "namkeen",
      "sweet",
      "chocolate",
      "candy",
      "drink",
      "juice",
      "beverage",
      "tea",
      "coffee",
      "instant food",
      "sauce",
      "spread",
      "ketchup",
      "paan",
      "ice cream",
      "icecream",
      "dessert",
      "cold drink",
      // Frozen foods sit next to ice cream / desserts in the freezer aisle.
      "frozen",
    ],
  },
  {
    id: "beauty",
    title: "Beauty & Personal Care",
    match: [
      "beauty",
      "personal care",
      "bath",
      "body",
      "hair",
      "shampoo",
      "skin",
      "face",
      "cosmetic",
      "makeup",
      "feminine",
      "hygiene",
      "baby",
      "diaper",
      "health",
      "pharma",
      "medicine",
      "wellness",
      "sexual",
      "oral",
      // Adult care / incontinence products.
      "adult",
      // Perfumes & fragrances (both spellings).
      "perfume",
      "fragrance",
      "deodorant",
    ],
  },
  {
    id: "household",
    title: "Household Essentials",
    match: [
      "household",
      "home",
      "lifestyle",
      "cleaner",
      "cleaning",
      "repellent",
      "electronic",
      "stationery",
      "game",
      "toy",
      "detergent",
      "laundry",
      // Toilet care / cleaners.
      "toilet",
      // Air fresheners (cover both "freshener" and misspelling "freshner").
      "air fresh",
      // Dishwashing essentials.
      "dishwash",
      "dish wash",
    ],
  },
  {
    id: "lifestyle",
    title: "Picks for your lifestyle",
    match: [
      "spiritual",
      "pooja",
      "pet",
      "fashion",
      "accessories",
      "apparel",
      "gift",
    ],
  },
];

/**
 * Group id used for categories that don't match anything above.
 * Kept at the bottom of the list so the familiar groups appear first.
 */
export const DEFAULT_GROUP: CategoryGroupDef = {
  id: "more",
  title: "More",
  match: [],
};

/** Escapes a keyword so it can sit verbatim inside a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One pattern per keyword, compiled once at module load (X9 word-boundary matching). The keyword must start a
 * word — preceded by the start of the string or a non-alphanumeric — so "tea" no longer matches "steak", "oil"
 * no longer matches "toiletries", "pet" no longer matches "carpet". The right end stays open on purpose: plurals
 * ("eggs", "chips") and the deliberate stems in the lists above ("stapl", "dishwash", "air fresh") keep matching.
 * Names are lowercased before the test, so the class only needs the lowercase range.
 */
const GROUP_PATTERNS: { group: CategoryGroupDef; patterns: RegExp[] }[] = CATEGORY_GROUPS.map((group) => ({
  group,
  patterns: group.match.map((kw) => new RegExp("(?:^|[^a-z0-9])" + escapeRegExp(kw))),
}));

/** Returns the matching group for a category name, or the default group. */
export function getGroupForCategoryName(name: string): CategoryGroupDef {
  const s = (name || "").toLowerCase();
  if (!s) return DEFAULT_GROUP;
  for (const { group, patterns } of GROUP_PATTERNS) {
    for (const re of patterns) {
      if (re.test(s)) return group;
    }
  }
  return DEFAULT_GROUP;
}

/** Stable ordered list of all possible group ids (grouping + default). */
export const ALL_GROUP_IDS = [
  ...CATEGORY_GROUPS.map((g) => g.id),
  DEFAULT_GROUP.id,
];
