// codename: halley
// Wishlist — `useWishlist()` over the halley store, rows on `ProductCard variant="row"` with the heart as the remove
// control and the Stepper md as the add control (isLoose flows through the Stepper), skeleton twins, EmptyState for
// empty / error / guest, and the one wishlist toast: "Removed from wishlist" with Undo (design/blinkit-parity §3.17 /
// BP-36 · motion M17 · MAP U28). The store owns the API — no apiFetch here. The guest gate stays (S3 excluded) but
// lives on EmptyState; it renders BEFORE the hook mounts so a signed-out visit never fires GET /api/wishlist.
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, StyleSheet } from "react-native";

import {
  dismissToast,
  EmptyState,
  notify,
  ProductCard,
  Screen,
  ScreenHeader,
  SkeletonProductCard,
  SkeletonScreen,
  useCartBarFootprint,
} from "../components/ui";
import { C } from "../constants/colors";
import { layout } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useForceSkeleton } from "../hooks/useSlowLoad";
import { useWishlist } from "../hooks/useWishlist";
import { feedback } from "../lib/feedback";
import type { Product } from "../lib/productService";
import { wishlistItemToProduct, type WishlistItem } from "../lib/wishlistStore";

// ─── Constants ────────────────────────────────────────────────────────────────

const SKELETON_ROWS = [0, 1, 2, 3] as const;
/** One toast id: a second quick removal replaces the first toast (and its Undo) instead of stacking. */
const REMOVED_TOAST_ID = "wishlist-removed";

const keyExtractor = (item: Product) => item.id;
const getItemType = () => "row";
/** Rows: the heart (`showWishlist`) removes; the Stepper adds — both inside ProductCard (CONTRACTS §4.9). */
const renderItem = ({ item }: ListRenderItemInfo<Product>) => (
  <ProductCard variant="row" product={item} showWishlist recycled />
);

// dismissTo pops to the live tabs route instead of stacking a second tab navigator (W3 R6-01).
function browseProducts(): void {
  router.dismissTo("/(tabs)/home");
}

function logIn(): void {
  router.push("/phone");
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
  const { isAuthenticated } = useAuth();

  // Guest gate kept as today (S3 excluded), on EmptyState; the body (and its data hook) mounts only when signed in.
  if (!isAuthenticated) {
    return (
      <Screen bg={C.card}>
        <ScreenHeader size="lg" title="Wishlist" backFallbackHref="/(tabs)/home" />
        <EmptyState
          fill
          iconWrap
          icon="heart-outline"
          title="Sign in required"
          text="Log in to view and save items to your wishlist"
          action={{ label: "Log in", onPress: logIn }}
        />
      </Screen>
    );
  }

  return <WishlistBody />;
}

function WishlistBody() {
  const { items, loading, error, refresh, toggle } = useWishlist();
  const cartBarFootprint = useCartBarFootprint();

  const products = useMemo(() => items.map(wishlistItemToProduct), [items]);
  const showSkeleton = useForceSkeleton(loading && items.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  // Written in the refresh handler, read in the removal effect: a server reconcile during pull-to-refresh is not a
  // user removal and must not toast.
  const refreshingRef = useRef(false);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refresh]);

  // ── "Removed from wishlist" + Undo ──
  // The heart lives inside ProductCard (it toggles the store directly), so the screen learns about a removal from
  // the list itself: one item that was here and is gone on the next commit, outside a refresh, was removed by the
  // user (a logout unmounts this body before the list empties). Undo = `toggle` the same product back. If the
  // store rolls the removal back (request failed), the item reappears and the toast is dismissed.
  const previousRef = useRef<Map<string, WishlistItem> | null>(null);
  useEffect(() => {
    const previous = previousRef.current;
    const current = new Map(items.map((it) => [it.productId, it]));
    previousRef.current = current;
    if (previous === null || loading || refreshingRef.current) return;

    const removed: WishlistItem[] = [];
    for (const [id, it] of previous) if (!current.has(id)) removed.push(it);
    const restored = Array.from(current.keys()).some((id) => !previous.has(id));

    if (removed.length === 1) {
      const product = wishlistItemToProduct(removed[0]);
      notify({
        id: REMOVED_TOAST_ID,
        title: "Removed from wishlist",
        message: product.name,
        action: {
          label: "Undo",
          onPress: () => {
            void toggle({
              id: product.id,
              name: product.name,
              image_url: product.image_url,
              price: product.price,
              unit: product.unit,
              isLoose: product.isLoose,
            });
          },
        },
      });
    } else if (restored && removed.length === 0) {
      dismissToast(REMOVED_TOAST_ID);
    }
  }, [items, loading, toggle]);

  const listContent = useMemo(() => ({ paddingBottom: layout.scrollBottom + cartBarFootprint }), [cartBarFootprint]);
  const subtitle = `${items.length} ${items.length === 1 ? "item" : "items"}`;

  return (
    <Screen bg={C.card}>
      <ScreenHeader size="lg" title="Wishlist" subtitle={subtitle} backFallbackHref="/(tabs)/home" testID="wishlist-header" />

      {showSkeleton ? (
        <SkeletonScreen label="Loading wishlist…" style={styles.skeletonWrap}>
          {SKELETON_ROWS.map((i) => (
            <SkeletonProductCard key={i} variant="row" />
          ))}
        </SkeletonScreen>
      ) : error && items.length === 0 ? (
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load your wishlist"
          text={error}
          action={{ label: "Retry", onPress: () => void refresh() }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          fill
          iconWrap
          icon="heart-outline"
          title="Your wishlist is empty"
          text="Tap the heart on any product to save it here"
          action={{ label: "Browse products", onPress: browseProducts }}
        />
      ) : (
        <FlashList
          data={products}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          contentContainerStyle={listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          accessibilityLabel="Wishlist items"
          testID="wishlist-list"
        />
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  skeletonWrap: { flex: 1, overflow: "hidden" },
});
