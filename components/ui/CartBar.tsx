// codename: cyan
// CartBar — the floating "N items · ₹total · View cart" bar on every browse surface (CONTRACTS §4.10 ·
// design/blinkit-parity §2.7 · motion M4 · speed-and-ease #17). Mounted ONCE in AppShell as a sibling of <Stack>;
// it decides its own visibility from the cart snapshot and `usePathname()`, and publishes its layout to a tiny
// module store so ToastHost / DevPill / screen padding compose above it. Press → swoosh + /support/checkout (D5:
// checkout IS the cart). No haptic anywhere here: the add already ticked, and "View cart" is navigation.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, shadow, TAB_BAR_BASE_HEIGHT } from "../../constants/ui";
import { useCart, type CartItem } from "../../context/CartContext";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { getDevFlag, useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { cdnImage } from "../../lib/imageUrl";
import { AnimatedNumber } from "./motion/AnimatedNumber";
import { PressableScale } from "./motion/PressableScale";
import { enter, exit, layoutSpring, spr, useLayoutTransitionsEnabled, useMotionReduced } from "./motion/presets";

// ─── Constants ────────────────────────────────────────────────────────────────

export type CartBarProps = { testID?: string };

/** Bar height in px. */
export const CART_BAR_HEIGHT = 56;
/** Gap between the bar and the tab bar / safe-area edge in px. */
export const CART_BAR_GAP = 12;
/** HEIGHT + GAP — screens add this to bottom padding when totalQty > 0 (or read `useCartBarFootprint()`). */
export const CART_BAR_FOOTPRINT = 68;

/** Pathname prefixes the bar shows on (`usePathname()` strips route groups, so tabs read `/home`, not `/(tabs)/home`). */
export const CART_BAR_ROUTES = ["/home", "/order-again", "/categories", "/category/", "/support/search", "/wishlist"] as const;
export const TAB_PATHNAMES = ["/home", "/order-again", "/categories"] as const;

/** Thumbnails shown at the left; the newest line comes first. */
const MAX_THUMBS = 3;
/** Below this window width the ETA chip is dropped so "View cart" never wraps. */
const ETA_CHIP_MIN_WIDTH = 340;
/** A count increase bounces only when a user mutation happened this recently (never on hydration). */
const BOUNCE_WINDOW_MS = 400;

/** True for a tab screen pathname in either spelling (`/home` or `/(tabs)/home`). */
export function isTabPathname(pathname: string): boolean {
  const path = stripTabsGroup(pathname);
  return TAB_PATHNAMES.some((p) => path === p);
}

function stripTabsGroup(pathname: string): string {
  return pathname.startsWith("/(tabs)") ? pathname.slice("/(tabs)".length) || "/" : pathname;
}

function matchesCartBarRoute(pathname: string): boolean {
  const path = stripTabsGroup(pathname);
  return CART_BAR_ROUTES.some((route) => path === route || path.startsWith(route));
}

// ─── Layout store (sync, module-level; ToastHost and DevPill read it) ────────

export type CartBarLayout = { visible: boolean; bottom: number; height: number };

const HIDDEN_LAYOUT: CartBarLayout = Object.freeze({ visible: false, bottom: 0, height: 0 });

let layoutSnapshot: CartBarLayout = HIDDEN_LAYOUT;
let extraBottom = 0;
const layoutListeners = new Set<() => void>();

function emitLayout(): void {
  for (const cb of Array.from(layoutListeners)) cb();
}

function publishLayout(next: CartBarLayout): void {
  const normalised = next.visible ? next : HIDDEN_LAYOUT;
  if (
    normalised.visible === layoutSnapshot.visible &&
    normalised.bottom === layoutSnapshot.bottom &&
    normalised.height === layoutSnapshot.height
  ) {
    return;
  }
  layoutSnapshot = normalised;
  emitLayout();
}

/** Sync read: `{ visible, bottom, height }` of the mounted bar; `{ false, 0, 0 }` while hidden. */
export function getCartBarLayout(): CartBarLayout {
  return layoutSnapshot;
}

/** Fires on every layout publish and on `setCartBarExtraBottom`. */
export function subscribeCartBarLayout(cb: () => void): () => void {
  layoutListeners.add(cb);
  return () => {
    layoutListeners.delete(cb);
  };
}

/** `useSyncExternalStore` over the layout store (reference-stable while unchanged). */
export function useCartBarLayout(): CartBarLayout {
  return useSyncExternalStore(subscribeCartBarLayout, getCartBarLayout, getCartBarLayout);
}

function getCartBarExtraBottom(): number {
  return extraBottom;
}

/** The current extra lift (Home's active-orders banner footprint) regardless of the bar's visibility — ToastHost reads it so toasts clear the banner when the cart is empty (W3 R3-03). */
export function useCartBarExtraBottom(): number {
  return useSyncExternalStore(subscribeCartBarLayout, getCartBarExtraBottom, getCartBarExtraBottom);
}

/**
 * Extra lift in px added to the bar's `bottom` (and therefore to everything stacked above it). Home sets
 * ACTIVE_ORDER_BANNER_FOOTPRINT (64) while its active-orders banner shows and resets to 0 on blur/unmount.
 * Non-finite or negative values read as 0.
 */
export function setCartBarExtraBottom(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? px : 0;
  if (next === extraBottom) return;
  extraBottom = next;
  emitLayout();
}

/** `visible ? CART_BAR_FOOTPRINT : 0` — add to scroll `paddingBottom` on every surface the bar can show on. */
export function useCartBarFootprint(): number {
  return useCartBarLayout().visible ? CART_BAR_FOOTPRINT : 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Visible iff `cart.isHydrated && cart.totalQty > 0 && !Dev_Cyan_inhibit_Feature && pathname matches CART_BAR_ROUTES`.
 * bottom = (tab screen ? TAB_BAR_BASE_HEIGHT + insets.bottom : insets.bottom) + 12 + extraBottom. 56 px, r14,
 * C.primary, `shadow.cardLg`; left: up to 3 overlapping 32 px thumbs (newest first; hidden under
 * `Dev_Cyan_inhibit_Thumbnails`); middle: "<N roll> items · <₹subtotal count 220 ms>" 13/700 C.onPrimary; ETA chip
 * "⚡ 12 min" (hidden under `Dev_Cyan_inhibit_EtaChip`, when minutes are null, or under 340 pt width); right:
 * "View cart" 14/700 + chevron. `enter.rise()` / `exit.fall()`; bounces 1 → 1.06 → 1 when `totalQty` increases
 * within 400 ms of a user mutation (never on cold start; never under `Dev_Cyan_inhibit_Bounce` or reduced motion).
 * Publishes `{ visible, bottom, height: 56 }` to the layout store in an effect and `visible: false` on unmount.
 * zIndex/elevation 50 (ToastHost uses 60).
 */
export function CartBar({ testID }: CartBarProps = {}): React.JSX.Element | null {
  const cart = useCart();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const eta = useDeliveryEta();
  const { width } = useWindowDimensions();
  const inhibitFeature = useDevFlag("Dev_Cyan_inhibit_Feature");
  const inhibitThumbs = useDevFlag("Dev_Cyan_inhibit_Thumbnails");
  const inhibitEtaChip = useDevFlag("Dev_Cyan_inhibit_EtaChip");
  const lift = useCartBarExtraBottom();
  const reduced = useMotionReduced();
  const layoutOn = useLayoutTransitionsEnabled();

  const { items, subtotal, totalQty, isHydrated, lastUserMutationAt } = cart;
  const visible = isHydrated && totalQty > 0 && !inhibitFeature && matchesCartBarRoute(pathname);
  const bottom = (isTabPathname(pathname) ? TAB_BAR_BASE_HEIGHT + insets.bottom : insets.bottom) + CART_BAR_GAP + lift;

  // Layout store: publish after commit, never during render; hide on unmount.
  useEffect(() => {
    publishLayout({ visible, bottom, height: CART_BAR_HEIGHT });
  }, [visible, bottom]);
  useEffect(() => () => publishLayout(HIDDEN_LAYOUT), []);

  // Bounce on a count INCREASE caused by a fresh user tap, only while the bar was already showing (the first add
  // plays enter.rise instead). Refs are read/written in the effect only (React Compiler, MAP §7.2).
  const barScale = useSharedValue(1);
  const barScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: barScale.get() }] }));
  const prevQtyRef = useRef(totalQty);
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const prevQty = prevQtyRef.current;
    const wasVisible = prevVisibleRef.current;
    prevQtyRef.current = totalQty;
    prevVisibleRef.current = visible;
    if (!visible || !wasVisible || totalQty <= prevQty) return;
    if (Date.now() - lastUserMutationAt >= BOUNCE_WINDOW_MS) return;
    if (reduced || getDevFlag("Dev_Cyan_inhibit_Bounce")) return;
    barScale.set(withSequence(withSpring(1.06, spr(motion.spring.pop)), withSpring(1, spr(motion.spring.press))));
  }, [totalQty, visible, lastUserMutationAt, reduced, barScale]);

  if (!visible) return null;

  const thumbs: CartItem[] = inhibitThumbs ? [] : items.slice(-MAX_THUMBS).reverse();
  const showEta = !inhibitEtaChip && eta.state === "open" && eta.minutes != null && width >= ETA_CHIP_MIN_WIDTH;
  const itemsWord = totalQty === 1 ? "item" : "items";
  const label = `View cart, ${totalQty} ${itemsWord}, ${formatMoney(subtotal)}`;

  const handlePress = () => {
    feedback.swoosh();
    router.push("/support/checkout");
  };

  return (
    <Animated.View
      entering={reduced ? undefined : enter.rise()}
      exiting={reduced ? undefined : exit.fall()}
      style={[styles.wrap, { bottom }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <Animated.View style={barScaleStyle}>
        <PressableScale
          scale={motion.scale.cta}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Opens your cart"
          innerStyle={styles.bar}
          pressedStyle={styles.barPressed}
          testID={testID ? `${testID}-press` : undefined}
        >
          {thumbs.length > 0 ? (
            <View style={styles.thumbs} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {thumbs.map((item, i) => (
                <Animated.View
                  key={item.product_id}
                  layout={layoutOn ? layoutSpring() : undefined}
                  style={[styles.thumb, i > 0 && styles.thumbOverlap, { zIndex: MAX_THUMBS - i }]}
                >
                  <Thumb item={item} />
                </Animated.View>
              ))}
            </View>
          ) : null}

          <View style={styles.middle}>
            <View style={styles.countRow} accessibilityLiveRegion="polite">
              <AnimatedNumber mode="roll" value={totalQty} style={styles.countText} accessibilityLabel={`${totalQty}`} />
              <Text style={styles.countText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {` ${itemsWord} · `}
              </Text>
              <AnimatedNumber
                mode="count"
                value={subtotal}
                format={formatMoney}
                duration={motion.duration.base}
                style={styles.countText}
                accessibilityLabel={formatMoney(subtotal)}
              />
            </View>
          </View>

          {showEta ? (
            <View style={styles.etaChip}>
              <MaterialCommunityIcons name="flash" size={12} color={C.onPrimary} />
              <Text style={styles.etaText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {`${eta.minutes} min`}
              </Text>
            </View>
          ) : null}

          <View style={styles.right}>
            <Text style={styles.viewCart} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              View cart
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={C.onPrimary} />
          </View>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

function Thumb({ item }: { item: CartItem }) {
  const uri = cdnImage(item.image_url, 96);
  if (!uri) return <MaterialCommunityIcons name="basket-outline" size={16} color={C.primary} />;
  return (
    <Image
      source={{ uri }}
      style={styles.thumbImage}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={motion.imageFade}
      recyclingKey={item.product_id}
      priority="low"
      alt={item.name}
      accessibilityIgnoresInvertColors
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Absolute wrapper: no background (so Android draws no spurious shadow), z-ordered above the tab bar + sheets'
  // siblings but below ToastHost (60).
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 50, elevation: 50 },
  bar: {
    height: CART_BAR_HEIGHT,
    borderRadius: radius.xxl,
    backgroundColor: C.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 14,
    gap: 10,
    ...shadow.cardLg,
  },
  barPressed: { backgroundColor: C.primaryDark },
  thumbs: { flexDirection: "row", alignItems: "center" },
  thumb: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.primary,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOverlap: { marginLeft: -10 },
  thumbImage: { width: 24, height: 24 },
  middle: { flex: 1, minWidth: 0, justifyContent: "center" },
  countRow: { flexDirection: "row", alignItems: "center" },
  countText: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, color: C.onPrimary },
  etaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: C.primaryDark,
  },
  etaText: { fontFamily: fontFamily.semibold, fontSize: 11, lineHeight: 14, color: C.onDarkSub },
  right: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewCart: { fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 18, color: C.onPrimary },
});
