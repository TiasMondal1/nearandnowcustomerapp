// codename: kepler
// Home — the Blinkit feed, composed from components/home/* (W2-home-screen · CONTRACTS §4.18 · design/blinkit-parity
// §3.1). One FlashList of typed items: TabHeader (atlas + antares ETA hero) → sticky SearchBand + category chip strip
// (lyra) → text-card banners (deneb) → 8 tiles + "All categories" → "Frequently bought" rail → one rail per category
// with "See all" → end stamp. The Home-only cart pill is GONE (cyan: the global CartBar is mounted once in the root
// layout and lifts over the active-orders banner through `setCartBarExtraBottom`). The account sheet is mounted by
// its provider; the avatar calls `useProfileMenu().open`. Android back asks before exiting (zephyr). No local
// palette (boreal). Loading is `HomeSkeleton` (onyx).
//
// Data (kepler): boot seeds from the in-memory global catalog; the location effect resolves the nearby filter and
// DERIVES the nearby view in memory (`products.filter(nearby) → groupProductsByCategory`) — zero catalog requests on
// a cold start with a warm cache; a stale cache triggers ONE background global pull that is written to the shared
// cache and re-derived; a nearby `.in()` pull runs only when there is no cache at all (cold install) or under
// `Dev_Kepler_inhibit_InstantNearby`. Pulls dedupe in flight per filter key. The orders poll is diffed (vega): no
// setState unless the active set or the top-product order changed; 20 s only while an order is active and the tab
// is focused + the app is active; a focus refetch is skipped while idle for < 2 min.
//
// Landmine 24 (MAP §7.24), updated for rev. 2: `listData` is a discriminated union consumed by `getItemType`; the
// TabHeader is item 0 and the STICKY cell is now INDEX 1 (`stickyHeaderIndices={[1]}` — it was index 0 while the
// address bar was a `ListHeaderComponent`). The "no location ⇒ clear catalog ⇒ empty state" and "empty Set ⇒ No
// stores near you" branches are intact, and every async writer is guarded by a sequence ref + `cancelled`.
import { FlashList, type FlashListRef, type ListRenderItemInfo, type ViewToken } from "@shopify/flash-list";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AppState,
  BackHandler,
  InteractionManager,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewabilityConfig,
} from "react-native";

import { ACTIVE_ORDER_BANNER_FOOTPRINT, ActiveOrdersBanner } from "../../components/home/ActiveOrdersBanner";
import { BannerCarousel } from "../../components/home/BannerCarousel";
import { CategoryChipStrip } from "../../components/home/CategoryChipStrip";
import { CategoryTileGrid } from "../../components/home/CategoryTileGrid";
import { HOME_ITEM_SIZE, HomeSkeleton } from "../../components/home/HomeSkeleton";
import { ProductRail } from "../../components/home/ProductRail";
import {
  EmptyState,
  notify,
  PressableScale,
  ProductCard,
  Screen,
  SearchBand,
  setCartBarExtraBottom,
  TabHeader,
  useCartBarFootprint,
  useMotionReduced,
  type IconName,
} from "../../components/ui";
import { BANNERS, getActiveBanners, type Banner } from "../../constants/banners";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation, type ActiveLocation } from "../../context/LocationContext";
import { useProfileMenu } from "../../context/ProfileMenuContext";
import { useDeviceAddress } from "../../hooks/useDeviceAddress";
import { useRefetchOnReconnect } from "../../hooks/useRefetchOnReconnect";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { getRemoteBanners } from "../../lib/bannerService";
import { markBoot } from "../../lib/bootGate";
import { getAllCategories, peekCategories, resolveCategorySlug, type Category } from "../../lib/categoryService";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { prefetchImages } from "../../lib/imageUrl";
import { clearLiveAddressCache, getLiveAddressCache, setLiveAddressCache } from "../../lib/liveAddress";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { getMemoryOrders, getUserOrders, readUserOrdersCache, splitActivePast, type Order } from "../../lib/orderService";
import {
  getCountForCategoryName,
  getMemoryHomeCache,
  getPopularProducts,
  getProductsForCategoryName,
  groupProductsByCategory,
  isHomeCatalogCacheFresh,
  loadMasterCatalog,
  readHomeCatalogCache,
  writeHomeCatalogCache,
  type HomeCatalogCache,
  type Product,
} from "../../lib/productService";
import {
  getAllActiveProductIds,
  getNearbyProductFilter,
  nearbyKey,
  peekNearbyProductFilter,
  type NearbyFilter,
} from "../../lib/storeService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** How often the active-orders banner re-polls while an order is active, Home is focused and the app is active. */
const ACTIVE_ORDERS_POLL_MS = 20_000;
/** With no active order, a focus refetch is skipped while the last fetch is younger than this (speed-and-ease #9). */
const ORDERS_IDLE_REFRESH_MS = 2 * 60_000;
/** Second Android back press inside this window exits (motion M24). */
const BACK_EXIT_WINDOW_MS = 2000;
/** Scroll quiet time before the search placeholder resumes rotating (motion M31: paused while scrolling). */
const SCROLL_IDLE_MS = 250;
/** Cards per category rail and in the "Frequently bought" rail. */
const RAIL_LENGTH = 10;
/** `getPopularProducts` candidates scanned for the nearby-only "Frequently bought" fallback. */
const POPULAR_CANDIDATES = 50;
/** Legacy 2×3 blocks under `Dev_Home_inhibit_Rails`. */
const LEGACY_SECTION_VISIBLE = 6;
const LEGACY_ROW_COUNT = 3;
/** Image warm-up after a catalog paint: the first rails' first cards at the card width hint (ProductCard uses 240). */
const PREFETCH_RAILS = 2;
const PREFETCH_PER_RAIL = 4;
const PREFETCH_WIDTH = 240;
/** Empty-state cell height so `EmptyState fill` has room to centre under the sticky band. */
const EMPTY_MIN_HEIGHT = 360;
/** "See all ›" is a 20 pt text link; ±12 vertical lifts it to 44 pt (nothing sits above/below it in the header row). */
const SEE_ALL_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };
/** Index of the sticky cell (SearchBand + chip strip); the TabHeader is item 0. */
const STICKY_INDICES = [1];
/** A section counts as "in view" for the chip highlight once a fifth of it is visible for 80 ms. */
const VIEWABILITY_CONFIG: ViewabilityConfig = { itemVisiblePercentThreshold: 20, minimumViewTime: 80, waitForInteraction: false };

