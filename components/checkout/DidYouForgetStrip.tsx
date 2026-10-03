// codename: kepler
// DidYouForgetStrip — the checkout "Did you forget?" rail (CONTRACTS §4.18; speed-and-ease #7; blinkit-parity §3.7;
// MAP §4.2 P2 / §4.3 U14). The recommendation effect is keyed on a CART SIGNATURE (sorted product ids) and the
// location key, so + / − on an item never re-runs it: quantities are excluded on purpose — the strip only cares
// WHICH products are in the cart. One debounced run per signature change; `getNearbyProductFilter` is a cache hit
// per location key; scoring is O(n) over the warm home catalog with a precomputed category rank (no includes/indexOf).
// No decoys: no fake tabs, no bookmark, no fake delivery-minutes stamp (U14). ADD on a card goes through the Stepper
// (CartContext owns the add/remove feedback); this component fires none of its own.
import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { layout, space, text } from "../../constants/ui";
import { useLocation } from "../../context/LocationContext";
import { useIsOnline } from "../../hooks/useIsOnline";
import { useDevFlag } from "../../lib/devFlags";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { getAllProducts, getCachedProduct, getMemoryHomeCache, type Product } from "../../lib/productService";
import { getNearbyProductFilter } from "../../lib/storeService";
import { PRODUCT_CARD, ProductCard } from "../ui";

export type DidYouForgetStripProps = {
  /** Sorted cart product ids joined by ',' — the screen derives it from `items` (quantities excluded). */
  cartSig: string;
  /** `useLocation().locationKey` (nearby-filter cache key) or null when no delivery location is set. */
  locKey: string | null;
  /** Outer band (margins). Pass a StyleSheet ref so the memo holds. */
  style?: StyleProp<ViewStyle>;
  /** Root testID; the list gets `${testID}-list`. */
  testID?: string;
};

/** Cards shown (blinkit-parity §3.7: ProductCard rail × 6). */
const MAX_SUGGESTIONS = 6;
/** Settle time after the LAST signature change before the (cached) lookup + scoring run. */
const DEBOUNCE_MS = 400;
/** Gap between cards; `getItemLayout` and the content container agree on it. */
const GAP = layout.gridGap;
const EMPTY: Product[] = [];

// ─── Scoring (pure, module-level) ────────────────────────────────────────────

type CartProfile = {
  cartIds: Set<string>;
  /** category → rank (0 = most represented in the cart). */
  categoryRank: Map<string, number>;
  /** category → number of DISTINCT cart products in it (quantity-independent by design). */
  categoryCount: Map<string, number>;
  /** Mean unit price of the cart products that resolved from the catalog; 0 when none did. */
  avgPrice: number;
};

/** One pass over the cart ids: category frequency (distinct products — quantities are not in the signature) + mean price. */
function buildCartProfile(cartIds: Set<string>, lookup: (id: string) => Product | undefined): CartProfile {
  const categoryCount = new Map<string, number>();
  let priceSum = 0;
  let priced = 0;
  for (const id of cartIds) {
    const product = lookup(id);
    if (!product) continue;
    if (product.category) categoryCount.set(product.category, (categoryCount.get(product.category) ?? 0) + 1);
    priceSum += product.price;
    priced += 1;
  }
  const categoryRank = new Map<string, number>();
  [...categoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([category], index) => categoryRank.set(category, index));
  return { cartIds, categoryRank, categoryCount, avgPrice: priced > 0 ? priceSum / priced : 0 };
}

/**
 * Same weights as the original checkout effect (2026-09 — category match highest, then price similarity,
 * rating, review count), with the category position read from the precomputed rank Map.
 */
function scoreProduct(product: Product, profile: CartProfile): number {
  let score = 0;
  const rank = product.category ? profile.categoryRank.get(product.category) : undefined;
  if (rank !== undefined) {
    const count = profile.categoryCount.get(product.category) ?? 0;
    score += (profile.categoryRank.size - rank) * 10 + count * 2;
  }
  if (profile.avgPrice > 0) {
    const diff = Math.abs(product.price - profile.avgPrice);
    score += Math.max(0, 1 - diff / profile.avgPrice) * 5;
  }
  if (product.avgRating) score += product.avgRating * 2;
  if (product.reviewCount) score += Math.min(product.reviewCount / 10, 3);
  return score;
}

