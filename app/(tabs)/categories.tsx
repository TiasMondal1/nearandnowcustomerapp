// Categories tab — the shared TabHeader (atlas) over flat tile groups (design/blinkit-parity §2.3 / §3.2 ·
// BP-05 / BP-09 · speed-and-ease #32). ONE mount effect: the category list comes from the cached service, the
// per-category counts from the memory catalog (no inline Supabase query, no 5000-id IN list — MAP C4/C6, P15).
// Tiles are 4-up, r14, flat, on the cream ground; no wash panels or doodle layers. Tile presses are navigation and
// therefore silent; pull-to-refresh plays the tap tick (CONTRACTS §8). No codename header: the tab itself has
// none in CONTRACTS §10 — the TabHeader it mounts carries atlas.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  EmptyState,
  PressableScale,
  Screen,
  Skeleton,
  SkeletonScreen,
  TabHeader,
  useCartBarFootprint,
} from "../../components/ui";
import {
  CATEGORY_GROUPS,
  DEFAULT_GROUP,
  getGroupForCategoryName,
  type CategoryGroupDef,
} from "../../constants/categoryGroups";
import { categoryFallbackIcon, categoryTint } from "../../constants/categoryTints";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useLocation, type ActiveLocation } from "../../context/LocationContext";
import { useProfileMenu } from "../../context/ProfileMenuContext";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { getAllCategories, peekCategories, type Category } from "../../lib/categoryService";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { cdnImage } from "../../lib/imageUrl";
import { logSilentFailure } from "../../lib/logSilentFailure";
import {
  getCountForCategoryName,
  getMemoryHomeCache,
  groupProductsByCategory,
  type HomeCatalogCache,
} from "../../lib/productService";
import { peekNearbyProductFilter } from "../../lib/storeService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Skeleton: two groups × eight tiles, mirroring the real 4-column grid. */
const SKELETON_GROUPS = [0, 1] as const;
const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** Fallback glyph size inside a tinted tile. */
const TILE_GLYPH = 28;
/** `cdnImage` width hint: a 25 % column on a 360 pt device is ~82 pt wide (≈ 2×). */
const TILE_IMAGE_WIDTH_HINT = 160;

