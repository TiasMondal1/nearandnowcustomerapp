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
import { BrandPhoto, hasPhoto } from "../brand";
import { PressableScale, layoutTiming, useLayoutTransitionsEnabled, useMotionReduced } from "../ui";

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
/** Photo panel width as a share of the card: 44 % (144 dp at a 328 dp card), 38 % on a narrow card or at large text. */
const PANEL_RATIO = 0.44;
const PANEL_RATIO_NARROW = 0.38;
/** Cards under this width use the narrow panel. */
const PANEL_NARROW_BELOW = 300;
/** Above this system font scale the narrow panel is used at every width, which gives the copy column more room. */
const PANEL_MAX_FONT_SCALE = 1.1;
/** Gap between the copy column and the photo panel. */
const PANEL_GAP = 12;
/** Floor for the two-line title's shrink-to-fit beside the panel. */
const TITLE_MIN_FONT_SCALE = 0.88;
const CTA_PILL_HEIGHT = 26;
/** Floor for the subtitle's shrink-to-fit beside the panel. */
const SUBTITLE_MIN_FONT_SCALE = 0.8;
/** The same cap the copy's `maxFontSizeMultiplier` applies. */
const COPY_MAX_FONT_SCALE = 1.3;
/** Two title lines (2 x 22) and two subtitle lines (2 x 16), in dp at font scale 1. */
const COPY_TEXT_HEIGHT = 76;
/** The copy column's gaps (4 + 4), the pill's top margin (4) and the pill (26). */
const COPY_FIXED_HEIGHT = 8 + 4 + CTA_PILL_HEIGHT;
/** Room the tallest copy column must leave inside the card (4 dp above and below). */
const COPY_MIN_CLEARANCE = 8;
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
 * Horizontal paged FlatList of banner cards (`width − 32`, aspect 2.25, r16, 1 px hairline) with 6 px dots that morph
 * into a 16 × 6 primary pill via `layoutTiming()` (no overshoot). Returns `null` when `banners` is empty.
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
  /** index 0 — image banners and banner photos load at `priority="high"`. */
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
      {banner.kind === "card" ? <CardFace banner={banner} width={width} first={first} /> : <ImageFace banner={banner} first={first} />}
    </PressableScale>
  );
});

/**
 * Typographic card: tint background, title h3 (2 lines), subtitle 12/500 and a CTA pill on the left; the banner's
 * bundled photo fills a panel at the right edge whose left corners repeat the logo's doorway, mirrored. With no
 * photo (or an unfilled slot) the 28 px glyph on a 48 px circle stays.
 */
function CardFace({ banner, width, first }: { banner: CardBanner; width: number; first: boolean }) {
  const { fontScale } = useWindowDimensions();
  const photo = banner.photo != null && hasPhoto(banner.photo) ? banner.photo : null;
  // The copy column is what the panel leaves: the wide panel only when the card is wide AND text is near default size.
  const narrow = fontScale > PANEL_MAX_FONT_SCALE || width < PANEL_NARROW_BELOW;
  const panelWidth = Math.round(width * (narrow ? PANEL_RATIO_NARROW : PANEL_RATIO));
  const cardHeight = Math.round(width / BANNER_ASPECT_RATIO);
  // Beside the photo the column is narrow, so the subtitle may wrap to a second line whenever the tallest copy
  // (two title lines, two subtitle lines, the pill) still fits the card; otherwise it stays on one line and shrinks.
  const copyHeight = COPY_TEXT_HEIGHT * Math.min(fontScale, COPY_MAX_FONT_SCALE) + COPY_FIXED_HEIGHT;
  const subtitleLines = photo && copyHeight <= cardHeight - COPY_MIN_CLEARANCE ? 2 : 1;
  return (
    <View style={[styles.face, tintStyles[banner.tint], photo ? { paddingRight: panelWidth + PANEL_GAP } : null]}>
      <View style={styles.copy}>
        <Text
          style={styles.title}
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
          adjustsFontSizeToFit
          minimumFontScale={TITLE_MIN_FONT_SCALE}
        >
          {banner.title}
        </Text>
        {banner.subtitle ? (
          <Text
            style={styles.subtitle}
            numberOfLines={subtitleLines}
            maxFontSizeMultiplier={COPY_MAX_FONT_SCALE}
            // Beside the photo it wraps to a second line when the card has the height; past that it shrinks a
            // little instead of ending in "…".
            adjustsFontSizeToFit
            minimumFontScale={SUBTITLE_MIN_FONT_SCALE}
          >
            {banner.subtitle}
          </Text>
        ) : null}
        {banner.cta ? (
          <View style={styles.ctaPill}>
            <Text style={styles.cta} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {banner.cta}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={CTA_CHEVRON} color={C.primaryDark} />
          </View>
        ) : null}
      </View>
      {photo ? (
        // The card clips the panel's right corners; the panel clips the photo to the mirrored doorway on its left.
        <View style={[styles.panel, { width: panelWidth, borderTopLeftRadius: Math.round(cardHeight / 2) }]}>
          <BrandPhoto slot={photo} shape="fill" priority={first ? "high" : "low"} />
        </View>
      ) : (
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={banner.icon} size={ICON_SIZE} color={C.primary} />
        </View>
      )}
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

/** Decorative page indicator: 6 px `C.border` dots, the active one a 16 × 6 `C.primary` pill (timed layout transition, no entering/exiting). */
function Dots({ count, active, layoutOn }: { count: number; active: number; layoutOn: boolean }) {
  return (
    <View style={styles.dots} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} layout={layoutOn ? layoutTiming() : undefined} style={[styles.dot, i === active && styles.dotActive]} />
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
    borderRadius: radius.card,
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
    paddingVertical: 8,
    gap: 12,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...text.h3 },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub },
  // A pill, not a second button: the whole card is the one pressable.
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    height: CTA_PILL_HEIGHT,
    marginTop: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.hairline,
  },
  // primaryDark: a 12 px label needs more contrast than saffron gives.
  cta: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.primaryDark, flexShrink: 1 },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderBottomLeftRadius: radius.xl,
    backgroundColor: C.bgSoft,
    overflow: "hidden",
  },
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
