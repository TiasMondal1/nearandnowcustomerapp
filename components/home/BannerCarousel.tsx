// codename: deneb
// BannerCarousel — Home's promo carousel (CONTRACTS §4.18 · design/blinkit-parity §2.2 / BP-08 · motion doc §6 C13:
// no scroll-linked motion). Typographic `card` banners today (DECISIONS D11 Q9: the repo has no banner art) and
// `image` banners once the owner supplies some. Auto-advance is the one time-driven motion here and it runs ONLY
// while the carousel is actually being looked at: tab focused, app active, no touch in the last 2 s, motion not
// reduced, `Dev_Deneb_inhibit_AutoAdvance` off, and more than one banner. A banner press is navigation and therefore
// silent (CONTRACTS §8). The card clips its corners, so it carries no shadow (MAP §7.4).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { BANNER_ASPECT_RATIO, bannerLabel, type Banner, type CardBanner, type ImageBanner } from "../../constants/banners";
import { C } from "../../constants/colors";
import { fontFamily, layout, motion, radius, text } from "../../constants/ui";
import { useDevFlag } from "../../lib/devFlags";
import { cdnImage } from "../../lib/imageUrl";
import { PressableScale, layoutSpring, useLayoutTransitionsEnabled, useMotionReduced } from "../ui";

export type BannerCarouselProps = {
  /** Already filtered + sorted (`getActiveBanners()`, merged with `getRemoteBanners()`). Nothing renders when empty. */
  banners: Banner[];
  /** `tab focused && app active` from the screen. Auto-advance never runs while false. */
  focused: boolean;
  /** Outer wrapper (margins). */
  style?: StyleProp<ViewStyle>;
  /** Root testID; each card gets `${testID}-${banner.id}`. */
  testID?: string;
};

// ─── Geometry ─────────────────────────────────────────────────────────────────

/** Gap between cards; also the peek of the next card past the right gutter. */
const GAP = 8;
/** Width of the design reference device, used only for the layout ESTIMATE below. */
const REFERENCE_WIDTH = 360;
const DOT = 6;
const DOT_ACTIVE_WIDTH = 16;
const DOTS_GAP = 6;
const DOTS_TOP = 8;
const DOTS_BOTTOM = 8;
const ICON_SIZE = 28;
const ICON_CIRCLE = 48;
const CTA_CHEVRON = 14;
/** Rendered-width hint for `cdnImage` on image banners (hero-class, like the PDP image). */
const IMAGE_WIDTH_HINT = 800;

// ─── Timing ───────────────────────────────────────────────────────────────────

const AUTO_ADVANCE_MS = 4000;
/** Auto-advance stays off for this long after the last finger-up. */
const TOUCH_COOLDOWN_MS = 2000;

/**
 * Card + dots row for a 360 pt reference width: round((360 − 32) / 2.25) + 8 + 6 + 8 = 168. W2-home-screen uses it only
 * as the `overrideItemLayout` estimate; the real height comes from layout.
 */
export const BANNER_CAROUSEL_HEIGHT: number =
  Math.round((REFERENCE_WIDTH - 2 * layout.gutter) / BANNER_ASPECT_RATIO) + DOTS_TOP + DOT + DOTS_BOTTOM;

const keyExtractor = (banner: Banner): string => banner.id;

// ─── Carousel ─────────────────────────────────────────────────────────────────

/**
 * Horizontal paged FlatList of banner cards (`width − 32`, aspect 2.25, r14, 1 px hairline) with 6 px dots that morph
 * into a 16 × 6 primary pill via `layoutSpring()`. Returns `null` when `banners` is empty.
 */