type Counts = Record<string, number>;
type Tile = { category: Category; tintIndex: number };
type Section = { group: CategoryGroupDef; tiles: Tile[] };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Lower-cased category name → product count. With a location AND the nearby filter in memory the counts come from
 * the NEARBY view (the same derive Home uses), so a category stocked only by out-of-radius stores is hidden here
 * exactly as Home hides it and category/[slug] empties it (W3 R1-10, MAP §2.11 #39). No location / no nearby
 * filter yet → the global catalog; `null` when no catalog is in memory at all.
 */
function countsFromCache(cache: HomeCatalogCache | null, location: ActiveLocation | null): Counts | null {
  if (!cache?.productsByCategory) return null;
  let byCategory = cache.productsByCategory;
  if (location) {
    const nearby = peekNearbyProductFilter(location.latitude, location.longitude);
    if (nearby) {
      const ids = nearby.productIds;
      byCategory = groupProductsByCategory(cache.products.filter((p) => ids.has(p.id)));
    }
  }
  const counts: Counts = {};
  for (const [name, list] of Object.entries(byCategory)) {
    counts[name.toLowerCase().trim()] = list.length;
  }
  return counts;
}

/**
 * Groups by `CATEGORY_GROUPS` / `getGroupForCategoryName` (constants/categoryGroups.ts is frozen in wave 2; W3
 * applies the X9 word-boundary change). With a catalog in memory, categories with no products are hidden — as
 * today; without one, every category shows (tiles without counts). The tint index runs across all groups so two
 * neighbouring groups never restart on the same pastel.
 */
function buildSections(categories: Category[], counts: Counts | null): Section[] {
  const byGroupId = new Map<string, Tile[]>();
  let tintIndex = 0;
  for (const category of categories) {
    if (counts && getCountForCategoryName(category.name, counts) <= 0) continue;
    const group = getGroupForCategoryName(category.name);
    const tile: Tile = { category, tintIndex: tintIndex++ };
    const list = byGroupId.get(group.id);
    if (list) list.push(tile);
    else byGroupId.set(group.id, [tile]);
  }
  const out: Section[] = [];
  for (const group of CATEGORY_GROUPS) {
    const tiles = byGroupId.get(group.id);
    if (tiles?.length) out.push({ group, tiles });
  }
  const rest = byGroupId.get(DEFAULT_GROUP.id);
  if (rest?.length) out.push({ group: DEFAULT_GROUP, tiles: rest });
  return out;
}

function openCategory(slug: string): void {
  router.push(`/category/${slug}`);
}

function openLocation(): void {
  router.push({ pathname: "/select-location", params: { returnTo: "/(tabs)/categories" } });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CategoriesScreen() {
  const { user } = useAuth();
  const { location } = useLocation();
  const { open, unreadCount } = useProfileMenu();
  const inhibitAvatar = useDevFlag("Dev_Atlas_inhibit_Feature");
  const cartBarFootprint = useCartBarFootprint();

  // SWR seed (MAP §2.6 #27): the cached category list and the memory catalog paint on the first frame.
  const [categories, setCategories] = useState<Category[]>(() => peekCategories() ?? []);
  const [counts, setCounts] = useState<Counts | null>(() => countsFromCache(getMemoryHomeCache(), location));
  const [loading, setLoading] = useState(() => (peekCategories()?.length ?? 0) === 0);
  const [refreshing, setRefreshing] = useState(false);
  // 0 = the mount load (cache hit); every bump is a user-driven reload that forces the network.
  const [reloadNonce, setReloadNonce] = useState(0);

  // The ONE data effect (speed-and-ease #32): categories through the 60-min query cache (forced on retry /
  // pull-to-refresh), counts re-read from whatever catalog Home has put in memory by now.
  useEffect(() => {
    let cancelled = false;
    getAllCategories({ force: reloadNonce > 0 })
      .then((list) => {
        if (cancelled) return;
        setCategories(list);
        setCounts(countsFromCache(getMemoryHomeCache(), location));
      })
      .catch((err) => {
        if (!cancelled) logSilentFailure("Load categories", err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // `location` is read on focus below; the mount load keys on the reload nonce only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce]);

  // Re-read the counts on every focus: Home may have resolved the nearby filter (or the location changed) meanwhile.
  useFocusEffect(
    useCallback(() => {
      setCounts(countsFromCache(getMemoryHomeCache(), location));
    }, [location]),
  );

  const sections = useMemo(() => buildSections(categories, counts), [categories, counts]);
  const showSkeleton = useForceSkeleton(loading);

  const onRefresh = useCallback(() => {
    feedback.tapSound();
    setRefreshing(true);
    setReloadNonce((n) => n + 1);
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadNonce((n) => n + 1);
  }, []);

  const avatarInitial = user?.name?.trim().charAt(0) || undefined;
  const scrollPadding = useMemo(
    () => [styles.scrollContent, { paddingBottom: layout.scrollBottomTab + cartBarFootprint }],
    [cartBarFootprint],
  );

  return (
    <Screen bg={C.bg} edges={["top"]}>
      <TabHeader
        variant="tab"
        title="Categories"
        addressLabel={location?.label ?? null}
        addressLine={location?.address ?? null}
        onAddressPress={openLocation}
        avatarInitial={avatarInitial}
        onAvatarPress={open}
        showAvatar={!inhibitAvatar}
        unread={unreadCount > 0}
        testID="categories-header"
      />

      {showSkeleton ? (
        <CategoriesSkeleton />
      ) : (
        <ScrollView
          contentContainerStyle={scrollPadding}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          testID="categories-scroll"
        >
          {sections.length === 0 ? (
            <EmptyState
              fill
              iconWrap
              icon="view-grid-outline"
              title="No categories yet"
              text="Check back soon for new categories"
              action={{ label: "Retry", onPress: retry }}
            />
          ) : (
            sections.map(({ group, tiles }) => (
              <View key={group.id} style={styles.section}>
                <Text style={styles.sectionTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                  {group.title}
                </Text>
                <View style={styles.grid}>
                  {tiles.map(({ category, tintIndex }) => (
                    <CategoryTile
                      key={category.id}
                      category={category}
                      tintIndex={tintIndex}
                      count={counts ? getCountForCategoryName(category.name, counts) : undefined}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

/**
 * 25 % column: square tinted image wrap (`aspectRatio 1`, r14, no shadow — the clip is safe on Android because the
 * tile is flat) with the category art or the index-based fallback glyph, then a 12/600 two-line label. Press scale
 * 0.94 (`motion.scale.tile`), pressed face C.border, silent (navigation). No press-in warm-up (rev. 2): the category
 * screen seeds itself from the memory catalog instead.
 */
const CategoryTile = React.memo(function CategoryTile({
  category,
  tintIndex,
  count,
}: {
  category: Category;
  tintIndex: number;
  count?: number;
}) {
  const uri = cdnImage(category.image_url, TILE_IMAGE_WIDTH_HINT);
  const label = count != null ? `${category.name}, ${count} ${count === 1 ? "product" : "products"}` : category.name;

  return (
    <PressableScale
      scale={motion.scale.tile}
      onPress={() => openCategory(category.slug)}
      pressedStyle={styles.tilePressed}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the category"
      style={styles.tile}
      innerStyle={styles.tileInner}
      testID={`categories-tile-${category.id}`}
    >
      <View style={[styles.tileImageWrap, { backgroundColor: categoryTint(tintIndex) }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.tileImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
            recyclingKey={category.id}
            priority="low"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <MaterialCommunityIcons name={categoryFallbackIcon(tintIndex)} size={TILE_GLYPH} color={C.primary} />
        )}
      </View>
      <Text style={styles.tileLabel} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {category.name}
      </Text>
    </PressableScale>
  );
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/** Two groups of eight square tiles inside one `SkeletonScreen` ("Loading categories…"), same geometry as the grid. */
function CategoriesSkeleton() {
  return (
    <SkeletonScreen label="Loading categories…" style={styles.skeletonWrap}>
      {SKELETON_GROUPS.map((g) => (
        <View key={g} style={styles.section}>
          <Skeleton width={g === 0 ? 150 : 120} height={17} style={styles.skeletonTitle} />
          <View style={styles.grid}>
            {SKELETON_TILES.map((i) => (
              <View key={i} style={[styles.tile, styles.tileInner]}>
                <View style={styles.tileImageWrap}>
                  <Skeleton width="100%" height="100%" radius={radius.xxl} />
                </View>
                <Skeleton width="60%" height={12} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </SkeletonScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  skeletonWrap: { flex: 1, overflow: "hidden" },
  skeletonTitle: { marginBottom: 10 },

  section: { paddingTop: 20 },
  sectionTitle: { ...text.h3, paddingHorizontal: layout.gutter, marginBottom: 10 },
  // Tiles carry 4 px of their own horizontal padding, so the row pads 12 to land on the 16 px gutter.
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: layout.gutter - 4 },

  tile: { width: "25%" },
  tileInner: { alignItems: "center", paddingHorizontal: 4, paddingVertical: 8, gap: 8, borderRadius: radius.xxl },
  tilePressed: { backgroundColor: C.border },
  // Clips the cover image to r14; flat (no shadow), so the clip is safe on Android (MAP §7.4).
  tileImageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.xxl,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  tileImage: { ...StyleSheet.absoluteFillObject },
  tileLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: C.text,
    textAlign: "center",
    minHeight: 32,
  },
});
