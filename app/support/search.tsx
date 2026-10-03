// codename: lyra
// Search — local-first results over the memory catalog on every keystroke, server results merged in after a 250 ms
// debounce, recents + trending before typing, a category chip strip and a result count over the list
// (design/blinkit-parity §3.5 / BP-07 · speed-and-ease #4, #16 · motion M12: the loading flag flips INSIDE the
// debounced callback so no skeleton mounts per keystroke; previous results stay on screen until fresh ones land).
// The nearby filter is the cached `getNearbyProductFilter` (one round trip per location across Home → category →
// search); the screen-level cache that used to live here is gone.
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, ScrollView, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";

import { SearchEmpty } from "../../components/search/SearchEmpty";
import { SearchResultRow } from "../../components/search/SearchResultRow";
import {
  BackButton,
  Chip,
  EmptyState,
  PrimaryButton,
  Screen,
  SearchBand,
  SkeletonProductCard,
  SkeletonScreen,
  useCartBarFootprint,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { fontFamily, layout } from "../../constants/ui";
import { useLocation } from "../../context/LocationContext";
import { useIsOnline } from "../../hooks/useIsOnline";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { useDevFlag } from "../../lib/devFlags";
import { logError } from "../../lib/logError";
import { searchProducts, type Product } from "../../lib/productService";
import { addRecentSearch, clearRecentSearches, useRecentSearches } from "../../lib/recentSearches";
import { mergeSearchResults, searchLocal } from "../../lib/searchLocal";
import { getNearbyProductFilter, peekNearbyProductFilter } from "../../lib/storeService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Server debounce (speed-and-ease #16: down from 350 ms — local results cover the gap). */
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
/** Skeleton rows shown only while the server is loading AND nothing is on screen yet. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5] as const;
/** Shared empty filter for the no-location case (never mutated; identity-stable so effects don't loop). */
const EMPTY_SET = new Set<string>();
const EMPTY_PRODUCTS: Product[] = [];
/** Chip key for the "All" category chip. */
const ALL = "__all__";

const keyExtractor = (item: Product) => item.id;

type CategoryCount = { name: string; count: number };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Category → hit count over the current results, in first-seen order ("Dairy (12) · Snacks (4)"). */
function countCategories(list: Product[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const p of list) {
    const name = p.category?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }));
}