const EMPTY_PRODUCTS: Product[] = [];

// The last reverse-geocoded "live address" lives in lib/liveAddress.ts (module mirror: survives the remounts
// expo-router does on tab return so the slow GPS + reverse-geocode chain runs once per launch; cleared on logout
// from AuthContext.clearStoredSession — C30 / W3 R1-15).

/** In-flight catalog pulls per filter key (`global` | `nearby:<lat,lng>`) — concurrent callers share one request. */
const inFlightCatalog = new Map<string, Promise<CatalogResult>>();
/** `__DEV__` once: proves the diffed poll produces no setState when nothing changed (card acceptance). */
let loggedOrdersNoChange = false;

type CatalogResult = Awaited<ReturnType<typeof loadMasterCatalog>>;
type Phase = "booting" | "ready" | "error";
type EmptyVariant = "noLocation" | "noStores" | "noProducts" | "error";

/**
 * Typed discriminated-union of home-feed list items. FlashList virtualizes the outer list, so off-screen sections are
 * unmounted from the native view tree. `productRow` / `seeAllBar` are the legacy 2×3 blocks kept behind
 * `Dev_Home_inhibit_Rails`.
 */
type HomeListItem =
  | { kind: "header" }
  | { kind: "search"; names: readonly string[] }
  | { kind: "banners"; banners: Banner[] }
  | { kind: "catTileGrid"; categories: Category[]; counts: Record<string, number>; capped: boolean }
  | { kind: "freqBought"; products: Product[] }
  | { kind: "sectionHeader"; categoryId: string; categoryName: string; slug: string | null }
  | { kind: "productRail"; categoryId: string; categoryName: string; products: Product[] }
  | { kind: "productRow"; rowKey: string; categoryName: string; products: Product[] }
  | { kind: "seeAllBar"; categoryId: string; categoryName: string; slug: string }
  | { kind: "endStamp" }
  | { kind: "empty"; variant: EmptyVariant };

// ─── Home UI store (leaf subscriptions; keeps `renderItem` free of volatile deps) ──
// Viewability, scroll state, focus and the live address change constantly or independently of the feed data. Putting
// them in React state consumed by `renderItem` would recreate `renderItem` and re-render EVERY mounted cell on each
// change (the P1 class of bug). The sticky cell, header cell and banners cell subscribe to this tiny module store
// instead (MAP §2.6 #28), so a chip highlight update re-renders one chip strip and nothing else.

type HomeUi = {
  /** Category whose section is in view (chip highlight); null before the first viewability callback. */
  activeName: string | null;
  /** True while the feed scrolls (pauses the search placeholder rotation). */
  scrolling: boolean;
  /** Tab focused. */
  focused: boolean;
  /** AppState === 'active'. */
  appActive: boolean;
  /** Reverse-geocoded device address; a placeholder for the address pill until a location is set. */
  liveAddress: string | null;
};

let homeUi: HomeUi = {
  activeName: null,
  scrolling: false,
  focused: false,
  appActive: AppState.currentState === "active",
  liveAddress: null,
};
const homeUiListeners = new Set<() => void>();

