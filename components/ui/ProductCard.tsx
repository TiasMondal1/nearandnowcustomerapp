// ProductCard — the one product card (CONTRACTS §4.9 · design/blinkit-parity §2.4 / BP-11 · MAP K4). Three
// variants share one anatomy: grid (3-up on Home / Category / Order again), rail (132 px horizontal rails) and
// row (search results, wishlist). The Stepper is a SIBLING of the navigating PressableScale, so tapping ADD never
// scales the card; the body press is silent (navigation) and warms the PDP hero on press-in. Quantity never reaches
// this component — the Stepper subscribes per product — so a cart tap re-renders the control, not the card (#1).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, text } from "../../constants/ui";
import { useIsWishlisted } from "../../hooks/useWishlist";
import { getDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { cdnImage, prefetchImages } from "../../lib/imageUrl";
import { logSilentFailure } from "../../lib/logSilentFailure";
import type { Product } from "../../lib/productService";
import { toggleWishlist } from "../../lib/wishlistStore";
import { Badge } from "./Badge";
import { IconButton } from "./IconButton";
import { PressableScale } from "./motion/PressableScale";
import { spr, useMotionReduced } from "./motion/presets";
import { Price, discountPercent } from "./Price";
import { Skeleton } from "./Skeleton";
import { QTY_HIT_SLOP, STEPPER_SIZE, Stepper, type StepperSize } from "./Stepper";
import { notify } from "./Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProductCardVariant = "grid" | "rail" | "row";

export type ProductCardProps = {
  product: Product;
  /** grid = fills its column (104 px at 3-up on 360 pt) · rail = fixed 132 px · row = full width, 88 px min, hairline below. */
  variant: ProductCardVariant;
  /** Body press. Default: `router.push(\`/product/${product.id}\`)`; press-in always prefetches the 800 px hero. */
  onPress?: (product: Product) => void;
  /** Row variant only: a heart (halley) before the Stepper, backed by `useIsWishlisted` + `toggleWishlist`. Default false. */
  showWishlist?: boolean;
  /** Row variant only: extra node after the Stepper (e.g. a remove button). */
  trailing?: React.ReactNode;
  /** Stepper size. Default 'sm' (30×66) for grid/rail, 'md' (32×84) for row. */
  stepperSize?: StepperSize;
  /**
   * Inside a recycled list cell (FlashList): turns off the Stepper's width morph and enter/exit crossfades, which
   * would otherwise play when the cell flips to another product (MAP §7.18 — W3 R1-08). Default false.
   */
  recycled?: boolean;
  /** Outer card / row (width override for grid columns, margins). */
  style?: StyleProp<ViewStyle>;
  /** Root testID; the body press gets `${testID}-body`, the Stepper `${testID}-stepper`, the heart `${testID}-heart`. */
  testID?: string;
};

/** Shared dims (px) so skeletons, rails and grids agree with the card. */
export const PRODUCT_CARD = {
  gridImageAspect: 1,
  railWidth: 132,
  railImageHeight: 116,
  rowThumb: 64,
  rowMinHeight: 88,
  radius: 12,
} as const;

/** Width hint for `cdnImage` per surface (≈ rendered px × 2–3; the PDP prefetch is 800). */
const IMAGE_WIDTH = { card: 240, row: 160, hero: 800 } as const;
/** Deal flags under this discount are noise on a 104 px card (same threshold as Price's badge). */
const DEAL_FLAG_MIN_PCT = 5;
/** Image opacity when the product is out of stock. */
const OUT_OF_STOCK_IMAGE_OPACITY = 0.45;

// ─── Card ─────────────────────────────────────────────────────────────────────

function ProductCardInner({
  product,
  variant,
  onPress,
  showWishlist = false,
  trailing,
  stepperSize,
  recycled = false,
  style,
  testID,
}: ProductCardProps) {
  const handlePress = useCallback(() => {
    if (onPress) onPress(product);
    else router.push(`/product/${product.id}`);
  }, [onPress, product]);

  // Speculative warm-up (speed-and-ease #15): the PDP hero is usually cached by the time the finger lifts.
  const handlePressIn = useCallback(() => {
    prefetchImages([product.image_url], IMAGE_WIDTH.hero);
  }, [product.image_url]);

  const soldOut = product.in_stock === false;
  const pct = discountPercent(product.price, product.original_price);
  const bodyLabel =
    `${product.name}${product.unit ? `, ${product.unit}` : ""}, ${formatMoney(product.price)}` + (soldOut ? ", sold out" : "");

  if (variant === "row") {
    return (
      <View style={[styles.row, style]} testID={testID}>
        <PressableScale
          scale={motion.scale.row}
          onPress={handlePress}
          onPressIn={handlePressIn}
          accessibilityRole="button"
          accessibilityLabel={bodyLabel}
          accessibilityHint="Opens the product"
          style={styles.rowPressable}
          innerStyle={styles.rowInner}
          pressedStyle={styles.rowPressed}
          testID={testID ? `${testID}-body` : undefined}
        >
          <View style={styles.rowThumb}>
            <ProductImage product={product} width={IMAGE_WIDTH.row} style={styles.rowThumbImage} dim={soldOut} />
            {soldOut ? <SoldOutPill compact /> : null}
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {product.name}
            </Text>
            {product.unit ? (
              <Text style={styles.rowUnit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {product.unit}
              </Text>
            ) : null}
            <Price amount={product.price} mrp={product.original_price} size="md" style={styles.rowPrice} />
          </View>
        </PressableScale>
        <View style={styles.rowTrailing} hitSlop={QTY_HIT_SLOP}>
          {showWishlist ? <WishlistHeart product={product} testID={testID ? `${testID}-heart` : undefined} /> : null}
          <Stepper
            product={product}
            size={stepperSize ?? "md"}
            animateLayout={!recycled}
            animateSwap={!recycled}
            testID={testID ? `${testID}-stepper` : undefined}
          />
          {trailing}
        </View>
      </View>
    );
  }

  const rail = variant === "rail";
  return (
    <View style={[styles.card, rail && styles.railCard, style]} testID={testID}>
      <PressableScale
        scale={motion.scale.card}
        onPress={handlePress}
        onPressIn={handlePressIn}
        accessibilityRole="button"
        accessibilityLabel={bodyLabel}
        accessibilityHint="Opens the product"
        testID={testID ? `${testID}-body` : undefined}
      >
        <View style={[styles.imageArea, rail ? styles.railImageArea : styles.gridImageArea]}>
          <ProductImage product={product} width={IMAGE_WIDTH.card} style={styles.image} dim={soldOut} />
          {pct != null && pct >= DEAL_FLAG_MIN_PCT ? (
            <Badge tone="deal" size="sm" label={`${pct}% OFF`} style={styles.dealFlag} />
          ) : null}
          {soldOut ? <SoldOutPill /> : null}
        </View>
        <View style={styles.body}>
          <Text style={styles.unit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {product.unit || " "}
          </Text>
          <Text style={styles.name} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {product.name}
          </Text>
        </View>
      </PressableScale>
      {/* Price + Stepper live OUTSIDE the navigating pressable (K4). The row carries QTY_HIT_SLOP so the Stepper's
          44 pt vertical slop reaches through it on Android (see Stepper.tsx). */}
      <View style={styles.priceRow} hitSlop={QTY_HIT_SLOP}>
        <Price amount={product.price} mrp={product.original_price} size="sm" stack style={styles.priceCol} />
        <Stepper
          product={product}
          size={stepperSize ?? "sm"}
          animateLayout={!recycled}
          animateSwap={!recycled}
          testID={testID ? `${testID}-stepper` : undefined}
        />
      </View>
    </View>
  );
}

/**
 * Memo on product identity + variant + flags + handler identity (plus `trailing`, `style`, `testID` so a changed
 * slot or width still repaints). Quantity is NOT a prop — the Stepper subscribes to it — so cart changes never
 * re-render the card.
 */
export const ProductCard: React.MemoExoticComponent<(props: ProductCardProps) => React.JSX.Element> = React.memo(
  ProductCardInner,
  (a, b) =>
    a.product === b.product &&
    a.variant === b.variant &&
    a.showWishlist === b.showWishlist &&
    a.stepperSize === b.stepperSize &&
    a.recycled === b.recycled &&
    a.onPress === b.onPress &&
    a.trailing === b.trailing &&
    a.style === b.style &&
    a.testID === b.testID,
);

// ─── Parts ────────────────────────────────────────────────────────────────────

/** expo-image recipe (MAP §2.3 #14) or the `image-off-outline` fallback, centred by the parent image area. */
function ProductImage({
  product,
  width,
  style,
  dim,
}: {
  product: Product;
  width: number;
  style: StyleProp<ImageStyle>;
  dim: boolean;
}) {
  const uri = cdnImage(product.image_url, width);
  if (!uri) {
    return (
      <View style={[styles.imageFallback, dim && styles.imageDim]} accessibilityElementsHidden>
        <MaterialCommunityIcons name="image-off-outline" size={24} color={C.textLight} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[style, dim && styles.imageDim]}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={motion.imageFade}
      recyclingKey={product.id}
      priority="low"
      alt={product.name}
      accessibilityIgnoresInvertColors
    />
  );
}

function SoldOutPill({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.soldOutWrap} pointerEvents="none">
      <View style={[styles.soldOutPill, compact && styles.soldOutPillCompact]}>
        <Text style={styles.soldOutText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {compact ? "Sold out" : "Out of stock"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Row heart (codename halley). The press IS a state change, so the handler fires `feedback.toggle(next)`; the glyph
 * pops 1 → 1.3 → 1 (`motion.spring.bouncy` then `.press`) when it fills, unless `Dev_Halley_inhibit_HeartPop` or
 * reduced motion. `toggleWishlist` is optimistic and rolls back on failure; a failure also shows an error toast.
 */
function WishlistHeart({ product, testID }: { product: Product; testID?: string }) {
  const wishlisted = useIsWishlisted(product.id);
  const reduced = useMotionReduced();
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handlePress = () => {
    const next = !wishlisted;
    feedback.toggle(next);
    if (next && !reduced && !getDevFlag("Dev_Halley_inhibit_HeartPop")) {
      scale.set(withSequence(withSpring(1.3, spr(motion.spring.bouncy)), withSpring(1, spr(motion.spring.press))));
    }
    toggleWishlist({
      id: product.id,
      name: product.name,
      image_url: product.image_url,
      price: product.price,
      unit: product.unit,
      isLoose: product.isLoose,
    }).catch((err) => {
      logSilentFailure("Toggle wishlist", err);
      notify({ id: "wishlist-error", title: "Couldn't update your wishlist", tone: "error" });
    });
  };

  return (
    <Animated.View style={popStyle}>
      <IconButton
        icon={wishlisted ? "heart" : "heart-outline"}
        bg="transparent"
        color={C.danger}
        size={32}
        iconSize={22}
        hitSlop={6}
        onPress={handlePress}
        accessibilityLabel={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
        testID={testID}
      />
    </Animated.View>
  );
}

// ─── Skeleton twin ────────────────────────────────────────────────────────────

/**
 * Same box model as the real card per variant (image block, 2 name lines at 90 % / 60 %, price 30 %, ADD 66×30 r8
 * — row: 64 px thumb, lines, 84×32). `Skeleton` only (no shimmer); hidden from assistive tech.
 */
export function SkeletonProductCard({ variant, style }: { variant: ProductCardVariant; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  if (variant === "row") {
    return (
      <View style={[styles.row, styles.rowInner, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Skeleton width={PRODUCT_CARD.rowThumb} height={PRODUCT_CARD.rowThumb} radius={radius.lg} />
        <View style={styles.rowText}>
          <Skeleton width="90%" height={14} />
          <Skeleton width="60%" height={14} style={styles.mt6} />
          <Skeleton width={40} height={12} style={styles.mt6} />
          <Skeleton width={56} height={16} style={styles.mt8} />
        </View>
        <Skeleton width={STEPPER_SIZE.md.minWidth} height={STEPPER_SIZE.md.height} radius={radius.md} />
      </View>
    );
  }
  const rail = variant === "rail";
  return (
    <View
      style={[styles.card, rail && styles.railCard, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.imageArea, rail ? styles.railImageArea : styles.gridImageArea]}>
        <Skeleton width="100%" height="100%" radius={0} />
      </View>
      <View style={styles.body}>
        <Skeleton width="40%" height={11} />
        <Skeleton width="90%" height={12} style={styles.mt4} />
        <Skeleton width="60%" height={12} style={styles.mt4} />
      </View>
      <View style={styles.priceRow}>
        <Skeleton width="30%" height={13} />
        <Skeleton width={STEPPER_SIZE.sm.minWidth} height={STEPPER_SIZE.sm.height} radius={radius.md} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Card chrome: hairline border, no shadow — the card clips its image corners with overflow hidden, and Android drops
  // elevation under overflow hidden (MAP §7.4), so it must carry none.
  card: {
    backgroundColor: C.card,
    borderRadius: PRODUCT_CARD.radius,
    borderWidth: 1,
    borderColor: C.hairline,
    overflow: "hidden",
  },
  railCard: { width: PRODUCT_CARD.railWidth },
  imageArea: { width: "100%", backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center" },
  gridImageArea: { aspectRatio: PRODUCT_CARD.gridImageAspect },
  railImageArea: { height: PRODUCT_CARD.railImageHeight },
  image: { position: "absolute", top: 8, right: 8, bottom: 8, left: 8 },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  imageDim: { opacity: OUT_OF_STOCK_IMAGE_OPACITY },
  dealFlag: {
    position: "absolute",
    top: 0,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopLeftRadius: PRODUCT_CARD.radius,
    borderBottomRightRadius: radius.md,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
  },
  soldOutWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  soldOutPill: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soldOutPillCompact: { paddingHorizontal: 5, paddingVertical: 2 },
  soldOutText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: C.textSub },
  body: { paddingHorizontal: 8, paddingTop: 8, gap: 2 },
  unit: { ...text.cardUnit },
  name: { ...text.cardName, minHeight: 32 },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  priceCol: { flexShrink: 1 },
  // Row variant: no card chrome, hairline divider OUTSIDE the scaled view.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: PRODUCT_CARD.rowMinHeight,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
    // No ground of its own: the row inherits the screen's (white on Wishlist, cream on Search — W3 R3-12).
  },
  rowPressable: { flex: 1, minWidth: 0 },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.lg },
  rowPressed: { backgroundColor: C.bgSoft },
  rowThumb: {
    width: PRODUCT_CARD.rowThumb,
    height: PRODUCT_CARD.rowThumb,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowThumbImage: { position: "absolute", top: 4, right: 4, bottom: 4, left: 4 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 18, color: C.text },
  rowUnit: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16, color: C.textSub },
  rowPrice: { marginTop: 2 },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: 8 },
  mt4: { marginTop: 4 },
  mt6: { marginTop: 6 },
  mt8: { marginTop: 8 },
});
