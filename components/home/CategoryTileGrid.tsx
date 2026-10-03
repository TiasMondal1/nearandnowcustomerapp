// CategoryTileGrid — Home's "Shop by category" 4-column tile grid (CONTRACTS §4.18 · design/blinkit-parity §2.3 /
// BP-09). Capped at 8 + an "All categories" tile so the first product rail stays within the first screen
// (speed-and-ease #17); the screen lifts the cap under `Dev_Home_inhibit_TileCap` by passing `capped={false}`.
// Every tile press is navigation and therefore silent (CONTRACTS §8). Tile handlers are stable per category id,
// so a Home re-render never re-renders a tile (MAP P13). No SoftPanel / doodles — the pastel tiles zone themselves.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { categoryFallbackIcon, categoryTint } from "../../constants/categoryTints";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import type { Category } from "../../lib/categoryService";
import { cdnImage } from "../../lib/imageUrl";
import { PressableScale } from "../ui";

export type CategoryTileGridProps = {
  /** Categories that have products nearby, in display order. */
  categories: Category[];
  /** Optional product count per category id — read into the tile's accessibility label ("Dairy, 24 products"). */
  counts?: Record<string, number>;
  /** true: first 8 + the "All categories" tile · false (`Dev_Home_inhibit_TileCap`): every category, no extra tile. */
  capped: boolean;
  /** Tile press (navigation — the screen pushes `/category/${slug}`). Keep it stable (`useCallback`). */
  onSelect: (category: Category) => void;
  /** "All categories" tile press (the screen pushes `/(tabs)/categories`). */
  onSeeAll: () => void;
  /** Root testID; tiles get `${testID}-${category.id}`, the extra tile `${testID}-all`. */
  testID?: string;
};

/** Tiles shown while `capped` (two rows of four) before the "All categories" tile. */
const TILE_CAP = 8;
const TILE_IMAGE = 68;
const TILE_GLYPH = 28;
/** Rendered-width hint for `cdnImage` (68 pt tile ≈ 2.3×). */
const TILE_IMAGE_WIDTH_HINT = 160;

// ─── Stable per-tile handlers ─────────────────────────────────────────────────
// Module-level by design (card spec): one closure per category id, rebuilt only when `onSelect` changes identity, so
// a Home re-render hands every memoised tile the very same `onPress` (no inline arrows). Each closure resolves the
// LATEST Category object for its id at press time — a catalog refresh may replace the object but never the id.

let boundSelect: ((category: Category) => void) | null = null;
const latestById = new Map<string, Category>();
const handlerById = new Map<string, () => void>();

function tileHandlers(categories: Category[], onSelect: (category: Category) => void): (() => void)[] {
  if (boundSelect !== onSelect) {
    boundSelect = onSelect;
    handlerById.clear();
  }
  return categories.map((category) => {
    const id = category.id;
    latestById.set(id, category);
    let handler = handlerById.get(id);
    if (!handler) {
      handler = () => {
        const current = latestById.get(id);
        if (current) onSelect(current);
      };
      handlerById.set(id, handler);
    }
    return handler;
  });
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

function CategoryTileGridBase({ categories, counts, capped, onSelect, onSeeAll, testID }: CategoryTileGridProps) {
  const visible = useMemo(() => (capped ? categories.slice(0, TILE_CAP) : categories), [categories, capped]);
  const handlers = useMemo(() => tileHandlers(visible, onSelect), [visible, onSelect]);

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          Shop by category
        </Text>
      </View>
      <View style={styles.grid}>
        {visible.map((category, i) => (
          <CategoryTile
            key={category.id}
            category={category}
            index={i}
            count={counts?.[category.id]}
            onPress={handlers[i]}
            testID={testID ? `${testID}-${category.id}` : undefined}
          />
        ))}
        {capped ? <AllCategoriesTile onPress={onSeeAll} testID={testID ? `${testID}-all` : undefined} /> : null}
      </View>
    </View>
  );
}

/** Memoised on the props' identities: `categories`, `counts`, `onSelect`, `onSeeAll` should be stable in the screen. */
export const CategoryTileGrid: React.MemoExoticComponent<(props: CategoryTileGridProps) => React.JSX.Element> =
  React.memo(CategoryTileGridBase);
CategoryTileGrid.displayName = "CategoryTileGrid";

// ─── Tiles ────────────────────────────────────────────────────────────────────

/** 25 % column: 68 px tinted square (expo-image cover or the index-based fallback glyph) + 11/700 two-line label. */
const CategoryTile = React.memo(function CategoryTile({
  category,
  index,
  count,
  onPress,
  testID,
}: {
  category: Category;
  index: number;
  count?: number;
  onPress: () => void;
  testID?: string;
}) {
  const uri = cdnImage(category.image_url, TILE_IMAGE_WIDTH_HINT);
  const label = count != null ? `${category.name}, ${count} ${count === 1 ? "product" : "products"}` : category.name;

  return (
    <PressableScale
      scale={motion.scale.tile}
      onPress={onPress}
      pressedStyle={styles.tilePressed}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.tile}
      innerStyle={styles.tileInner}
      testID={testID}
    >
      <View style={[styles.tileImage, { backgroundColor: categoryTint(index) }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.tileImageFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
            recyclingKey={category.id}
            priority="low"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <MaterialCommunityIcons name={categoryFallbackIcon(index)} size={TILE_GLYPH} color={C.primary} />
        )}
      </View>
      <Text style={styles.tileLabel} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {category.name}
      </Text>
    </PressableScale>
  );
});

/** The ninth tile under the cap: `view-grid-outline` on `C.primaryXLight`, labelled "All categories". */
const AllCategoriesTile = React.memo(function AllCategoriesTile({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <PressableScale
      scale={motion.scale.tile}
      onPress={onPress}
      pressedStyle={styles.tilePressed}
      accessibilityRole="button"
      accessibilityLabel="All categories"
      style={styles.tile}
      innerStyle={styles.tileInner}
      testID={testID}
    >
      <View style={[styles.tileImage, styles.allTileImage]}>
        <MaterialCommunityIcons name="view-grid-outline" size={TILE_GLYPH} color={C.primary} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        All categories
      </Text>
    </PressableScale>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {},
  // 44 px tall: h3 line height 22 + 12 above + 10 below (HOME_ITEM_SIZE.catTileHeader).
  header: { paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 10 },
  headerTitle: { ...text.h3 },
  // Tiles carry 4 px of their own horizontal padding, so the row pads 12 to land on the 16 px gutter.
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: layout.gutter - 4 },
  tile: { width: "25%" },
  tileInner: { alignItems: "center", paddingHorizontal: 4, paddingVertical: 12, gap: 8, borderRadius: radius.xxl },
  tilePressed: { backgroundColor: C.border },
  // Clips the cover image to r14; flat (no shadow), so the clip is safe on Android.
  tileImage: {
    width: TILE_IMAGE,
    height: TILE_IMAGE,
    borderRadius: radius.xxl,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  tileImageFill: { ...StyleSheet.absoluteFillObject },
  allTileImage: { backgroundColor: C.primaryXLight },
  tileLabel: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: C.text, textAlign: "center" },
});