// dismissTo pops to the live tabs route instead of stacking a second tab navigator (W3 R6-01).
function browseCategories(): void {
  router.dismissTo("/(tabs)/categories");
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const { location, isHydrated, locationKey } = useLocation();
  const online = useIsOnline();
  const cartBarFootprint = useCartBarFootprint();
  const inhibitFeature = useDevFlag("Dev_Lyra_inhibit_Feature");
  const inhibitRecents = useDevFlag("Dev_Lyra_inhibit_RecentSearches");
  const inhibitLocal = useDevFlag("Dev_Lyra_inhibit_LocalResults");
  const allowLocal = !inhibitFeature && !inhibitLocal;
  const recents = useRecentSearches();

  // Allow `/support/search?q=Amul+Milk` (used by the Order Again fallback card
  // when the item is no longer in the live catalog).
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = typeof params.q === "string" ? params.q : "";
  const [query, setQuery] = useState(initialQuery);
  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH;

  // ── Nearby filter (cached per location key in lib/storeService) ──
  // `undefined` = not ready yet; searching then would hand `undefined` to the services, which treat it as "no
  // filter" and return the whole platform catalog past the delivery radius (MAP §7.11).
  const [nearbyIds, setNearbyIds] = useState<Set<string> | undefined>(undefined);
  useEffect(() => {
    // LocationContext reads the saved location from AsyncStorage asynchronously on
    // app start; until that finishes, `location === null` doesn't yet mean "no
    // location" — treating it as such here would search against an empty set for
    // the (short) window before hydration completes. Wait instead.
    if (!isHydrated) return;
    if (!location) {
      // No location yet (fresh install, geolocation denied, direct deep
      // link into this screen) — the 0-4 km radius filter can't run without
      // coordinates. Search against an empty set rather than falling back
      // to every active store's catalog platform-wide, which would defeat
      // the radius restriction. See bug_fixes doc, 2026-09-03.
      setNearbyIds(EMPTY_SET);
      return;
    }
    let cancelled = false;
    const { latitude, longitude } = location;
    // Instant when the filter is already in memory for this key; otherwise "waiting" until it resolves.
    setNearbyIds(peekNearbyProductFilter(latitude, longitude)?.productIds);
    getNearbyProductFilter(latitude, longitude)
      .then((filter) => {
        if (!cancelled) setNearbyIds(filter?.productIds ?? EMPTY_SET);
      })
      .catch(() => {
        // Fail toward "no matches", never a frozen spinner and never the platform-wide catalog.
        if (!cancelled) setNearbyIds(EMPTY_SET);
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, location, locationKey]);

  // ── Results ──
  const [local, setLocal] = useState<Product[]>(EMPTY_PRODUCTS);
  const [server, setServer] = useState<Product[]>(EMPTY_PRODUCTS);
  /** The query `server` belongs to — results for an older query stay mounted (no teardown) but never claim to be fresh. */
  const [serverFor, setServerFor] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Monotonically-increasing request id so a slow stale response can't overwrite
  // a fresher one. Critical when typing fast on a slow network.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!hasQuery) {
      setLocal(EMPTY_PRODUCTS);
      setServer(EMPTY_PRODUCTS);
      setServerFor(null);
      setServerLoading(false);
      setSearchError(null);
      // Bump request id so any in-flight slower response is discarded.
      requestIdRef.current += 1;
      return;
    }

    // The radius filter hasn't resolved yet (still waiting on location hydration or the
    // nearby-stores fetch above). Bail out and let the `nearbyIds` change re-run this effect.
    if (nearbyIds === undefined) return;
    const ids = nearbyIds;

    // Local-first (speed-and-ease #16): instant, no network, respects the same nearbyIds semantics.
    setLocal(allowLocal ? searchLocal(trimmed, ids) : EMPTY_PRODUCTS);

    const myId = ++requestIdRef.current;
    const timeout = setTimeout(async () => {
      if (myId !== requestIdRef.current) return;
      // Loading flips INSIDE the debounce (motion M12 / MAP P11): a keystroke never mounts a skeleton.
      setServerLoading(true);
      try {
        const data = await searchProducts(trimmed, { nearbyIds: ids });
        // Discard stale responses: another query has been typed since this one started.
        if (myId !== requestIdRef.current) return;
        setServer(data);
        setServerFor(trimmed);
        setSearchError(null);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        logError("Search products", err);
        setServer(EMPTY_PRODUCTS);
        setServerFor(trimmed);
        setSearchError(err instanceof Error && err.message ? err.message : "Couldn't search");
      } finally {
        if (myId === requestIdRef.current) setServerLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [hasQuery, trimmed, nearbyIds, allowLocal, retryNonce]);

  // Query for the recents write inside the stable row handler (written in an effect, read in a handler — never in render).
  const queryRef = useRef(trimmed);
  useEffect(() => {
    queryRef.current = trimmed;
  }, [trimmed]);

  // Fresh local results for the current query win; otherwise the last server list stays mounted while the next one
  // loads (stale-while-revalidate — no flash, no skeleton teardown).
  const serverIsFresh = serverFor === trimmed;
  const merged = useMemo(() => {
    if (serverIsFresh) return mergeSearchResults(local, server);
    return local.length > 0 ? local : server;
  }, [local, server, serverIsFresh]);

  const categories = useMemo(() => (inhibitFeature ? [] : countCategories(merged)), [merged, inhibitFeature]);
  // Derived, not reset in an effect: a chip for a category that left the results silently falls back to "All".
  const effectiveCategory = activeCategory && categories.some((c) => c.name === activeCategory) ? activeCategory : null;
  const visible = useMemo(
    () => (effectiveCategory ? merged.filter((p) => p.category?.trim() === effectiveCategory) : merged),
    [merged, effectiveCategory],
  );

  // Nothing on screen and no fresh server answer yet (filter resolving, debounce window, or in flight) → the six
  // row twins. They mount only in that gap, never over existing results, so a keystroke never tears a list down.
  const showSkeleton = useForceSkeleton(hasQuery && merged.length === 0 && (!serverIsFresh || serverLoading));
  const searchedFresh = serverIsFresh && !serverLoading;
  const showEmpty = hasQuery && merged.length === 0 && searchedFresh && !searchError;
  const showError = hasQuery && merged.length === 0 && searchedFresh && !!searchError;

  // ── Handlers ──
  const handleChangeText = useCallback((t: string) => setQuery(t), []);
  const handleClear = useCallback(() => setQuery(""), []);
  const handleSubmit = useCallback((t: string) => {
    const term = t.trim();
    if (term.length >= MIN_QUERY_LENGTH) addRecentSearch(term);
    Keyboard.dismiss();
  }, []);
  const handleSelectTerm = useCallback((term: string) => {
    setQuery(term);
    addRecentSearch(term);
  }, []);
  const handleClearRecents = useCallback(() => clearRecentSearches(), []);
  const handleResultPress = useCallback((product: Product) => {
    const term = queryRef.current;
    if (term.length >= MIN_QUERY_LENGTH) addRecentSearch(term);
    router.push(`/product/${product.id}`);
  }, []);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);
  const handleCategory = useCallback((name: string) => setActiveCategory(name === ALL ? null : name), []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Product>) => <SearchResultRow product={item} onPress={handleResultPress} />,
    [handleResultPress],
  );

  const listContent = useMemo(() => ({ paddingBottom: layout.scrollBottom + cartBarFootprint }), [cartBarFootprint]);

  // ── Caption under the header: offline, or the server failed while local results still show ──
  const caption = !online
    ? "Showing saved results"
    : searchError && merged.length > 0
      ? "Couldn't search online · showing saved results"
      : null;
  const captionRetry = online && !!searchError && merged.length > 0;

  const countLabel = `${visible.length} ${visible.length === 1 ? "result" : "results"} for "${trimmed}"${effectiveCategory ? ` in ${effectiveCategory}` : ""}`;

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton fallbackHref="/(tabs)/home" />
        <SearchBand
          mode="input"
          autoFocus
          value={query}
          onChangeText={handleChangeText}
          onSubmit={handleSubmit}
          onClear={handleClear}
          loading={serverLoading}
          style={styles.band}
          testID="search-band"
        />
      </View>

      {caption ? (
        <View style={styles.captionRow} accessibilityLiveRegion="polite">
          <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {caption}
          </Text>
          {captionRetry ? <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={retry} /> : null}
        </View>
      ) : null}

      {!hasQuery ? (
        inhibitFeature ? (
          <EmptyState icon="magnify" iconSize={48} title="Search products" text="Type at least 2 characters to search" />
        ) : (
          <SearchEmpty
            recents={recents}
            showRecents={!inhibitRecents}
            onSelect={handleSelectTerm}
            onClearRecents={handleClearRecents}
            bottomInset={cartBarFootprint}
            testID="search-empty"
          />
        )
      ) : showSkeleton ? (
        <SkeletonScreen label="Searching…" style={styles.skeletonWrap}>
          {SKELETON_ROWS.map((i) => (
            <SkeletonProductCard key={i} variant="row" />
          ))}
        </SkeletonScreen>
      ) : showError ? (
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't search"
          text={searchError ?? undefined}
          action={{ label: "Retry", onPress: retry }}
        />
      ) : showEmpty ? (
        <EmptyState
          fill
          icon="magnify"
          title={`No results for "${trimmed}"`}
          text="Try a different word or browse categories"
          action={{ label: "Browse categories", onPress: browseCategories }}
        />
      ) : (
        <>
          {!inhibitFeature && categories.length > 1 ? (
            <CategoryChips categories={categories} active={effectiveCategory} onSelect={handleCategory} />
          ) : null}
          {!inhibitFeature ? (
            <Text style={styles.count} accessibilityLiveRegion="polite" numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {countLabel}
            </Text>
          ) : null}
          <FlatList
            data={visible}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            initialNumToRender={8}
            windowSize={5}
            removeClippedSubviews
            contentContainerStyle={listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            accessibilityLabel="Search results"
            testID="search-results"
          />
        </>
      )}
    </Screen>
  );
}

// ─── Category chips ───────────────────────────────────────────────────────────

/**
 * "All · Dairy (12) · Snacks (4)" — `Chip size="sm"` in a 44 px `tablist`, filtering the list client-side. A press
 * changes the filter (state), so Chip's default `select` haptic is kept. Chip exposes no `accessibilityRole` prop,
 * so chips announce `selected` with role "button" inside the tablist (see crossFileNotes).
 */
const CategoryChips = React.memo(function CategoryChips({
  categories,
  active,
  onSelect,
}: {
  categories: CategoryCount[];
  active: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.chipScroll}
      contentContainerStyle={styles.chipRow}
      accessibilityRole="tablist"
      accessibilityLabel="Filter results by category"
      testID="search-chips"
    >
      <CategoryChip name={ALL} label="All" selected={active === null} onSelect={onSelect} />
      {categories.map((c) => (
        <CategoryChip key={c.name} name={c.name} label={`${c.name} (${c.count})`} selected={active === c.name} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
});

/** One memoised chip; the per-name closure lives here so the strip hands every chip the same `onSelect`. */
const CategoryChip = React.memo(function CategoryChip({
  name,
  label,
  selected,
  onSelect,
}: {
  name: string;
  label: string;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <Chip label={label} size="sm" selected={selected} accessibilityRole="tab" onPress={() => onSelect(name)} testID={`search-chip-${name}`} />
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: layout.gutterTight,
    paddingVertical: 8,
  },
  band: { flex: 1 },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: layout.gutter,
    paddingBottom: 4,
  },
  caption: { flex: 1, fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub },
  // RN's horizontal ScrollView defaults to flexGrow 1; pinned to its content height so the list below keeps flex 1.
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  // 8 above + 28 chip + 8 below = 44.
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: layout.gutter, paddingVertical: 8 },
  count: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: C.textSub,
    paddingHorizontal: layout.gutter,
    paddingTop: 4,
    paddingBottom: 6,
  },
  skeletonWrap: { flex: 1, overflow: "hidden" },
});