export function BannerCarousel({ banners, focused, style, testID }: BannerCarouselProps): React.JSX.Element | null {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - 2 * layout.gutter;
  const interval = cardWidth + GAP;
  const count = banners.length;

  const reduced = useMotionReduced();
  const inhibitAutoAdvance = useDevFlag("Dev_Deneb_inhibit_AutoAdvance");
  const layoutOn = useLayoutTransitionsEnabled();

  const listRef = useRef<FlatList<Banner>>(null);
  const indexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  // App state is watched only while the tab is focused (no listener on a blurred tab — same hygiene as SearchBand).
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    if (!focused) return;
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, [focused]);

  // "Touched recently" = finger down, or less than TOUCH_COOLDOWN_MS since the last finger-up. A new touch cancels the
  // pending cooldown through the effect cleanup, so the timer never needs a ref.
  const [touching, setTouching] = useState(false);
  const [touchedRecently, setTouchedRecently] = useState(false);
  useEffect(() => {
    if (touching || !touchedRecently) return;
    const id = setTimeout(() => setTouchedRecently(false), TOUCH_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [touching, touchedRecently]);

  const handleTouchStart = () => {
    setTouching(true);
    setTouchedRecently(true);
  };
  const handleTouchEnd = () => setTouching(false);

  // If the list shrinks under the current page, snap back to the first card.
  useEffect(() => {
    if (indexRef.current <= count - 1) return;
    indexRef.current = 0;
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [count]);

  // Auto-advance: the interval exists only while every condition holds, and is torn down on any change / unmount.
  const autoAdvance = focused && appActive && !touchedRecently && !reduced && !inhibitAutoAdvance && count > 1;
  useEffect(() => {
    if (!autoAdvance) return;
    const id = setInterval(() => {
      const next = (indexRef.current + 1) % count;
      indexRef.current = next;
      setActiveIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: !reduced });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [autoAdvance, count, reduced]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.min(count - 1, Math.max(0, Math.round(x / interval)));
    if (next !== indexRef.current) {
      indexRef.current = next;
      setActiveIndex(next);
    }
  };

  const handleScrollToIndexFailed = (info: { index: number }) => {
    listRef.current?.scrollToOffset({ offset: info.index * interval, animated: false });
  };

  const getItemLayout = useCallback(
    (_data: ArrayLike<Banner> | null | undefined, index: number) => ({ length: cardWidth, offset: interval * index, index }),
    [cardWidth, interval],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Banner>) => (
      <BannerCard banner={item} width={cardWidth} first={index === 0} testID={testID ? `${testID}-${item.id}` : undefined} />
    ),
    [cardWidth, testID],
  );

  if (count === 0) return null;

  return (
    <View style={[styles.root, style]} testID={testID}>
      <FlatList
        ref={listRef}
        data={banners}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        horizontal
        pagingEnabled
        snapToInterval={interval}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        initialNumToRender={2}
        windowSize={3}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        testID={testID ? `${testID}-list` : undefined}
      />
      {count > 1 ? <Dots count={count} active={activeIndex} layoutOn={layoutOn} /> : null}
    </View>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────────

/** One banner: silent `PressableScale` (navigation) → `router.push(banner.href)`; the href is already a typed `Href`. */
const BannerCard = React.memo(function BannerCard({
  banner,
  width,
  first,
  testID,
}: {
  banner: Banner;
  width: number;
  /** index 0 — image banners load at `priority="high"`. */
  first: boolean;
  testID?: string;
}) {
  const handlePress = useCallback(() => {
    router.push(banner.href);
  }, [banner.href]);

  return (
    <PressableScale
      scale={motion.scale.card}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={bannerLabel(banner)}
      style={{ width }}
      innerStyle={styles.card}
      testID={testID}
    >
      {banner.kind === "card" ? <CardFace banner={banner} /> : <ImageFace banner={banner} first={first} />}
    </PressableScale>
  );
});

/** Typographic card: tint background, title h3 (2 lines), subtitle 12/500, cta 12/700 + chevron; 28 px glyph on a 48 px circle. */
function CardFace({ banner }: { banner: CardBanner }) {
  return (
    <View style={[styles.face, tintStyles[banner.tint]]}>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {banner.title}
        </Text>
        {banner.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {banner.subtitle}
          </Text>
        ) : null}
        {banner.cta ? (
          <View style={styles.ctaRow}>
            <Text style={styles.cta} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {banner.cta}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={CTA_CHEVRON} color={C.primary} />
          </View>
        ) : null}
      </View>
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons name={banner.icon} size={ICON_SIZE} color={C.primary} />
      </View>
    </View>
  );
}

/** Owner art: expo-image cover, `cdnImage(url, 800)`, high priority for the first card, low otherwise. */
function ImageFace({ banner, first }: { banner: ImageBanner; first: boolean }) {
  const uri = typeof banner.image === "string" ? cdnImage(banner.image, IMAGE_WIDTH_HINT) : undefined;
  const source = typeof banner.image === "number" ? banner.image : uri ? { uri } : null;
  if (!source) return <View style={styles.imageFallback} />;
  return (
    <Image
      source={source}
      style={styles.image}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={motion.imageFade}
      priority={first ? "high" : "low"}
      recyclingKey={banner.id}
      alt={banner.alt}
      accessibilityIgnoresInvertColors
    />
  );
}

// ─── Dots ─────────────────────────────────────────────────────────────────────

/** Decorative page indicator: 6 px `C.border` dots, the active one a 16 × 6 `C.primary` pill (layout spring, no entering/exiting). */
function Dots({ count, active, layoutOn }: { count: number; active: number; layoutOn: boolean }) {
  return (
    <View style={styles.dots} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} layout={layoutOn ? layoutSpring() : undefined} style={[styles.dot, i === active && styles.dotActive]} />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const tintStyles = StyleSheet.create({
  primaryXLight: { backgroundColor: C.primaryXLight },
  dealLight: { backgroundColor: C.dealLight },
  warningLight: { backgroundColor: C.warningLight },
});

const styles = StyleSheet.create({
  root: { paddingBottom: DOTS_BOTTOM },
  content: { paddingHorizontal: layout.gutter, gap: GAP },
  // Clips the face/image corners; therefore NO shadow (Android drops elevation under overflow hidden — MAP §7.4).
  card: {
    aspectRatio: BANNER_ASPECT_RATIO,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.card,
    overflow: "hidden",
  },
  face: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...text.h3 },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  cta: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.primary },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { ...StyleSheet.absoluteFillObject },
  imageFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bgSoft },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: DOTS_GAP, marginTop: DOTS_TOP, height: DOT },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: C.border },
  dotActive: { width: DOT_ACTIVE_WIDTH, backgroundColor: C.primary },
});