function setHomeUi(patch: Partial<HomeUi>): void {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof HomeUi)[]) {
    if (homeUi[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  homeUi = { ...homeUi, ...patch };
  for (const cb of Array.from(homeUiListeners)) cb();
}

function subscribeHomeUi(cb: () => void): () => void {
  homeUiListeners.add(cb);
  return () => {
    homeUiListeners.delete(cb);
  };
}

function useHomeUi<K extends keyof HomeUi>(key: K): HomeUi[K] {
  return useSyncExternalStore(
    subscribeHomeUi,
    () => homeUi[key],
    () => homeUi[key],
  );
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** The nearby view: the global product set restricted to what nearby stores carry, grouped like the service does. */
function deriveNearbyView(cache: HomeCatalogCache, nearby: NearbyFilter): Record<string, Product[]> {
  const ids = nearby.productIds;
  return groupProductsByCategory(cache.products.filter((p) => ids.has(p.id)));
}

/** One request per filter key at a time; a second caller (another location effect run, pull-to-refresh) shares it. */
function pullCatalog(key: string, nearbyIds: Set<string> | undefined): Promise<CatalogResult> {
  const existing = inFlightCatalog.get(key);
  if (existing) return existing;
  const promise: Promise<CatalogResult> = loadMasterCatalog({ nearbyIds }).finally(() => {
    if (inFlightCatalog.get(key) === promise) inFlightCatalog.delete(key);
  });
  inFlightCatalog.set(key, promise);
  return promise;
}

/** Most-reviewed first, then best-rated — mirrors productService's popularity order for the cold-install fallback. */
function compareByReviews(a: Product, b: Product): number {
  const ac = a.reviewCount ?? 0;
  const bc = b.reviewCount ?? 0;
  if (bc !== ac) return bc - ac;
  return (b.avgRating ?? 0) - (a.avgRating ?? 0);
}

/**
 * Product ids by how often the customer bought them, most first. Keyed by `master_product_id` (the id the catalog
 * uses) with the store-specific `product_id` as a fallback for old rows.
 */
function topProductIdsFrom(orders: Order[]): string[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    for (const it of order.items ?? []) {
      const id = it.master_product_id ?? it.product_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + (it.quantity || 1));
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

function activeKeyOf(active: Order[]): string {
  return active.map((o) => `${o.id}:${o.order_status}:${o.payment_status}`).join(",");
}

type CatalogSeed = { categories: Category[]; view: Record<string, Product[]>; phase: Phase; noStores: boolean };

/**
 * First-render seed: when the global catalog is in memory (splash pre-warm) AND the nearby filter for the active
 * location is in memory (`peekNearbyProductFilter`), the nearby view is derived synchronously so Home paints with
 * real local content on frame 1 — no global → nearby flash. Otherwise the skeleton shows until the location effect
 * resolves. A hydrated store with NO location is ready immediately (the "Set your location" empty state).
 */
function seedCatalog(location: ActiveLocation | null, isHydrated: boolean, instant: boolean): CatalogSeed {
  const cache = getMemoryHomeCache();
  const categories = cache?.categories ?? peekCategories() ?? [];
  if (isHydrated && !location) return { categories, view: {}, phase: "ready", noStores: false };
  if (!cache || !location || !instant) return { categories, view: {}, phase: "booting", noStores: false };
  const nearby = peekNearbyProductFilter(location.latitude, location.longitude);
  if (!nearby) return { categories, view: {}, phase: "booting", noStores: false };
  const noStores = nearby.storeIds.length === 0;
  return { categories, view: noStores ? {} : deriveNearbyView(cache, nearby), phase: "ready", noStores };
}

type OrdersSeed = { active: Order[]; topIds: string[]; activeKey: string; topKey: string };

/** Orders already in the memory mirror (a previous mount, the Orders tab) paint the banner on frame 1. */
function seedOrders(): OrdersSeed {
  const orders = getMemoryOrders();
  if (!orders) return { active: [], topIds: [], activeKey: "", topKey: "" };
  const active = splitActivePast(orders).active;
  const topIds = topProductIdsFrom(orders);
  return { active, topIds, activeKey: activeKeyOf(active), topKey: topIds.join(",") };
}

// ─── Navigation (silent — pure navigation never plays feedback) ─────────────────

function goToSelectLocation(): void {
  router.push("/select-location");
}

function goToCategories(): void {
  router.push("/(tabs)/categories");
}

// ─── FlashList helpers (module-level so their identity never changes) ──────────

const keyExtractor = (item: HomeListItem): string => {
  switch (item.kind) {
    case "header":
      return "header";
    case "search":
      return "search";
    case "banners":
      return "banners";
    case "catTileGrid":
      return "tiles";
    case "freqBought":
      return "freq";
    case "sectionHeader":
      return `hdr-${item.categoryId}`;
    case "productRail":
      return `rail-${item.categoryId}`;
    case "productRow":
      return `row-${item.rowKey}`;
    case "seeAllBar":
      return `seeall-${item.categoryId}`;
    case "endStamp":
      return "end";
    case "empty":
      return `empty-${item.variant}`;
  }
};

/** Tells FlashList to recycle cells of the same type — stable per kind. */
const getItemType = (item: HomeListItem): string => item.kind;

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { location, isHydrated } = useLocation();
  const { userId, isAuthenticated } = useAuth();
  const { refreshUnread } = useProfileMenu();
  const { request: requestDeviceAddress } = useDeviceAddress();
  const cartBarFootprint = useCartBarFootprint();
  const reduced = useMotionReduced();
  const focused = useHomeUi("focused");
  const appActive = useHomeUi("appActive");

  const inhibitBanners = useDevFlag("Dev_Deneb_inhibit_Feature");
  const inhibitTileCap = useDevFlag("Dev_Home_inhibit_TileCap");
  const inhibitRails = useDevFlag("Dev_Home_inhibit_Rails");
  const inhibitInstantNearby = useDevFlag("Dev_Kepler_inhibit_InstantNearby");
  const inhibitKepler = useDevFlag("Dev_Kepler_inhibit_Feature");
  const inhibitActivePoll = useDevFlag("Dev_Vega_inhibit_ActivePoll");
  /** Instant in-memory nearby view (kepler); off under either flag → the network path runs per location change. */
  const instantNearby = !inhibitInstantNearby && !inhibitKepler;

  // ── Catalog state (seeded synchronously from the memory caches) ────────────
  const [catalogSeed] = useState(() => seedCatalog(location, isHydrated, instantNearby));
  const [categories, setCategories] = useState<Category[]>(catalogSeed.categories);
  const [view, setView] = useState<Record<string, Product[]>>(catalogSeed.view);
  const [phase, setPhase] = useState<Phase>(catalogSeed.phase);
  const [noStores, setNoStores] = useState(catalogSeed.noStores);
  const [remoteBanners, setRemoteBanners] = useState<Banner[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // ── Orders state ───────────────────────────────────────────────────────────
  const [ordersSeed] = useState(seedOrders);
  const [activeOrders, setActiveOrders] = useState<Order[]>(ordersSeed.active);
  const [userTopProductIds, setUserTopProductIds] = useState<string[]>(ordersSeed.topIds);

  // ── Refs (written in handlers/effects only — never read during render) ─────
  const listRef = useRef<FlashListRef<HomeListItem> | null>(null);
  /**
   * Discards a slower-resolving catalog writer superseded by a newer one (two quick location changes, a refresh
   * during a location change): each writer captures the sequence when it starts and compares before every setState.
   */
  const seqRef = useRef(0);
  /** Same shape for the orders writers (seed, focus refetch, poll, reconnect) — a stale fetch never clobbers fresher state. */
  const ordersSeqRef = useRef(0);
  const activeKeyRef = useRef(ordersSeed.activeKey);
  const topKeyRef = useRef(ordersSeed.topKey);
  const lastOrdersFetchAtRef = useRef(0);
  const activeCountRef = useRef(ordersSeed.active.length);
  /** The resolved nearby filter for the current location (pull-to-refresh re-pulls with it). */
  const nearbyRef = useRef<{ key: string; filter: NearbyFilter } | null>(null);
  const categoriesRef = useRef(categories);
  const listDataRef = useRef<HomeListItem[]>([]);
  const stickyHeightRef = useRef(HOME_ITEM_SIZE.searchWithChips);
  const reducedRef = useRef(reduced);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBackPressRef = useRef(0);
  const firstPaintRef = useRef(false);
  const wasAuthenticatedRef = useRef(isAuthenticated);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  useEffect(() => {
    activeCountRef.current = activeOrders.length;
  }, [activeOrders.length]);

  // Mount: mirror the module caches into the UI store; unmount: supersede every in-flight writer and clear timers.
  useEffect(() => {
    setHomeUi({ liveAddress: getLiveAddressCache().address, activeName: null, scrolling: false });
    return () => {
      seqRef.current += 1;
      ordersSeqRef.current += 1;
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    };
  }, []);

  // ── Catalog writers ────────────────────────────────────────────────────────

  /** Applies a catalog view for a still-current writer sequence. */
  const paintView = useCallback((seq: number, byCategory: Record<string, Product[]>, categoriesData?: Category[]) => {
    if (seq !== seqRef.current) return;
    setView(byCategory);
    if (categoriesData && categoriesData.length > 0) setCategories(categoriesData);
    setPhase("ready");
  }, []);

  /**
   * The ONE global pull: every active master product carried by any verified + online store. It is the only fetch
   * that is written to the shared home cache — never the location-scoped nearby subset, which would poison the cache
   * with one location's results for every other location (the pre-2026-10-01 `!filter` gate silently stopped
   * caching after the 2026-09-03 radius fix made every caller pass a Set; see bug_fixes doc, finding C1). When
   * `nearby` is given and the writer is still current, the nearby view is re-derived from the fresh set and painted.
   */
  const refreshGlobal = useCallback(
    async (seq: number, nearby: NearbyFilter | null) => {
      // The whole platform catalog in one paged pull, then restricted to the active-id set IN MEMORY — never
      // `.in('id', <every active id>)`, which blows the 16 KB URL limit on a dense platform (MAP §7.11 C6, W3 R1-05).
      const [activeIds, raw] = await Promise.all([getAllActiveProductIds(), pullCatalog("global", undefined)]);
      const result: CatalogResult =
        activeIds.size > 0 ? { ...raw, products: raw.products.filter((p) => activeIds.has(p.id)) } : raw;
      // JSON.stringify of a few thousand rows is JS-thread work — keep it off the paint.
      InteractionManager.runAfterInteractions(() => {
        void writeHomeCatalogCache({ products: result.products, categories: result.categories });
      });
      if (seq !== seqRef.current || !nearby || nearby.storeIds.length === 0) return;
      const ids = nearby.productIds;
      paintView(seq, groupProductsByCategory(result.products.filter((p) => ids.has(p.id))), result.categories);
    },
    [paintView],
  );

  const lat = location?.latitude;
  const lng = location?.longitude;

  // ── Nearby store filter + catalog — the location effect owns every catalog fetch ──
  // Runs after isHydrated so it never blocks the first paint. Keyed on the rounded coordinates (~110 m grid) so GPS
  // jitter never re-fires it; a remount re-runs it, which costs a synchronous derive and at most one network pull per
  // 5-minute staleness window.
  useEffect(() => {
    if (!isHydrated) return;
    const seq = ++seqRef.current;
    let cancelled = false;

    if (lat == null || lng == null) {
      // No location set — show nothing rather than the whole platform catalog. The 0-4 km radius filter can't run
      // without coordinates, and silently falling back to every active store's products (as this used to) defeats
      // the radius restriction entirely. Clearing the catalog here lets the "Set your location" empty state render
      // instead. See bug_fixes doc, 2026-09-03.
      nearbyRef.current = null;
      setNoStores(false);
      setView({});
      setPhase("ready");
      // Warm the global cache while the user picks an address so the first pick derives instantly (no pull for a
      // located user here — the branch below owns that).
      const cache = getMemoryHomeCache();
      if (cache && isHomeCatalogCacheFresh(cache)) return;
      const handle = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        refreshGlobal(seq, null).catch((err) => logSilentFailure("Warm home cache", err));
      });
      return () => {
        cancelled = true;
        handle.cancel?.();
      };
    }

    const key = nearbyKey(lat, lng);
    let painted = false;
    (async () => {
      try {
        const nearby = await getNearbyProductFilter(lat, lng);
        if (cancelled || seq !== seqRef.current) return;
        if (!nearby) {
          setPhase("error");
          return;
        }
        nearbyRef.current = { key, filter: nearby };
        const noStoresNow = nearby.storeIds.length === 0;
        setNoStores(noStoresNow);
        if (noStoresNow) {
          // filter.productIds is already an empty Set when no store is within radius — passing it through (instead
          // of `undefined`) is what used to make the fetch load zero products instead of silently falling back to
          // the entire unfiltered platform catalog (bug_fixes doc, 2026-09-03). Nothing to fetch: paint the
          // "No stores near you" state directly.
          paintView(seq, {});
          return;
        }

        // Derive, don't refetch (speed-and-ease #5): the nearby view is the global set ∩ nearby ids.
        let cache = getMemoryHomeCache();
        if (!cache) {
          cache = await readHomeCatalogCache();
          if (cancelled || seq !== seqRef.current) return;
        }
        if (cache && instantNearby) {
          paintView(seq, deriveNearbyView(cache, nearby));
          painted = true;
          // Stale → ONE background global pull, written to the cache and re-derived; fresh → zero requests.
          if (!isHomeCatalogCacheFresh(cache)) await refreshGlobal(seq, nearby);
          return;
        }

        // No cache yet (cold install) or the instant view is inhibited: pull the nearby subset for the first paint.
        const result = await pullCatalog(`nearby:${key}`, nearby.productIds);
        if (cancelled || seq !== seqRef.current) return;
        paintView(seq, result.productsByCategory, result.categories);
        painted = true;
        if (!cache) {
          // Cold install: warm the shared cache once, off the paint, so the next address switch / cold start derives.
          InteractionManager.runAfterInteractions(() => {
            refreshGlobal(-1, null).catch((err) => logSilentFailure("Warm home cache", err));
          });
        }
      } catch (error) {
        logSilentFailure("Load home", error);
        if (cancelled || seq !== seqRef.current) return;
        // Keep a derived view on screen (stale-while-revalidate); only an unpainted session shows the error state.
        if (!painted) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, lat, lng, instantNearby, retryTick, paintView, refreshGlobal]);

  // ── Categories + remote banners: once per mount (both cached / non-throwing in the services) ──
  useEffect(() => {
    let cancelled = false;
    getAllCategories().then((data) => {
      if (!cancelled && data.length > 0) setCategories(data);
    });
    getRemoteBanners().then((remote) => {
      if (!cancelled) setRemoteBanners(remote);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Live reverse-geocode from device GPS (placeholder for the address pill while no location is set) ──
  // Deferred past first paint: GPS + reverse-geocode is a 500–2000 ms chain that competes with the catalog request
  // on the same connection. Scheduling it via InteractionManager lets the feed paint first (how Blinkit behaves on a
  // cold start). `useDeviceAddress` wraps the permission dialog in `beginNativePrompt()` so welcome/index redirect
  // pollers wait it out (MAP §7.6). Runs only when no location exists and once per app launch (module flag), so a
  // remount from select-location never replays the chain.
  useEffect(() => {
    if (!isHydrated || location || getLiveAddressCache().resolved) return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      requestDeviceAddress().then((result) => {
        // Denied or resolved — either way never replay this launch; `request()` itself never throws.
        setLiveAddressCache(result ? result.address : null, true);
        if (!result) return;
        setHomeUi({ liveAddress: result.address });
      });
    });
    return () => {
      cancelled = true;
      handle.cancel?.();
    };
  }, [isHydrated, location, requestDeviceAddress]);

  // Logout = authenticated true → false transition (MAP §7.14): drop the previous user's live address (C30).
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      return;
    }
    if (!wasAuthenticatedRef.current) return;
    wasAuthenticatedRef.current = false;
    // The module mirror itself is cleared by AuthContext.clearStoredSession(); this only resets the UI store.
    clearLiveAddressCache();
    setHomeUi({ liveAddress: null });
  }, [isAuthenticated]);

  // ── Focus: unread dot refresh, UI store focus flag ─────────────────────────
  useFocusEffect(
    useCallback(() => {
      setHomeUi({ focused: true });
      // rev. 2: the avatar dot is fed by lib/notificationService through the context; the 60 s cache keeps this cheap.
      refreshUnread();
      return () => {
        setHomeUi({ focused: false, scrolling: false });
      };
    }, [refreshUnread]),
  );

  // AppState is watched only while focused (no listener on a blurred tab).
  useEffect(() => {
    if (!focused) return;
    const sub = AppState.addEventListener("change", (state) => setHomeUi({ appActive: state === "active" }));
    return () => sub.remove();
  }, [focused]);

  // ── Android back: toast first, exit on the second press within 2 s (zephyr, motion M24) ──
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        const now = Date.now();
        if (getDevFlag("Dev_Shell_inhibit_BackToExitToast") || now - lastBackPressRef.current < BACK_EXIT_WINDOW_MS) {
          BackHandler.exitApp();
          return true;
        }
        lastBackPressRef.current = now;
        notify({ id: "back-exit", title: "Press back again to exit", duration: BACK_EXIT_WINDOW_MS });
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // ── Active orders (vega): diffed, gated, deduped poll ───────────────────────
  // There's no realtime option here (customer_orders' RLS-based realtime policies are dead for this app's phone-OTP
  // auth model, same reason useOrderTracking.ts's FALLBACK_POLL_MS exists), so this polls at a light cadence — and
  // only sets state when the active set (id/status/payment) or the top-product order actually changed, so an idle
  // Home never re-renders its feed every 20 s. Found 2026-09-09 / speed-and-ease #9.
  const applyFetchedOrders = useCallback((orders: Order[]) => {
    const active = splitActivePast(orders).active;
    const activeKey = activeKeyOf(active);
    const topIds = topProductIdsFrom(orders);
    const topKey = topIds.join(",");
    let changed = false;
    if (activeKey !== activeKeyRef.current) {
      activeKeyRef.current = activeKey;
      setActiveOrders(active);
      changed = true;
    }
    if (topKey !== topKeyRef.current) {
      topKeyRef.current = topKey;
      setUserTopProductIds(topIds);
      changed = true;
    }
    if (!changed && __DEV__ && !loggedOrdersNoChange) {
      loggedOrdersNoChange = true;
      console.log("[home] orders poll: nothing changed — no setState");
    }
  }, []);

  /** `force` bypasses the 20 s list TTL — the poll tick must hit the network every time (W3 R1-03). */
  const fetchOrders = useCallback((opts?: { force?: boolean }) => {
    if (!userId) return;
    const seq = ++ordersSeqRef.current;
    getUserOrders(userId, { force: opts?.force })
      .then((orders) => {
        if (seq !== ordersSeqRef.current) return;
        lastOrdersFetchAtRef.current = Date.now();
        applyFetchedOrders(orders);
      })
      .catch((err) => logSilentFailure("Refresh active orders", err));
  }, [userId, applyFetchedOrders]);

  // Instant banner paint on a cold start: the per-user disk row, applied only while no network fetch has landed.
  useEffect(() => {
    if (!userId) {
      activeKeyRef.current = "";
      topKeyRef.current = "";
      setActiveOrders([]);
      setUserTopProductIds([]);
      return;
    }
    if (getMemoryOrders()) return;
    let cancelled = false;
    readUserOrdersCache(userId)
      .then((cached) => {
        if (cancelled || !cached || lastOrdersFetchAtRef.current !== 0) return;
        applyFetchedOrders(cached);
      })
      .catch((err) => logSilentFailure("Read orders cache", err));
    return () => {
      cancelled = true;
    };
  }, [userId, applyFetchedOrders]);

  // Focus refetch — skipped while there is no active order and the last fetch is younger than 2 min.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const idle = activeCountRef.current === 0 && Date.now() - lastOrdersFetchAtRef.current < ORDERS_IDLE_REFRESH_MS;
      if (!idle) fetchOrders();
    }, [userId, fetchOrders]),
  );

  // 20 s poll only while an order is active, Home is focused and the app is active; `Dev_Vega_inhibit_ActivePoll`
  // disables the interval. Resuming from background fetches at once when the last fetch is older than a tick.
  const hasActiveOrders = activeOrders.length > 0;
  useEffect(() => {
    if (!userId || !focused || !appActive || !hasActiveOrders || inhibitActivePoll) return;
    if (Date.now() - lastOrdersFetchAtRef.current >= ACTIVE_ORDERS_POLL_MS) fetchOrders();
    const id = setInterval(() => fetchOrders({ force: true }), ACTIVE_ORDERS_POLL_MS);
    return () => clearInterval(id);
  }, [userId, focused, appActive, hasActiveOrders, inhibitActivePoll, fetchOrders]);

  useRefetchOnReconnect(() => fetchOrders(), !!userId && focused);

  // CartBar lifts over the banner while it shows (CONTRACTS §4.10); reset on blur / hide / unmount.
  const bannerVisible = hasActiveOrders && focused;
  useEffect(() => {
    setCartBarExtraBottom(bannerVisible ? ACTIVE_ORDER_BANNER_FOOTPRINT : 0);
    return () => setCartBarExtraBottom(0);
  }, [bannerVisible]);

  // ── Derived feed data ──────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, list] of Object.entries(view)) out[key.toLowerCase().trim()] = list.length;
    return out;
  }, [view]);

  const categoriesWithProducts = useMemo(
    () => categories.filter((c) => getCountForCategoryName(c.name, counts) > 0),
    [categories, counts],
  );

  /** Per category id (CategoryTileGrid reads it into the tile's accessibility label). */
  const tileCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of categoriesWithProducts) out[c.id] = getCountForCategoryName(c.name, counts);
    return out;
  }, [categoriesWithProducts, counts]);

  const categoryNames = useMemo(() => categoriesWithProducts.map((c) => c.name), [categoriesWithProducts]);

  /** id → product of the nearby view (one pass per view; the personalised and popular picks both go through it). */
  const viewById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const list of Object.values(view)) for (const p of list) map.set(p.id, p);
    return map;
  }, [view]);

  /** Frequently bought: the customer's own top products that are nearby, else the most popular nearby products. */
  const frequentlyBought = useMemo(() => {
    if (viewById.size === 0) return EMPTY_PRODUCTS;
    const personalised: Product[] = [];
    for (const id of userTopProductIds) {
      const p = viewById.get(id);
      if (p) personalised.push(p);
      if (personalised.length >= RAIL_LENGTH) break;
    }
    if (personalised.length > 0) return personalised;
    // Popularity order is precomputed per catalog set by the service; intersect with the nearby view.
    const popular: Product[] = [];
    for (const p of getPopularProducts(POPULAR_CANDIDATES)) {
      const nearbyProduct = viewById.get(p.id);
      if (nearbyProduct) popular.push(nearbyProduct);
      if (popular.length >= RAIL_LENGTH) break;
    }
    if (popular.length > 0) return popular;
    // Cold install (no memory catalog yet): rank the nearby view itself.
    return Array.from(viewById.values()).sort(compareByReviews).slice(0, RAIL_LENGTH);
  }, [viewById, userTopProductIds]);

  const banners = useMemo(() => getActiveBanners(Date.now(), [...BANNERS, ...remoteBanners]), [remoteBanners]);

  const hasLocation = location != null;

  // ── The virtualized list data ──────────────────────────────────────────────
  const listData = useMemo<HomeListItem[]>(() => {
    const out: HomeListItem[] = [{ kind: "header" }, { kind: "search", names: categoryNames }];

    if (phase === "error") {
      out.push({ kind: "empty", variant: "error" });
      return out;
    }

    if (categoriesWithProducts.length === 0) {
      out.push({ kind: "empty", variant: !hasLocation ? "noLocation" : noStores ? "noStores" : "noProducts" });
      return out;
    }

    if (!inhibitBanners && banners.length > 0) out.push({ kind: "banners", banners });
    out.push({ kind: "catTileGrid", categories: categoriesWithProducts, counts: tileCounts, capped: !inhibitTileCap });
    if (frequentlyBought.length > 0) out.push({ kind: "freqBought", products: frequentlyBought });

    for (const c of categoriesWithProducts) {
      const products = getProductsForCategoryName(c.name, view);
      if (products.length === 0) continue;
      const slug = c.slug ?? resolveCategorySlug(c.name, categories);
      out.push({ kind: "sectionHeader", categoryId: c.id, categoryName: c.name, slug });
      if (inhibitRails) {
        const visible = products.slice(0, LEGACY_SECTION_VISIBLE);
        for (let i = 0; i < visible.length; i += LEGACY_ROW_COUNT) {
          out.push({ kind: "productRow", rowKey: `${c.id}-r${i}`, categoryName: c.name, products: visible.slice(i, i + LEGACY_ROW_COUNT) });
        }
        if (products.length > LEGACY_SECTION_VISIBLE && slug) {
          out.push({ kind: "seeAllBar", categoryId: c.id, categoryName: c.name, slug });
        }
      } else {
        out.push({ kind: "productRail", categoryId: c.id, categoryName: c.name, products: products.slice(0, RAIL_LENGTH) });
      }
    }
    out.push({ kind: "endStamp" });
    return out;
  }, [
    phase,
    categoryNames,
    categoriesWithProducts,
    hasLocation,
    noStores,
    inhibitBanners,
    banners,
    tileCounts,
    inhibitTileCap,
    frequentlyBought,
    view,
    categories,
    inhibitRails,
  ]);

  useEffect(() => {
    listDataRef.current = listData;
  }, [listData]);

  // Boot timeline: the first non-empty catalog paint.
  const hasProducts = categoriesWithProducts.length > 0;
  useEffect(() => {
    if (hasProducts) markBoot("catalog-painted");
  }, [hasProducts]);

  // Warm expo-image with the first rails' first cards (honours Dev_Images_inhibit_Prefetch inside the service).
  useEffect(() => {
    if (categoriesWithProducts.length === 0) return;
    const urls: (string | undefined)[] = [];
    for (const c of categoriesWithProducts.slice(0, PREFETCH_RAILS)) {
      for (const p of getProductsForCategoryName(c.name, view).slice(0, PREFETCH_PER_RAIL)) urls.push(p.image_url);
    }
    prefetchImages(urls, PREFETCH_WIDTH);
  }, [categoriesWithProducts, view]);

  // ── Handlers (all identity-stable, so `renderItem` never changes) ──────────

  const retry = useCallback(() => {
    setPhase("booting");
    setRetryTick((t) => t + 1);
  }, []);

  const handleTileSelect = useCallback((category: Category) => {
    const slug = category.slug ?? resolveCategorySlug(category.name, categoriesRef.current);
    if (!slug) {
      logSilentFailure("Home tile without slug", new Error(category.name));
      return;
    }
    router.push(`/category/${slug}`);
  }, []);

  /** Chip press → scroll the feed so that category's header lands just under the sticky band (lyra / BP-10). */
  const handleChipSelect = useCallback((name: string) => {
    const index = listDataRef.current.findIndex((it) => it.kind === "sectionHeader" && it.categoryName === name);
    if (index < 0) return;
    setHomeUi({ activeName: name });
    try {
      listRef.current
        ?.scrollToIndex({ index, viewOffset: stickyHeightRef.current, animated: !reducedRef.current })
        .catch((err) => logSilentFailure("Scroll to category", err));
    } catch (err) {
      logSilentFailure("Scroll to category", err);
    }
  }, []);

  const handleStickyLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) stickyHeightRef.current = h;
  }, []);

  /** The highlighted chip follows the first category section in view. */
  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<HomeListItem>[] }) => {
    let name: string | null = null;
    for (const token of viewableItems) {
      const it = token.item;
      if (
        it &&
        (it.kind === "sectionHeader" || it.kind === "productRail" || it.kind === "productRow" || it.kind === "seeAllBar")
      ) {
        name = it.categoryName;
        break;
      }
    }
    setHomeUi({ activeName: name });
  }, []);

  /** Pauses the search placeholder rotation while the feed moves (motion M31); resumes after 250 ms of quiet. */
  const handleScroll = useCallback(() => {
    setHomeUi({ scrolling: true });
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollIdleTimerRef.current = null;
      setHomeUi({ scrolling: false });
    }, SCROLL_IDLE_MS);
  }, []);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    // Only supersede the catalog writers when a nearby filter has resolved — otherwise the location effect still owns
    // the first paint and a bumped sequence would strand it.
    const current = nearbyRef.current;
    const seq = current ? ++seqRef.current : seqRef.current;
    try {
      await Promise.all([
        getAllCategories({ force: true }).then((data) => {
          if (seq === seqRef.current && data.length > 0) setCategories(data);
        }),
        getRemoteBanners().then((remote) => {
          if (seq === seqRef.current) setRemoteBanners(remote);
        }),
        current && current.filter.storeIds.length > 0
          ? instantNearby
            ? refreshGlobal(seq, current.filter)
            : pullCatalog(`nearby:${current.key}`, current.filter.productIds).then((result) =>
                paintView(seq, result.productsByCategory, result.categories),
              )
          : Promise.resolve(),
      ]);
    } catch (err) {
      logSilentFailure("Refresh home", err);
    } finally {
      setRefreshing(false);
    }
  }, [instantNearby, refreshGlobal, paintView]);

  const primaryOrder = activeOrders[0] ?? null;
  const primaryOrderId = primaryOrder?.id;
  const handleOrderPress = useCallback(() => {
    if (primaryOrderId) router.push(`/order/track/${primaryOrderId}`);
  }, [primaryOrderId]);

  const handleRootLayout = useCallback(() => {
    if (firstPaintRef.current) return;
    firstPaintRef.current = true;
    markBoot("home-first-paint");
  }, []);

  // ── Item renderer: no cart state, no volatile state — every dep is identity-stable ──
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<HomeListItem>) => {
      switch (item.kind) {
        case "header":
          return <HeaderCell />;
        case "search":
          return <StickyCell names={item.names} onSelect={handleChipSelect} onLayout={handleStickyLayout} />;
        case "banners":
          return <BannersCell banners={item.banners} />;
        case "catTileGrid":
          return (
            <CategoryTileGrid
              categories={item.categories}
              counts={item.counts}
              capped={item.capped}
              onSelect={handleTileSelect}
              onSeeAll={goToCategories}
              testID="home-tiles"
            />
          );
        case "freqBought":
          return <ProductRail title="Frequently bought" accent={C.deal} products={item.products} testID="home-freq" />;
        case "sectionHeader":
          return <SectionHeader name={item.categoryName} slug={item.slug} />;
        case "productRail":
          return <ProductRail products={item.products} testID={`home-rail-${item.categoryId}`} />;
        case "productRow":
          return <LegacyProductRow products={item.products} />;
        case "seeAllBar":
          return <LegacySeeAllBar name={item.categoryName} slug={item.slug} />;
        case "endStamp":
          return <EndStamp />;
        case "empty":
          return <EmptyCell variant={item.variant} onRetry={retry} />;
      }
    },
    [handleChipSelect, handleStickyLayout, handleTileSelect, retry],
  );

  // List padding composes the absolute tab bar, the active-orders banner and the global CartBar (MAP §7.3).
  const contentContainerStyle = useMemo(
    () => ({
      paddingBottom: layout.scrollBottomTab + (hasActiveOrders ? ACTIVE_ORDER_BANNER_FOOTPRINT : 0) + cartBarFootprint,
    }),
    [hasActiveOrders, cartBarFootprint],
  );

  // ── Loading (skeleton-first) ───────────────────────────────────────────────
  const loading = phase === "booting";
  const showSkeleton = useForceSkeleton(loading);
  const slow = useSlowLoad(loading);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Screen bg={C.bg} edges={["top"]}>
      <View style={styles.root} onLayout={handleRootLayout}>
        {showSkeleton ? (
          <HomeSkeleton slow={slow} onRetry={retry} testID="home-skeleton" />
        ) : (
          <FlashList
            ref={listRef}
            data={listData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            stickyHeaderIndices={STICKY_INDICES}
            drawDistance={400}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={contentContainerStyle}
            onScroll={handleScroll}
            scrollEventThrottle={64}
            viewabilityConfig={VIEWABILITY_CONFIG}
            onViewableItemsChanged={handleViewableItemsChanged}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
            }
            testID="home-feed"
          />
        )}

        {primaryOrder ? (
          <ActiveOrdersBanner
            order={primaryOrder}
            extraCount={activeOrders.length - 1}
            onPress={handleOrderPress}
            testID="home-active-order"
          />
        ) : null}
      </View>
    </Screen>
  );
}

