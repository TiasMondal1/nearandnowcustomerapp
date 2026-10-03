// codename: orion
// Product page (DECISIONS D3 orion · CONTRACTS §10 · design/blinkit-parity §3.6 / BP-16 · speed-and-ease #15).
// Paints from the memory catalog on the first frame (the card that opened this page already held the Product) and
// lets getProductById only refresh; shows the whole packshot (`contain` on sand) under a r24 details sheet; header =
// share + wishlist heart (halley); dock = Stepper lg that morphs into Stepper + "View cart · ₹…" (the CartBar is
// hidden on /product/*, so that strip is the only View cart here). Navigation is silent — the heart (toggle) and the
// strip (swoosh) are the only feedback this file owns; ADD / ± play inside CartContext.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";

import StarRating from "../../components/StarRating";
import {
  Badge,
  BottomDock,
  ChevronRotate,
  Collapsible,
  EmptyState,
  EtaLine,
  IconButton,
  PRODUCT_CARD,
  PressableScale,
  Price,
  PrimaryButton,
  ProductCard,
  STEPPER_SIZE,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  Stepper,
  discountPercent,
  enter,
  exit,
  notify,
  spr,
  useDockHeight,
  useMotionReduced,
  type IconName,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { HIT_SLOP, fontFamily, header, motion, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useCart, useCartQty } from "../../context/CartContext";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { useIsOnline } from "../../hooks/useIsOnline";
import { useForceSkeleton, useSlowLoad } from "../../hooks/useSlowLoad";
import { useIsWishlisted } from "../../hooks/useWishlist";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { cdnImage } from "../../lib/imageUrl";
import { logSilentFailure } from "../../lib/logSilentFailure";
import {
  getCachedProduct,
  getMemoryHomeCache,
  getProductById,
  getProductsForCategoryName,
  type Product,
} from "../../lib/productService";
import { toggleWishlist } from "../../lib/wishlistStore";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Hero width hint. MUST stay equal to ProductCard's press-in prefetch width (IMAGE_WIDTH.hero = 800) — the cache is
 * keyed by the resolved URL, so a different hint would throw the warm image away (speed-and-ease #15).
 */
const HERO_IMAGE_WIDTH = 800;
/** The hero is 1:1 up to this height (design §3.6). */
const HERO_MAX_HEIGHT = 320;
/** Same threshold as Price / ProductCard: smaller gaps show the strike + "Save ₹X" only. */
const DEAL_BADGE_MIN_PCT = 5;
/** "About this product" shows this many lines; the remainder lives in a Collapsible. */
const ABOUT_PREVIEW_LINES = 4;
/** Similar-products rail cap (design §3.6). */
const SIMILAR_MAX = 10;
const RAIL_GAP = 8;
const RAIL_ITEM_LENGTH = PRODUCT_CARD.railWidth + RAIL_GAP;
const EMPTY_PRODUCTS: Product[] = [];
const WHITESPACE = /\s/;

type FetchState = "loading" | "ready" | "notFound" | "error";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Siblings of `product` from the warm catalog (no network), minus itself, capped at SIMILAR_MAX. */
function similarProducts(product: Product | null): Product[] {
  if (!product) return EMPTY_PRODUCTS;
  const cache = getMemoryHomeCache();
  if (!cache) return EMPTY_PRODUCTS;
  const siblings = getProductsForCategoryName(product.category, cache.productsByCategory);
  const out: Product[] = [];
  for (const p of siblings) {
    if (p.id === product.id) continue;
    out.push(p);
    if (out.length === SIMILAR_MAX) break;
  }
  return out;
}

function countInk(s: string): number {
  let n = 0;
  for (const ch of s) if (!WHITESPACE.test(ch)) n++;
  return n;
}

/**
 * Splits `source` where line `lineCount` of its measured layout ends, so the preview is exactly the lines the clamp
 * showed and the Collapsible holds the rest. Measured line texts keep or drop trailing whitespace depending on the
 * platform, so the walk matches non-whitespace characters only (code points, so emoji never split).
 */
function splitAtLine(source: string, lines: readonly string[], lineCount: number): { preview: string; rest: string } {
  const needed = countInk(lines.slice(0, lineCount).join(""));
  let seen = 0;
  let cut = 0;
  for (const ch of source) {
    if (seen >= needed) break;
    if (!WHITESPACE.test(ch)) seen++;
    cut += ch.length;
  }
  return { preview: source.slice(0, cut).trimEnd(), rest: source.slice(cut).trimStart() };
}

// ─── Rail helpers (module-level: no per-render closures) ──────────────────────

const railKeyExtractor = (item: Product) => item.id;
const renderRailItem = ({ item }: ListRenderItemInfo<Product>) => <ProductCard product={item} variant="rail" />;
const railItemLayout = (_data: ArrayLike<Product> | null | undefined, index: number) => ({
  length: RAIL_ITEM_LENGTH,
  offset: RAIL_ITEM_LENGTH * index,
  index,
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = typeof id === "string" ? id : "";

  const orionOff = useDevFlag("Dev_Orion_inhibit_Feature");
  const instantPaintOff = useDevFlag("Dev_Orion_inhibit_InstantPaint");
  const railOff = useDevFlag("Dev_Orion_inhibit_SimilarRail");
  const halleyOff = useDevFlag("Dev_Halley_inhibit_Feature");

  // Instant paint (speed #15 / D17): seed from the memory catalog — the list that opened this page already held the
  // Product — and let the network only refresh. The skeleton is reserved for ids the catalog has never seen.
  const [product, setProduct] = useState<Product | null>(() =>
    orionOff || instantPaintOff ? null : (getCachedProduct(productId) ?? null),
  );
  const [similar, setSimilar] = useState<Product[]>(() => similarProducts(product));
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const hasSeedRef = useRef(product !== null);

  const { isAuthenticated } = useAuth();
  const { subtotal } = useCart();
  const qty = useCartQty(productId);
  const dockHeight = useDockHeight();
  const eta = useDeliveryEta();
  const online = useIsOnline();
  const reduced = useMotionReduced();
  const loading = useForceSkeleton(!product && !!productId && fetchState === "loading");
  const slow = useSlowLoad(loading);

  useEffect(() => {
    if (!productId) return undefined;
    // `cancelled` discards a slower-resolving response from a previously viewed product — without it, opening A then
    // quickly B could let A's response land after B's and show A's data under B's route (the old requestIdRef guard).
    let cancelled = false;
    getProductById(productId)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          hasSeedRef.current = true;
          setProduct(data);
          setSimilar(similarProducts(data));
          setFetchState("ready");
          return;
        }
        // null = not carried by any active store (uncached fetch failures are logged by the service and surface as
        // null too). With a seed the catalog copy (≤ 24 h old) stays on screen instead of a dead end.
        if (hasSeedRef.current) {
          logSilentFailure("Refresh product", new Error(`Product ${productId} is no longer active; keeping the catalog copy`));
          setFetchState("ready");
        } else {
          setFetchState("notFound");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logSilentFailure("Fetch product", err);
        setFetchState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [productId, retryNonce]);

  const handleRetry = () => {
    setFetchState("loading");
    setRetryNonce((n) => n + 1);
  };
  // dismissTo pops to the live tabs route instead of mounting a second tab navigator (W3 R6-04).
  const handleGoHome = () => router.dismissTo("/(tabs)/home");
  const handleViewCart = () => {
    feedback.swoosh();
    router.push("/support/checkout");
  };
  const handleShare = () => {
    if (!product) return;
    Share.share({ message: `${product.name} on Near & Now — nearandnow://product/${productId}` }).catch((err: unknown) =>
      logSilentFailure("Share product", err),
    );
  };

  // ── No product yet: skeleton → not found → couldn't load ──
  if (!product) {
    // getProductById resolves null for an uncached id whose fetch failed as well as for a dead id; offline is the one
    // signal that tells them apart, so an offline "not found" gets the Retry state instead of a dead end.
    const failed = fetchState === "error" || (fetchState === "notFound" && !online);
    const notFound = !productId || (fetchState === "notFound" && online);
    return (
      <Screen bg={C.card} edges={["top"]}>
        <ScreenHeader title="" align="left" backFallbackHref="/(tabs)/home" />
        {failed ? (
          <EmptyState
            fill
            iconWrap
            icon="cloud-off-outline"
            title="Couldn't load this product"
            text="Check your connection and try again."
            action={{ label: "Retry", onPress: handleRetry }}
          />
        ) : notFound ? (
          <EmptyState
            fill
            iconWrap
            icon="package-variant-closed-remove"
            title="Product not found"
            text="It may have been removed or isn't available near you."
            action={{ label: "Go to Home", onPress: handleGoHome }}
          />
        ) : (
          <ProductSkeleton slow={slow} onRetry={handleRetry} />
        )}
      </Screen>
    );
  }

  // ── Content ──
  const mrp = product.original_price;
  const saving = mrp != null && mrp > product.price ? mrp - product.price : 0;
  const pct = discountPercent(product.price, mrp);
  const heroUri = cdnImage(product.image_url, HERO_IMAGE_WIDTH);
  const inCart = qty > 0;
  const showRail = !orionOff && !railOff && similar.length >= 2;
  const hasRating = typeof product.avgRating === "number" && product.avgRating > 0;

  return (
    <Screen bg={C.card} edges={["top"]}>
      {/* Empty title: Blinkit shows no title over the hero. No back override — BackButton's deep-link fallback applies. */}
      <ScreenHeader
        title=""
        align="left"
        backFallbackHref="/(tabs)/home"
        right={
          <View style={styles.headerRight}>
            {!orionOff ? (
              <IconButton
                icon="share-variant-outline"
                bg="transparent"
                accessibilityLabel="Share this product"
                onPress={handleShare}
              />
            ) : null}
            {!halleyOff ? <WishlistHeart product={product} isAuthenticated={isAuthenticated} reduced={reduced} /> : null}
          </View>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        // flexGrow lets the white sheet reach the dock when the description is short; the dock clearance is dynamic.
        contentContainerStyle={[styles.scrollContent, { paddingBottom: dockHeight + 16 }]}
      >
        <View style={styles.hero}>
          {heroUri ? (
            <Image
              source={{ uri: heroUri }}
              style={styles.heroImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={motion.imageFade}
              priority="high"
              recyclingKey={product.id}
              accessible
              accessibilityLabel={product.name}
              alt={product.name}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={styles.heroFallback} accessible accessibilityLabel={`${product.name}, no image`}>
              <MaterialCommunityIcons name="image-off-outline" size={48} color={C.textLight} />
            </View>
          )}
          {pct != null && pct >= DEAL_BADGE_MIN_PCT ? (
            <Badge tone="deal" size="md" label={`${pct}% OFF`} style={styles.dealBadge} />
          ) : null}
        </View>

        <View style={styles.sheet}>
          <Text style={styles.name} accessibilityRole="header">
            {product.name}
          </Text>
          {product.unit ? (
            <Text style={styles.unit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {product.unit}
            </Text>
          ) : null}

          {hasRating ? (
            <View style={styles.ratingRow}>
              <StarRating rating={product.avgRating ?? 0} reviewCount={product.reviewCount} starSize={14} />
            </View>
          ) : null}

          <View style={styles.priceRow}>
            <Price size="lg" amount={product.price} mrp={mrp} unit={product.unit} />
            {saving > 0 ? (
              <Badge tone="dealSoft" label={`Save ₹${formatMoney(saving, { symbol: false })}`} />
            ) : null}
          </View>

          {eta.state !== "none" ? (
            <View style={styles.etaRow}>
              <EtaLine size="md" eta={eta} />
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <MetaPill icon="tag-outline" iconColor={C.primary} label={product.category} />
            <MetaPill
              icon={product.in_stock ? "check-circle-outline" : "close-circle-outline"}
              iconColor={product.in_stock ? C.success : C.danger}
              label={product.in_stock ? "In stock" : "Out of stock"}
              danger={!product.in_stock}
            />
          </View>

          {product.description ? <AboutSection key={product.description} description={product.description} /> : null}

          {showRail ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                Similar products
              </Text>
              <FlatList
                horizontal
                data={similar}
                keyExtractor={railKeyExtractor}
                renderItem={renderRailItem}
                getItemLayout={railItemLayout}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
                removeClippedSubviews
                showsHorizontalScrollIndicator={false}
                style={styles.rail}
                contentContainerStyle={styles.railContent}
                accessibilityLabel="Similar products"
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Dock: full-width "Add to cart" (or the Stepper's own "Sold out" face) → Stepper + View-cart strip. The Stepper
          morphs its own width; the strip fades in beside it. */}
      <BottomDock>
        <View style={styles.dockRow}>
          <Stepper product={product} size="lg" variant="filled" addLabel="Add to cart" fullWidth={!inCart} />
          {inCart ? (
            <Animated.View
              style={styles.dockCta}
              entering={reduced ? undefined : enter.fade()}
              exiting={reduced ? undefined : exit.fade()}
            >
              <ViewCartStrip subtotal={subtotal} legacy={orionOff} onPress={handleViewCart} />
            </Animated.View>
          ) : null}
        </View>
      </BottomDock>
    </Screen>
  );
}

// ─── Wishlist heart (codename halley) ─────────────────────────────────────────

/**
 * Header heart on `useIsWishlisted` + optimistic `toggleWishlist`. The press IS a state change, so it fires
 * `feedback.toggle(next)` itself (no toast — the heart is visible); the glyph pops 1 → 1.3 → 1 when it fills and dips
 * 1 → 0.85 → 1 when it empties (motion M17) unless `Dev_Halley_inhibit_HeartPop` or reduced motion. Built on
 * PressableScale with IconButton's geometry because the heart needs `accessibilityState.selected`.
 */
function WishlistHeart({ product, isAuthenticated, reduced }: { product: Product; isAuthenticated: boolean; reduced: boolean }) {
  const wishlisted = useIsWishlisted(product.id);
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handlePress = () => {
    if (!isAuthenticated) {
      // Guest gate kept as a confirmation Alert (DECISIONS D6: no auth-guard refactor); "Log in" navigates.
      Alert.alert("Sign in required", "Please log in to save items to your wishlist.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log in", onPress: () => router.push("/phone") },
      ]);
      return;
    }
    const next = !wishlisted;
    feedback.toggle(next);
    if (!reduced && !getDevFlag("Dev_Halley_inhibit_HeartPop")) {
      scale.set(
        next
          ? withSequence(withSpring(1.3, spr(motion.spring.bouncy)), withSpring(1, spr(motion.spring.press)))
          : withSequence(withSpring(0.85, spr(motion.spring.press)), withSpring(1, spr(motion.spring.press))),
      );
    }
    toggleWishlist({
      id: product.id,
      name: product.name,
      image_url: product.image_url,
      price: product.price,
      unit: product.unit,
      isLoose: product.isLoose,
    })
      .then((resolved) => {
        // toggleWishlist never rejects: a resolved state that differs from the intent means the request failed and
        // the store already rolled the heart back — say so once (the toast owns its error haptic).
        if (resolved !== next) notify({ id: "wishlist-error", title: "Couldn't update your wishlist", tone: "error" });
      })
      .catch((err: unknown) => logSilentFailure("Toggle wishlist", err));
  };

  return (
    <Animated.View style={popStyle}>
      <PressableScale
        scale={motion.scale.icon}
        onPress={handlePress}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
        accessibilityState={{ selected: wishlisted }}
        innerStyle={styles.heartButton}
        pressedStyle={styles.heartPressed}
        testID="pdp-heart"
      >
        <MaterialCommunityIcons name={wishlisted ? "heart" : "heart-outline"} size={header.backIconSize} color={C.danger} />
      </PressableScale>
    </Animated.View>
  );
}

// ─── View-cart strip ──────────────────────────────────────────────────────────

/**
 * "View cart · ₹284 ›" beside the lg Stepper: PrimaryButton's primary face (C.primary, r12, pressed C.primaryDark,
 * scale cta) at exactly the Stepper's 48 px with tighter padding, so the label still fits next to a 132 px Stepper on
 * 360-pt phones (the primitive's 16/800 + ph20 + chevron would ellipsize the amount there). Under the orion master flag
 * the strip is a plain "View cart" text link.
 */
function ViewCartStrip({ subtotal, legacy, onPress }: { subtotal: number; legacy: boolean; onPress: () => void }) {
  const amount = formatMoney(subtotal);
  if (legacy) {
    return (
      <PressableScale
        scale={motion.scale.cta}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="View cart"
        innerStyle={styles.viewCartLink}
        pressedStyle={styles.viewCartLinkPressed}
        testID="pdp-view-cart"
      >
        <Text style={styles.viewCartLinkText} maxFontSizeMultiplier={1.3}>
          View cart
        </Text>
      </PressableScale>
    );
  }
  return (
    <PressableScale
      scale={motion.scale.cta}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`View cart, ${amount}`}
      innerStyle={styles.viewCart}
      pressedStyle={styles.viewCartPressed}
      testID="pdp-view-cart"
    >
      <Text
        style={styles.viewCartText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        maxFontSizeMultiplier={1.3}
      >
        {`View cart · ${amount}`}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={C.onPrimary} />
    </PressableScale>
  );
}

// ─── About this product ───────────────────────────────────────────────────────

/**
 * Description block. The full text is measured once by a hidden twin (`onTextLayout`); when it runs past
 * ABOUT_PREVIEW_LINES the header becomes a toggle with a ChevronRotate, the first lines stay in flow and the remainder
 * opens in a Collapsible — heights match on both sides of the toggle, so nothing jumps. Web has no onTextLayout, so it
 * shows the whole text. Keyed by the description so a refreshed product re-measures.
 */
function AboutSection({ description }: { description: string }) {
  const [lines, setLines] = useState<readonly string[] | null>(() => (Platform.OS === "web" ? [] : null));
  const [expanded, setExpanded] = useState(false);

  const onMeasure = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    setLines(e.nativeEvent.lines.map((line) => line.text));
  };

  const long = lines != null && lines.length > ABOUT_PREVIEW_LINES;
  const { preview, rest } = long
    ? splitAtLine(description, lines, ABOUT_PREVIEW_LINES)
    : { preview: description, rest: "" };
  // Clamp while unmeasured too, so a long description never paints in full and then snaps to four lines.
  const clamp = !expanded && (lines == null || long);

  return (
    <View style={styles.section}>
      {long ? (
        <PressableScale
          scale={motion.scale.row}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="About this product"
          accessibilityHint={expanded ? "Shows less" : "Shows the full description"}
          accessibilityState={{ expanded }}
          innerStyle={styles.aboutHeader}
          testID="pdp-about-toggle"
        >
          <Text style={styles.sectionTitle}>About this product</Text>
          <ChevronRotate open={expanded} />
        </PressableScale>
      ) : (
        <View style={styles.aboutHeader}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            About this product
          </Text>
        </View>
      )}
      <View style={styles.aboutBodyWrap}>
        {lines == null ? (
          <Text
            style={[styles.aboutBody, styles.aboutMeasure]}
            onTextLayout={onMeasure}
            maxFontSizeMultiplier={1.3}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {description}
          </Text>
        ) : null}
        <Text style={styles.aboutBody} numberOfLines={clamp ? ABOUT_PREVIEW_LINES : undefined} maxFontSizeMultiplier={1.3}>
          {long && expanded ? preview : description}
        </Text>
        {long ? (
          <Collapsible open={expanded}>
            <Text style={styles.aboutBody} maxFontSizeMultiplier={1.3}>
              {rest}
            </Text>
          </Collapsible>
        ) : null}
      </View>
    </View>
  );
}

// ─── Small parts ──────────────────────────────────────────────────────────────

/** Static meta pill in the idle Chip geometry (sm): read-only, so it announces as text rather than a dead button. */
function MetaPill({ icon, iconColor, label, danger = false }: { icon: IconName; iconColor: string; label: string; danger?: boolean }) {
  return (
    <View style={[styles.metaPill, danger && styles.metaPillDanger]} accessible accessibilityRole="text" accessibilityLabel={label}>
      <MaterialCommunityIcons name={icon} size={14} color={iconColor} />
      <Text style={[styles.metaText, danger && styles.metaTextDanger]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

/** Skeleton mirroring the real layout (hero → name → unit → meta → price) so nothing jumps when data lands. */
function ProductSkeleton({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  return (
    <View style={styles.flex}>
      <SkeletonScreen style={styles.flex}>
        <View style={styles.hero}>
          <Skeleton width="100%" height="100%" radius={0} shimmer />
        </View>
        <View style={styles.sheet}>
          <Skeleton width="72%" height={22} />
          <Skeleton width="42%" height={14} style={styles.mt8} />
          <Skeleton width="56%" height={14} style={styles.mt8} />
          <Skeleton width={128} height={28} style={styles.mt12} />
        </View>
      </SkeletonScreen>
      {/* Outside SkeletonScreen: it is one accessible progressbar that hides its descendants, and Retry must stay reachable. */}
      {slow ? (
        <View style={styles.slowHint}>
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
  flex: { flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  heartButton: {
    width: header.iconButton,
    height: header.iconButton,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  heartPressed: { backgroundColor: C.border },

  scrollContent: { flexGrow: 1 },
  // 1:1 on sand, capped at 320 (design §3.6). The packshot keeps 12 px of air and clears the sheet's −20 overlap.
  hero: {
    width: "100%",
    aspectRatio: 1,
    maxHeight: HERO_MAX_HEIGHT,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: { position: "absolute", top: 12, left: 12, right: 12, bottom: 32 },
  heroFallback: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  dealBadge: { position: "absolute", top: 16, left: 16 },

  sheet: {
    flex: 1,
    backgroundColor: C.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -20,
    padding: 20,
  },
  name: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 26, color: C.text },
  unit: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.textSub, marginTop: 2 },
  ratingRow: { marginTop: 8 },
  priceRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12 },
  etaRow: { marginTop: 10 },

  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    maxWidth: "100%",
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  metaPillDanger: { borderColor: C.dangerLight, backgroundColor: C.dangerLight },
  metaText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16, color: C.text, flexShrink: 1 },
  metaTextDanger: { color: C.danger },

  section: { marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border },
  sectionTitle: { ...text.h3 },
  // 44 pt toggle target; the negative margins keep the 20 / 8 rhythm of a plain header around the 22 px title.
  aboutHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginTop: -11,
    marginBottom: -3,
  },
  aboutBodyWrap: { marginTop: 8 },
  aboutBody: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 22, color: C.textSub },
  aboutMeasure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },

  // The rail bleeds to the screen edges past the sheet's 20 px padding.
  rail: { marginHorizontal: -20, marginTop: 12 },
  railContent: { paddingHorizontal: 20, gap: RAIL_GAP },

  dockRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dockCta: { flex: 1, minWidth: 0 },
  viewCart: {
    height: STEPPER_SIZE.lg.height,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: radius.xl,
    backgroundColor: C.primary,
  },
  viewCartPressed: { backgroundColor: C.primaryDark },
  viewCartText: { ...text.button, flexShrink: 1 },
  viewCartLink: {
    height: STEPPER_SIZE.lg.height,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.xl,
  },
  viewCartLinkPressed: { backgroundColor: C.primaryXLight },
  viewCartLinkText: { fontFamily: fontFamily.bold, fontSize: 15, color: C.primary },

  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  slowHint: { alignItems: "center", gap: 6, padding: 16 },
  slowText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub },
});
