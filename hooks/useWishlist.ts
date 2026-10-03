// codename: halley
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  getWishlistItems,
  isWishlisted as isWishlistedSync,
  isWishlistLoaded,
  loadWishlist,
  removeFromWishlist,
  subscribeWishlist,
  subscribeWishlistId,
  toggleWishlist,
  type WishlistItem,
} from '../lib/wishlistStore';

function getServerItems(): WishlistItem[] {
  return getWishlistItems();
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Could not load your wishlist.';
}

/**
 * Screen hook for /wishlist. `items` is the live store list (stable reference between changes);
 * `loading` is true only while the FIRST load of the session is in flight with nothing in
 * memory (SWR: a cached list paints instantly); `error` is the last load failure's message
 * (cleared by `refresh`). `refresh` forces a network read. `toggle` / `remove` are the
 * optimistic store actions; `isWishlisted` is the sync O(1) check.
 */
export function useWishlist(): {
  items: WishlistItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isWishlisted: (id: string) => boolean;
  toggle: typeof toggleWishlist;
  remove: typeof removeFromWishlist;
} {
  const items = useSyncExternalStore(subscribeWishlist, getWishlistItems, getServerItems);
  const [loading, setLoading] = useState(() => !isWishlistLoaded());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWishlist()
      .then(() => {
        if (cancelled) return;
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      await loadWishlist({ force: true });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    items,
    loading,
    error,
    refresh,
    isWishlisted: isWishlistedSync,
    toggle: toggleWishlist,
    remove: removeFromWishlist,
  };
}

function getServerWishlisted(): boolean {
  return false;
}

/** Per-product subscription: re-renders only when THIS product's membership flips. `false` until the list has loaded this session. */
export function useIsWishlisted(productId: string): boolean {
  const subscribe = useCallback((cb: () => void) => subscribeWishlistId(productId, cb), [productId]);
  const getSnapshot = useCallback(() => isWishlistedSync(productId), [productId]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerWishlisted);
}
