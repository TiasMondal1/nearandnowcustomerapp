// Category screen — a real 3-column grid of `ProductCard variant="grid"` (fixes MAP C2 via the Stepper's isLoose
// and C3 via `width: "100%"` inside the FlashList cell), sort chips, a "Delivery in N min · N items" subtitle and the
// CartBar footprint (design/blinkit-parity §3.4 / BP-15 · speed-and-ease #4, #13, #15). Data: the cached category
// and the cached nearby filter resolve in one Promise.all, products seed synchronously from the memory catalog for an
// instant paint and are replaced by `getProductsByCategory`. No codename header: the screen has none in CONTRACTS
// §10 — the ProductCard / Stepper it renders carry rigel.
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Chip,
  discountPercent,
  EmptyState,
  PrimaryButton,
  ProductCard,
  Screen,
  ScreenHeader,
  SkeletonProductCard,
  SkeletonScreen,
  useCartBarFootprint,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout } from "../../constants/ui";
import { useLocation, type ActiveLocation } from "../../context/LocationContext";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { getCategoryBySlug, peekCategories, type Category } from "../../lib/categoryService";
import { formatEtaShort } from "../../lib/deliveryEta";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { logError } from "../../lib/logError";
import { getMemoryHomeCache, getProductsByCategory, getProductsForCategoryName, type Product } from "../../lib/productService";
import { getNearbyProductFilter, peekNearbyProductFilter } from "../../lib/storeService";

// ─── Constants ────────────────────────────────────────────────────────────────

const NUM_COLUMNS = 3;
/** Skeleton: three rows of three grid twins. */
const SKELETON_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
/** FlashList render-ahead in px (speed-and-ease #13). */
const DRAW_DISTANCE = 400;

type SortKey = "popular" | "priceAsc" | "priceDesc" | "discount";
const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "priceAsc", label: "Price: low to high" },
  { key: "priceDesc", label: "Price: high to low" },
  { key: "discount", label: "Discount" },
];

// ─── Module-level list callbacks (stable identities — MAP P1 / §7.18) ─────────

const keyExtractor = (item: Product) => item.id;
const getItemType = () => "product";
const renderItem = ({ item }: ListRenderItemInfo<Product>) => (
  <View style={styles.cell}>
    <ProductCard variant="grid" product={item} style={styles.card} recycled />
  </View>
);

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Pure client sort. "popular" keeps the server order (rating → rating_count → newest); the others are stable sorts over it. */
function sortProducts(list: Product[], key: SortKey): Product[] {
  if (key === "popular") return list;
  const sorted = list.slice();
  if (key === "priceAsc") sorted.sort((a, b) => a.price - b.price);
  else if (key === "priceDesc") sorted.sort((a, b) => b.price - a.price);
  else sorted.sort((a, b) => (discountPercent(b.price, b.original_price) ?? 0) - (discountPercent(a.price, a.original_price) ?? 0));
  return sorted;
}

/** The cached category for the slug (memory only; inactive → null). */
function seedCategory(slug: string | undefined): Category | null {
  if (!slug) return null;
  const hit = peekCategories()?.find((c) => c.slug === slug);
  return hit && hit.is_active !== false ? hit : null;
}

/**
 * Instant paint (speed-and-ease #15): the memory catalog's products for the category, restricted to the nearby
 * filter when it is already in memory for this location. `[]` whenever any piece is missing — the fetch decides.
 * With no location there is nothing to seed: the radius filter cannot run (see the fetch comment).
 */
function seedProducts(category: Category | null, location: ActiveLocation | null): Product[] {
  if (!category || !location) return [];
  const cache = getMemoryHomeCache();
  if (!cache) return [];
  const filter = peekNearbyProductFilter(location.latitude, location.longitude);
  if (!filter) return [];
  const all = getProductsForCategoryName(category.name, cache.productsByCategory);
  return all.filter((p) => filter.productIds.has(p.id));
}

