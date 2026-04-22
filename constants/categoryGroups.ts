/**
 * Maps each category (by lowercase name/slug keyword) to a display "group"
 * that shows up as a header in the Categories tab — Blinkit-style grouping.
 *
 * The match is tolerant: it looks for any keyword in the category name, so a
 * category named "Dairy, Bread & Eggs" will still land under the "Grocery &
 * Kitchen" group via the "dairy" / "bread" / "egg" keywords.
 *
 * Add new keywords as the master catalog grows. Anything that doesn't match
 * falls into the "More" bucket instead of breaking the layout.
 */

export interface CategoryGroupDef {
  id: string;
  title: string;
  /** Keywords that should live inside this group (lowercase, whole-word/substring matched). */
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

/** Returns the matching group for a category name, or the default group. */
export function getGroupForCategoryName(name: string): CategoryGroupDef {
  const s = (name || "").toLowerCase();
  if (!s) return DEFAULT_GROUP;
  for (const g of CATEGORY_GROUPS) {
    for (const kw of g.match) {
      if (s.includes(kw)) return g;
    }
  }
  return DEFAULT_GROUP;
}

/** Stable ordered list of all possible group ids (grouping + default). */
export const ALL_GROUP_IDS = [
  ...CATEGORY_GROUPS.map((g) => g.id),
  DEFAULT_GROUP.id,
];