/** In-stock, nearby, not-in-cart candidates ranked by score; the top `MAX_SUGGESTIONS`. */
function pickSuggestions(pool: Product[], nearbyIds: Set<string>, profile: CartProfile): Product[] {
  const scored: { product: Product; score: number }[] = [];
  for (const product of pool) {
    if (!product.in_stock || profile.cartIds.has(product.id) || !nearbyIds.has(product.id)) continue;
    scored.push({ product, score: scoreProduct(product, profile) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_SUGGESTIONS).map((entry) => entry.product);
}

// ─── List plumbing (module-level so FlatList never sees a new identity — MAP §2.3 #15) ──

const keyExtractor = (product: Product): string => product.id;

const getItemLayout = (_data: ArrayLike<Product> | null | undefined, index: number) => ({
  length: PRODUCT_CARD.railWidth,
  offset: (PRODUCT_CARD.railWidth + GAP) * index,
  index,
});

const renderItem = ({ item }: ListRenderItemInfo<Product>) => <ProductCard variant="rail" product={item} />;

// ─── Strip ───────────────────────────────────────────────────────────────────

function DidYouForgetStripBase({ cartSig, locKey, style, testID }: DidYouForgetStripProps): React.JSX.Element | null {
  const inhibited = useDevFlag("Dev_Checkout_inhibit_RecoNetwork");
  const online = useIsOnline();
  // Coordinates for the (cached) nearby filter; `locKey` is their 3-decimal grid key.
  const { location } = useLocation();
  const lat = location?.latitude;
  const lng = location?.longitude;

  const [suggestions, setSuggestions] = useState<Product[]>(EMPTY);

  useEffect(() => {
    if (inhibited || !online || !cartSig || !locKey || lat === undefined || lng === undefined) {
      // No location → the 0–4 km radius filter can't run; never fall back to every store's catalog.
      setSuggestions(EMPTY);
      return;
    }
    let cancelled = false;
    const cartIds = new Set(cartSig.split(",").filter(Boolean));

    const timer = setTimeout(async () => {
      try {
        // Cache hit per location key after the first resolve (W1 queryCache) — 0 requests on a repeat.
        const filter = await getNearbyProductFilter(lat, lng);
        if (cancelled) return;
        const nearbyIds = filter?.productIds ?? new Set<string>();

        // The warm home cache is store-active-only, not radius-filtered — `pickSuggestions`
        // narrows it to nearby ids. Only a cold cache (deep link straight into checkout) costs
        // a catalog round-trip, and that one is already radius-scoped.
        const cache = getMemoryHomeCache();
        let pool: Product[];
        let lookup: (id: string) => Product | undefined;
        if (cache) {
          pool = cache.products;
          lookup = getCachedProduct;
        } else {
          pool = await getAllProducts({ nearbyIds });
          if (cancelled) return;
          const byId = new Map(pool.map((product) => [product.id, product] as const));
          lookup = (id) => byId.get(id);
        }

        const profile = buildCartProfile(cartIds, lookup);
        const next = pickSuggestions(pool, nearbyIds, profile);
        if (!cancelled) setSuggestions(next.length > 0 ? next : EMPTY);
      } catch (err) {
        // Keep whatever is showing; a stale strip beats a jarring empty one.
        if (!cancelled) logSilentFailure("[CHECKOUT] Did you forget", err);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cartSig, locKey, lat, lng, inhibited, online]);

  if (inhibited || !online || suggestions.length === 0) return null;

  return (
    <View style={[styles.band, style]} testID={testID}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3}>
        Did you forget?
      </Text>
      <FlatList
        data={suggestions}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        horizontal
        showsHorizontalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
        contentContainerStyle={styles.content}
        accessibilityLabel="Did you forget? suggestions"
        testID={testID ? `${testID}-list` : undefined}
      />
    </View>
  );
}

/**
 * Memoised on its (primitive) props: a quantity tap re-renders the checkout screen, not this strip.
 * Inside, only the online / dev-flag / location subscriptions can re-render it — none of them move on ±.
 */
export const DidYouForgetStrip: React.MemoExoticComponent<(props: DidYouForgetStripProps) => React.JSX.Element | null> =
  React.memo(DidYouForgetStripBase);
DidYouForgetStrip.displayName = "DidYouForgetStrip";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  band: { backgroundColor: C.surfaceBand, paddingTop: space[12], paddingBottom: space[16] },
  title: { ...text.h3, paddingHorizontal: layout.gutter, marginBottom: space[10] },
  content: { paddingHorizontal: layout.gutter, gap: GAP },
});
