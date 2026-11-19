// HomeSkeleton — Home's loading layout, mirroring the new feed order 1:1 (CONTRACTS §4.18 · design/blinkit-parity
// §2.11 · speed-and-ease #12 / #25): header block, search band, chip strip, banner, 8 tiles, one rail. Every block is
// a `Skeleton` on the ONE shared colour clock (codename onyx); only the banner (≥ 80 px) earns the gradient sweep.
// Wrapped in `SkeletonScreen` so assistive tech hears a single "Loading…"; the slow-load hint and its Retry button sit
// OUTSIDE that wrapper so the button stays reachable — and at the TOP, over the header blocks: the skeleton is taller
// than most screens and does not scroll, so a hint rendered after it sat below the fold (or under the tab bar) and
// a stalled first load had no visible way out.
import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, radius } from "../../constants/ui";
import { BrandLogo } from "../brand";
import { PrimaryButton, Skeleton, SkeletonProductCard, SkeletonScreen } from "../ui";
import { BANNER_CAROUSEL_HEIGHT } from "./BannerCarousel";

/** Banner card height at the 360 pt reference width ((360 − 32) / 2.25). */
const BANNER_SKELETON_HEIGHT = 146;
const TILE_IMAGE = 68;
const CHIP_KEYS = [0, 1, 2, 3] as const;
const TILE_KEYS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const RAIL_KEYS = [0, 1, 2] as const;
/** Height of the skeleton's header block (paddings + the three lines) — the slow-load hint covers exactly it. */
const HEADER_BLOCK_HEIGHT = 91;

/**
 * Home's skeleton. `slow` (from `useSlowLoad(loading)`) puts "Still loading… check your connection" and a ghost
 * Retry (`onRetry`) over the header blocks at the top (an overlay, so nothing below it shifts when it appears).
 * Hidden from assistive tech except the single progressbar announcement and the Retry button.
 */
export function HomeSkeleton(props?: { slow?: boolean; onRetry?: () => void; testID?: string }): React.JSX.Element {
  const slow = props?.slow ?? false;
  const onRetry = props?.onRetry;
  const { fontScale, width } = useWindowDimensions();
  // Same gate as TabHeader's mark, so the skeleton and the real header agree.
  const markVisible = fontScale <= 1.15 && width >= 340;

  return (
    <View style={styles.root} testID={props?.testID}>
      <SkeletonScreen>
        {/* Header: the real brand mark (as in TabHeader, same font-scale / width gate) · eyebrow · h2 greeting ·
            address line. The three lines are 67 px tall, the mark 2 + 34, so the block height does not change. */}
        <View style={styles.header}>
          {markVisible ? <BrandLogo variant="mark" height={34} style={styles.mark} /> : null}
          <View>
            <Skeleton width={120} height={11} />
            <Skeleton width={160} height={28} radius={radius.md} style={styles.mt8} />
            <Skeleton width={220} height={12} style={styles.mt8} />
          </View>
        </View>
        {/* Search band */}
        <View style={styles.gutter}>
          <Skeleton height={layout.searchBandHeight} radius={radius.xl} />
        </View>
        {/* Chip strip */}
        <View style={styles.chips}>
          {CHIP_KEYS.map((k) => (
            <Skeleton key={k} width={72} height={32} radius={radius.pill} />
          ))}
        </View>
        {/* Banner — the one block tall enough for the shimmer sweep */}
        <View style={styles.gutter}>
          <Skeleton height={BANNER_SKELETON_HEIGHT} radius={radius.card} shimmer />
        </View>
        {/* Shop by category: header + 8 tiles */}
        <View style={styles.sectionHeader}>
          <Skeleton width={140} height={17} />
        </View>
        <View style={styles.tiles}>
          {TILE_KEYS.map((k) => (
            <View key={k} style={styles.tile}>
              <Skeleton width={TILE_IMAGE} height={TILE_IMAGE} radius={radius.xxl} />
              <Skeleton width={48} height={11} style={styles.mt8} />
            </View>
          ))}
        </View>
        {/* First rail */}
        <View style={styles.sectionHeader}>
          <Skeleton width={120} height={17} />
        </View>
        <View style={styles.rail}>
          {RAIL_KEYS.map((k) => (
            <SkeletonProductCard key={k} variant="rail" />
          ))}
        </View>
      </SkeletonScreen>
      {/* After the skeleton in the tree (so it draws and takes touches on top), positioned over the header blocks. */}
      {slow ? (
        <View style={styles.slow} accessibilityLiveRegion="polite">
          <Text style={styles.slowText} maxFontSizeMultiplier={1.3}>
            Still loading… check your connection
          </Text>
          {onRetry ? <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={onRetry} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Height estimates per feed item kind for FlashList's `overrideItemLayout` (the real heights come from layout).
 * `banners` is the carousel's own estimate for the 360 pt reference width.
 */
export const HOME_ITEM_SIZE: {
  search: number;
  searchWithChips: number;
  banners: number;
  catTileRow: number;
  catTileHeader: number;
  freqBought: number;
  aisles: number;
  trust: number;
  promo: number;
  sectionHeader: number;
  productRail: number;
  endStamp: number;
} = {
  search: 64,
  searchWithChips: 112,
  banners: BANNER_CAROUSEL_HEIGHT,
  catTileHeader: 44,
  catTileRow: 96,
  freqBought: 260,
  // Header 44 + a 170 dp tile + 4 below.
  aisles: 218,
  // 8 above + header 44 + the three cards (about 138 at 360 pt).
  trust: 190,
  // 16 above + a 156 dp photo card + 4 below.
  promo: 176,
  sectionHeader: 44,
  productRail: 240,
  // Story card (photo 146 + title + two body lines) + the sign-off (line, logo, tagline) at 360 pt.
  endStamp: 356,
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 12 },
  mark: { marginTop: 2 },
  gutter: { paddingHorizontal: layout.gutter, paddingVertical: 8 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: layout.gutter, paddingVertical: 8 },
  // 44 px like the real headers: 17 px line + 12 above + 15 below.
  sectionHeader: { paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 15 },
  tiles: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: layout.gutter - 4 },
  tile: { width: "25%", alignItems: "center", paddingHorizontal: 4, paddingVertical: 12 },
  // Three 132 px cards + gaps overflow a 328 px gutter: clipped like a real peeking rail (flat, so the clip is safe).
  rail: { flexDirection: "row", gap: layout.gridGap, paddingHorizontal: layout.gutter, overflow: "hidden" },
  // Covers the header blocks (12 + 11 + 8 + 28 + 8 + 12 + 12 = 91) with the page ground; grows over the search
  // band only at large font scales.
  slow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: HEADER_BLOCK_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: layout.gutter,
    paddingVertical: 8,
    backgroundColor: C.bg,
  },
  slowText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub, textAlign: "center" },
  mt8: { marginTop: 8 },
});
