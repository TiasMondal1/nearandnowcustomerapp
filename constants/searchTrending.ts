// codename: lyra
// Search copy constants (owner: W1-config-tokens; CONTRACTS §1.3). Pure data.
// Consumed by components/ui/SearchBand.tsx (placeholder rotation) and
// app/support/search.tsx (trending chips on the empty state).

/** Words the Home search band rotates through as `Search for "milk"…`. Lower-case
 *  because they sit inside a sentence; the band owns the rotation timing + pause rules. */
export const SEARCH_PLACEHOLDER_WORDS = ['milk', 'bread', 'eggs', 'atta', 'chips', 'paneer'] as const;

/** Chips shown on the empty search screen (sentence case — they are tappable labels
 *  that set the query verbatim). Tapping one is a state change → `feedback.select()`. */
export const TRENDING_SEARCHES = ['Milk', 'Bread', 'Eggs', 'Atta', 'Oil', 'Chips'] as const;