// dismissTo pops to the live tabs route (merging {screen}) instead of pushing a second tab navigator (W3 R6-01).
function browseCategories(): void {
  router.dismissTo("/(tabs)/categories");
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CategorySlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { location, isHydrated } = useLocation();
  const eta = useDeliveryEta();
  const cartBarFootprint = useCartBarFootprint();
  const inhibitSortChips = useDevFlag("Dev_Category_inhibit_SortChips");

  // SWR seed (MAP §2.6 #27): category + products from memory so a warm app paints the grid on the first frame.
  const [seed] = useState(() => {
    const category = seedCategory(slug);
    return { category, products: seedProducts(category, location) };
  });
  const [category, setCategory] = useState<Category | null>(seed.category);
  const [products, setProducts] = useState<Product[]>(seed.products);
  const [loading, setLoading] = useState(seed.products.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sort, setSort] = useState<SortKey>("popular");

  // Discards a slower-resolving response from a previously-viewed category —
  // without this, opening category A then quickly navigating to category B
  // could let A's response land after B's and show A's data under B's route.
  const seqRef = useRef(0);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!slug) return;
      const myId = ++seqRef.current;
      try {
        setError(null);
        // Both are cache hits after Home (speed-and-ease #4): one round trip at most per location per 5 min.
        const [categoryData, filter] = await Promise.all([
          getCategoryBySlug(slug),
          location ? getNearbyProductFilter(location.latitude, location.longitude) : Promise.resolve(null),
        ]);
        if (myId !== seqRef.current) return;
        if (!categoryData) {
          setCategory(null);
          setProducts([]);
          setNotFound(true);
          return;
        }
        // No location yet — the 0-4 km radius filter can't run without
        // coordinates. Show nothing rather than falling back to every
        // active store's catalog platform-wide, which would defeat the
        // radius restriction. See bug_fixes doc, 2026-09-03. The same empty
        // Set covers a null filter (non-finite coordinates): `nearbyIds` is
        // never `undefined` here (MAP §7.11).
        const nearbyIds = location ? (filter?.productIds ?? new Set<string>()) : new Set<string>();
        const productsData = await getProductsByCategory(categoryData.name, { nearbyIds });
        if (myId !== seqRef.current) return;
        setNotFound(false);
        setCategory(categoryData);
        setProducts(productsData);
      } catch (err) {
        if (myId !== seqRef.current) return;
        logError("Load category", err);
        setError("Couldn't load products");
      } finally {
        if (myId === seqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [slug, location],
  );

  useEffect(() => {
    // LocationContext hydrates from AsyncStorage; until then `location === null`
    // does not yet mean "no location", so the fetch waits (see search.tsx).
    if (!isHydrated) return;
    const task = InteractionManager.runAfterInteractions(() => {
      fetchData();
    });
    return () => task.cancel();
  }, [isHydrated, fetchData]);

  const onRefresh = useCallback(() => {
    feedback.tapSound();
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const retry = useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const sorted = useMemo(() => sortProducts(products, sort), [products, sort]);
  const showSkeleton = useForceSkeleton(loading);
  const slow = useSlowLoad(loading);
  const isEmpty = !loading && !error && products.length === 0;

  const etaShort = formatEtaShort(eta);
  const etaText = etaShort == null ? null : eta.minutes != null ? `Delivery in ${eta.minutes} min` : "Store closed";
  const countText = products.length > 0 ? `${products.length} ${products.length === 1 ? "item" : "items"}` : null;
  const subtitle = [etaText, countText].filter(Boolean).join(" · ") || undefined;

  const listContent = useMemo(
    () => ({ paddingHorizontal: 12, paddingTop: 8, paddingBottom: layout.scrollBottom + cartBarFootprint }),
    [cartBarFootprint],
  );

  if (notFound && !loading) {
    return (
      <Screen>
        <ScreenHeader size="md" align="left" title="Category" backFallbackHref="/(tabs)/categories" />
        <EmptyState
          fill
          iconWrap
          icon="tag-off-outline"
          title="Category not found"
          text="It may have moved or been removed"
          action={{ label: "Browse categories", onPress: browseCategories }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        size="md"
        align="left"
        title={category?.name ?? "Category"}
        subtitle={subtitle}
        backFallbackHref="/(tabs)/categories"
        testID="category-header"
      />

      {showSkeleton ? (
        <CategorySkeleton slow={slow} onRetry={retry} />
      ) : error ? (
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title={error}
          text="Check your connection and try again"
          action={{ label: "Retry", onPress: retry }}
        />
      ) : isEmpty ? (
        <EmptyState
          fill
          iconWrap
          icon="package-variant-closed-remove"
          title="Nothing here yet"
          text="Try another category or check back soon"
          action={{ label: "Browse categories", onPress: browseCategories }}
        />
      ) : (
        <>
          {inhibitSortChips ? null : <SortChips value={sort} onChange={setSort} />}
          <FlashList
            data={sorted}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            renderItem={renderItem}
            numColumns={NUM_COLUMNS}
            drawDistance={DRAW_DISTANCE}
            contentContainerStyle={listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
            accessibilityLabel={`${category?.name ?? "Category"} products`}
            testID="category-grid"
          />
        </>
      )}
    </Screen>
  );
}

// ─── Sort chips ───────────────────────────────────────────────────────────────

/**
 * 44 px row of `Chip size="sm"` (8 px gaps, 16 px gutters) in a `tablist`; the selected chip fills. Pressing a chip
 * changes the sort — a state change — so Chip's default `select` haptic is kept. Chip has no `accessibilityRole`
 * prop, so each chip announces `selected` with role "button" inside the tablist (see crossFileNotes).
 */
const SortChips = React.memo(function SortChips({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.sortScroll}
      contentContainerStyle={styles.sortRow}
      accessibilityRole="tablist"
      accessibilityLabel="Sort products"
      testID="category-sort"
    >
      {SORT_OPTIONS.map((opt) => (
        <SortChip key={opt.key} option={opt} selected={opt.key === value} onChange={onChange} />
      ))}
    </ScrollView>
  );
});

/** One memoised sort chip; the per-key closure lives here so the row hands every chip the same `onChange`. */
const SortChip = React.memo(function SortChip({
  option,
  selected,
  onChange,
}: {
  option: { key: SortKey; label: string };
  selected: boolean;
  onChange: (key: SortKey) => void;
}) {
  return (
    <Chip
      label={option.label}
      size="sm"
      selected={selected}
      accessibilityRole="tab"
      onPress={() => onChange(option.key)}
      accessibilityLabel={`Sort by ${option.label}`}
      testID={`category-sort-${option.key}`}
    />
  );
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/** Nine `SkeletonProductCard variant="grid"` twins in the real cell geometry; the slow hint + Retry sit outside the progressbar wrapper so the button stays reachable. */
function CategorySkeleton({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  return (
    <View style={styles.skeletonRoot}>
      <SkeletonScreen label="Loading products…">
        <View style={styles.skeletonGrid}>
          {SKELETON_CELLS.map((i) => (
            <View key={i} style={[styles.cell, styles.skeletonCell]}>
              <SkeletonProductCard variant="grid" />
            </View>
          ))}
        </View>
      </SkeletonScreen>
      {slow ? (
        <View style={styles.slow} accessibilityLiveRegion="polite">
          <Text style={styles.slowText} maxFontSizeMultiplier={1.3}>
            Still loading… check your connection
          </Text>
          <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // FlashList enforces the cell width (listWidth / 3); the card fills it and the cell carries the gutters (C3).
  cell: { paddingHorizontal: 4, paddingBottom: 8 },
  card: { width: "100%" },

  // RN's horizontal ScrollView defaults to flexGrow 1; pinned to its content height so the grid below keeps flex 1.
  sortScroll: { flexGrow: 0, flexShrink: 0 },
  // 8 above + 28 chip + 8 below = 44.
  sortRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: layout.gutter, paddingVertical: 8 },

  skeletonRoot: { flex: 1, overflow: "hidden" },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, paddingTop: 8 },
  skeletonCell: { width: `${100 / NUM_COLUMNS}%` },
  slow: { alignItems: "center", gap: 8, paddingHorizontal: layout.gutter, paddingVertical: 16 },
  slowText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub, textAlign: "center" },
});