// ─── Cells ────────────────────────────────────────────────────────────────────

/** Item 0: the TabHeader. Reads its own inputs so a location / unread / live-address change re-renders this cell only. */
function HeaderCell() {
  const { location } = useLocation();
  const { open, unreadCount } = useProfileMenu();
  const { user } = useAuth();
  const liveAddress = useHomeUi("liveAddress");
  // A location the customer explicitly set (a saved address, a manual pin drop) must always win over the device's
  // live GPS reverse-geocode — liveAddress is only a cold-start placeholder for before any location is known, never
  // a silent override of a deliberate choice. See bug_fixes doc, 2026-09-03.
  const addressLine = location ? (location.address ?? null) : liveAddress;
  return (
    <TabHeader
      variant="home"
      addressLabel={location?.label ?? null}
      addressLine={addressLine}
      onAddressPress={goToSelectLocation}
      avatarInitial={user?.name}
      unread={unreadCount > 0}
      onAvatarPress={open}
      testID="home-header"
    />
  );
}

/** Item 1 (sticky): the search band + the category chip strip on an opaque C.bg band with a hairline under it. */
const StickyCell = React.memo(function StickyCell({
  names,
  onSelect,
  onLayout,
}: {
  names: readonly string[];
  onSelect: (name: string) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const activeName = useHomeUi("activeName");
  const scrolling = useHomeUi("scrolling");
  const focused = useHomeUi("focused");
  return (
    <View style={styles.sticky} onLayout={onLayout}>
      <SearchBand mode="button" rotate={!scrolling && focused} style={styles.searchBand} testID="home-search" />
      <CategoryChipStrip names={names} activeName={activeName} onSelect={onSelect} testID="home-chips" />
    </View>
  );
});

/** Banners: auto-advance only while the tab is focused and the app is active (deneb). */
function BannersCell({ banners }: { banners: Banner[] }) {
  const focused = useHomeUi("focused");
  const appActive = useHomeUi("appActive");
  return <BannerCarousel banners={banners} focused={focused && appActive} style={styles.banners} testID="home-banners" />;
}

/** Category section header: `text.h3` + "See all ›" (12/700 C.primary, silent navigation; hidden when no slug). */
const SectionHeader = React.memo(function SectionHeader({ name, slug }: { name: string; slug: string | null }) {
  const handlePress = useCallback(() => {
    if (slug) router.push(`/category/${slug}`);
  }, [slug]);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        {name}
      </Text>
      {slug ? (
        <PressableScale
          scale={motion.scale.row}
          onPress={handlePress}
          hitSlop={SEE_ALL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`See all ${name}`}
          innerStyle={styles.seeAll}
          pressedStyle={styles.seeAllPressed}
        >
          <Text style={styles.seeAllText} maxFontSizeMultiplier={1.3}>
            See all ›
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
});

/** Legacy 3-column grid row (`Dev_Home_inhibit_Rails`): `ProductCard variant="grid"`, short rows padded. */
const LegacyProductRow = React.memo(function LegacyProductRow({ products }: { products: Product[] }) {
  const pad = LEGACY_ROW_COUNT - products.length;
  return (
    <View style={styles.legacyRow}>
      {products.map((p) => (
        <ProductCard key={p.id} variant="grid" product={p} style={styles.legacyCard} recycled />
      ))}
      {pad > 0 ? Array.from({ length: pad }, (_, i) => <View key={`pad-${i}`} style={styles.legacyCard} />) : null}
    </View>
  );
});

/** Legacy "See all products in X" bar (`Dev_Home_inhibit_Rails`) — silent navigation to the category screen. */
const LegacySeeAllBar = React.memo(function LegacySeeAllBar({ name, slug }: { name: string; slug: string }) {
  const handlePress = useCallback(() => {
    router.push(`/category/${slug}`);
  }, [slug]);
  return (
    <PressableScale
      scale={motion.scale.cta}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`See all ${name}`}
      style={styles.legacySeeAllOuter}
      innerStyle={styles.legacySeeAll}
      pressedStyle={styles.legacySeeAllPressed}
    >
      <Text style={styles.legacySeeAllText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {`See all products in ${name}`}
      </Text>
      <MaterialCommunityIcons name="arrow-right" size={16} color={C.primary} />
    </PressableScale>
  );
});

function EndStamp() {
  return (
    <View style={styles.endStamp} accessible accessibilityRole="text">
      <MaterialCommunityIcons name="leaf" size={14} color={C.textSub} />
      <Text style={styles.endStampText} maxFontSizeMultiplier={1.3}>
        That&apos;s everything fresh near you
      </Text>
    </View>
  );
}

const EMPTY_COPY: Record<
  EmptyVariant,
  { icon: IconName; title: string; text: string; action: { label: string; kind: "location" | "retry" } }
> = {
  noLocation: {
    icon: "map-marker-outline",
    title: "Set your location",
    text: "We'll show stores that deliver to you",
    action: { label: "Choose location", kind: "location" },
  },
  noStores: {
    icon: "storefront-outline",
    title: "No stores near you",
    text: "Try a different address within 4 km of a store",
    action: { label: "Change location", kind: "location" },
  },
  noProducts: {
    icon: "package-variant-closed",
    title: "Nothing in stock right now",
    text: "Pull down to refresh, or try again in a moment",
    action: { label: "Retry", kind: "retry" },
  },
  error: {
    icon: "alert-circle-outline",
    title: "Couldn't load products",
    text: "Check your connection and try again",
    action: { label: "Retry", kind: "retry" },
  },
};

/** Empty AND error states, one `EmptyState` each; location CTAs go to /select-location (U35), the rest Retry. */
const EmptyCell = React.memo(function EmptyCell({ variant, onRetry }: { variant: EmptyVariant; onRetry: () => void }) {
  const copy = EMPTY_COPY[variant];
  return (
    <View style={styles.emptyWrap}>
      <EmptyState
        fill
        iconWrap
        icon={copy.icon}
        title={copy.title}
        text={copy.text}
        action={{ label: copy.action.label, onPress: copy.action.kind === "location" ? goToSelectLocation : onRetry }}
        testID={`home-empty-${variant}`}
      />
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Sticky cell: opaque so the feed never shows through once stuck; the hairline is the one separator for the header.
  sticky: {
    backgroundColor: C.bg,
    paddingTop: 4,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
  },
  searchBand: { marginHorizontal: layout.gutter },

  banners: { paddingTop: 12 },

  // 44 px: h3 line height 22 + 12 above + 10 below (HOME_ITEM_SIZE.sectionHeader).
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: layout.gutter,
    paddingTop: 12,
    paddingBottom: 10,
  },
  sectionTitle: { ...text.h3, flex: 1 },
  seeAll: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.md },
  seeAllPressed: { backgroundColor: C.primaryXLight },
  seeAllText: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.primary },

  legacyRow: {
    flexDirection: "row",
    paddingHorizontal: layout.gutter,
    columnGap: layout.gridGap,
    marginBottom: layout.gridGap,
  },
  legacyCard: { flex: 1 },
  legacySeeAllOuter: { marginHorizontal: layout.gutter, marginBottom: layout.gridGap },
  legacySeeAll: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.xxl,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  legacySeeAllPressed: { backgroundColor: C.bgSoft },
  legacySeeAllText: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, color: C.primary, flexShrink: 1 },

  endStamp: {
    marginTop: 24,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: layout.gutter,
    paddingVertical: 8,
  },
  endStampText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16, color: C.textSub },

  emptyWrap: { minHeight: EMPTY_MIN_HEIGHT, justifyContent: "center" },
});
