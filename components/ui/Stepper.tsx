// codename: rigel
// The ONE quantity control (DECISIONS D3 rigel · CONTRACTS §4.7 · design/blinkit-parity §2.6 · motion M2/M3).
// ADD → [− n +] on every surface: grid/rail cards (sm), rows + checkout lines (md), the PDP dock (lg) and the
// confirmation quick-add rail (xs). The quantity comes from the per-product cart subscription, so a tap re-renders
// this control only — never the card or the list (speed-and-ease #1/#18). Haptics + sounds are fired INSIDE the
// CartContext mutations; the buttons here are silent. The only feedback this file owns is the "Max 99" error.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useCallback, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, opacity, radius } from "../../constants/ui";
import { cartActions, useCartQty } from "../../context/CartContext";
import { getDevFlag, subscribeDevFlags } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import type { Product } from "../../lib/productService";
import { formatQuantityDisplay } from "../../lib/quantityFormat";
import { AnimatedNumber } from "./motion/AnimatedNumber";
import { usePressScale } from "./motion/PressableScale";
import { enter, exit, layoutSpring, useLayoutTransitionsEnabled, useMotionReduced } from "./motion/presets";
import type { IconName } from "./types";
import { notify } from "./Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

/** xs 26×60 · sm 30×66 · md 32×84 · lg 48×full (minWidth 132 when not fullWidth) */
export type StepperSize = "xs" | "sm" | "md" | "lg";

/**
 * ADD face only. `outlined` = C.card + 1 px C.primary + "ADD" 12/700 C.primary (default; Blinkit's ADD is outlined on
 * white). `filled` = C.primary + C.onPrimary label (lg default — the PDP dock CTA). `tinted` = C.primaryXLight + 1 px
 * C.primary (legacy surfaces only). The stepper state is ALWAYS a C.primary fill with C.onPrimary glyphs/digits.
 */
export type StepperVariant = "outlined" | "filled" | "tinted";

export type StepperProduct = Pick<Product, "id" | "name" | "price" | "unit" | "image_url" | "isLoose" | "in_stock">;

export type StepperProps = {
  /** The product this control adds/steps. `isLoose` MUST be present (loose items step 0.25 kg — MAP §2.11 #38). */
  product: StepperProduct;
  /** Geometry preset. Default 'sm' (30×66). */
  size?: StepperSize;
  /** ADD face. Default 'outlined'; lg defaults to 'filled'. */
  variant?: StepperVariant;
  /** ADD label. Default 'ADD' (uppercase, letterSpacing 0.6); lg defaults to 'Add to cart'. */
  addLabel?: string;
  /** Stretch to the container width (PDP dock). Default false → alignSelf flex-start at `minWidth`. */
  fullWidth?: boolean;
  /** Static `opacity.disabled` (0.45); presses ignored; `accessibilityState.disabled`. Default false. */
  disabled?: boolean;
  /** Called after a successful FIRST add (qty 0 → step), never on increments (PDP/analytics). */
  onAdded?: () => void;
  /**
   * Animate the ADD ↔ stepper width change with `layoutSpring()`. Default true. Pass false inside recycled list cells
   * whose recycling flips products (a width morph on recycle reads as a glitch); the morph is also off under reduced
   * motion, `Dev_Onyx_inhibit_LayoutTransitions`, `Dev_Rigel_inhibit_Morph` and `Dev_Rigel_inhibit_Feature`.
   */
  animateLayout?: boolean;
  /**
   * Enter/exit crossfades: the controls fade in on ADD, the ADD face fades out, the −/trash glyph crossfades and the
   * count rolls. Default true. Pass false inside recycled list cells (ProductCard does via `recycled`): on recycle
   * the same instance flips to another product and every one of those would play for a change the user never made
   * (MAP §7.18 / PLAN §5 rule 9 — W3 R1-08 / R4-04). The controls never fade in on MOUNT either way (a persisted
   * cart would otherwise fade every stepper on cold start): the fade is latched to an in-place ADD.
   */
  animateSwap?: boolean;
  /** Outer frame (margins, alignSelf). */
  style?: StyleProp<ViewStyle>;
  /** Root testID; the parts get `${testID}-add`, `-minus`, `-plus`, `-count`. */
  testID?: string;
};

// ─── Geometry ─────────────────────────────────────────────────────────────────

/** height × minWidth × label/digit font × glyph size per size (CONTRACTS §4.7). */
export const STEPPER_SIZE: Record<StepperSize, { height: number; minWidth: number; font: number; icon: number }> = {
  xs: { height: 26, minWidth: 60, font: 12, icon: 14 },
  sm: { height: 30, minWidth: 66, font: 12, icon: 14 },
  md: { height: 32, minWidth: 84, font: 13, icon: 16 },
  lg: { height: 48, minWidth: 132, font: 15, icon: 20 },
};

/**
 * Slop on every ± target AND on the stepper's own frame/controls views. It makes the ± targets ≥ 44 pt TALL for
 * sm/md/lg (30+14, 32+14, 48+14); the ± zones are ≥ 30 pt WIDE (22+8 sm, 26+8 md, 44+8 lg — Blinkit parity, not 44);
 * xs is 40 pt tall and is used ONLY in the confirmation quick-add rail. The slop is asymmetric because a 4 px side slop
 * keeps − and + from overlapping each other's zone across the count. ANDROID: RN does not deliver touches that fall
 * outside an ancestor's bounds, so the frame and the controls row carry the same slop and consumers that sit a Stepper
 * in a row shorter than 44 pt should put `hitSlop={QTY_HIT_SLOP}` on that row too (ProductCard does).
 * W3-R3 verifies the real targets with the a11y inspector, not this comment.
 */
export const QTY_HIT_SLOP: { top: number; bottom: number; left: number; right: number } = { top: 7, bottom: 7, left: 4, right: 4 };

/** Width of each ± zone per size; the count takes the rest of the frame. */
const QTY_BUTTON_WIDTH: Record<StepperSize, number> = { xs: 20, sm: 22, md: 26, lg: 44 };
/** Loose items read "0.25 kg": the frame widens so the label never wraps (design §2.6: 92 at sm). */
const LOOSE_MIN_WIDTH: Record<StepperSize, number> = { xs: 84, sm: 92, md: 104, lg: 148 };
/** Float tolerance for the at-min test on 0.25 steps (0.75 − 0.25 − 0.25 ≠ 0.25 exactly). */
const MIN_EPSILON = 1e-9;

// ─── Dev flags (one subscription per Stepper instead of four) ─────────────────

type RigelFlags = { legacy: boolean; noMorph: boolean; noRoll: boolean; noTrash: boolean };

function readRigelFlags(): RigelFlags {
  return {
    legacy: getDevFlag("Dev_Rigel_inhibit_Feature"),
    noMorph: getDevFlag("Dev_Rigel_inhibit_Morph"),
    noRoll: getDevFlag("Dev_Rigel_inhibit_DigitRoll"),
    noTrash: getDevFlag("Dev_Rigel_inhibit_TrashAtMin"),
  };
}

let rigelFlags: RigelFlags = readRigelFlags();

/** Stable snapshot for useSyncExternalStore: a new object only when one of the four flags changed. */
function getRigelFlags(): RigelFlags {
  const next = readRigelFlags();
  if (
    next.legacy !== rigelFlags.legacy ||
    next.noMorph !== rigelFlags.noMorph ||
    next.noRoll !== rigelFlags.noRoll ||
    next.noTrash !== rigelFlags.noTrash
  ) {
    rigelFlags = next;
  }
  return rigelFlags;
}

function useRigelFlags(): RigelFlags {
  return useSyncExternalStore(subscribeDevFlags, getRigelFlags, getRigelFlags);
}

// ─── Cart handlers (module-level: no per-card closures) ───────────────────────

/** Max 99 per line: the store fires nothing for 'max' (CONTRACTS §3.1), so the control owns the error + toast. */
function onMaxReached(): void {
  feedback.error();
  notify({ id: "cart-max", title: "Max 99 per item", tone: "warning" });
}

function addToCart(product: StepperProduct, onAdded?: () => void): void {
  const result = cartActions.addItem({
    product_id: product.id,
    name: product.name,
    price: product.price,
    unit: product.unit,
    image_url: product.image_url,
    isLoose: product.isLoose,
  });
  if (result === "max") onMaxReached();
  else if (result === "added") onAdded?.();
}

/** `incrementQty` reads the step from the stored line, so N fast taps always net N (CartContext comment). */
function stepCart(product: StepperProduct, direction: 1 | -1): void {
  const result = cartActions.incrementQty(product.id, direction);
  if (result === "max") onMaxReached();
  // The line vanished under the finger (undo / clear raced the tap): a "+" still means "I want one".
  else if (result === "missing" && direction === 1) addToCart(product);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ADD → [− n +]. Quantity via `useCartQty(product.id)`; ADD → `cartActions.addItem` (with `isLoose`); ± →
 * `cartActions.incrementQty(id, ±1)`; 'max' → `feedback.error()` + toast "Max 99 per item". `in_stock === false` →
 * a "Sold out" pill (C.bgSoft / C.textSub 11/700), not pressable. At the minimum quantity the − glyph crossfades to
 * `trash-can-outline` and the tap removes the line (label "Remove <name> from cart"). Integer counts roll
 * (`AnimatedNumber mode="roll"`); loose quantities crossfade through `formatQuantityDisplay(qty, isLoose, unit)`.
 * Width morphs with `layoutSpring()`. Under `Dev_Rigel_inhibit_Feature` or reduced motion: instant swap, plain minus,
 * no roll. Buttons fire NO haptic themselves — CartContext does (one gesture → one haptic).
 */
export function Stepper({
  product,
  size = "sm",
  variant,
  addLabel,
  fullWidth = false,
  disabled = false,
  onAdded,
  animateLayout = true,
  animateSwap = true,
  style,
  testID,
}: StepperProps): React.JSX.Element {
  const qty = useCartQty(product.id);
  const flags = useRigelFlags();
  const reduced = useMotionReduced();
  const layoutEnabled = useLayoutTransitionsEnabled();

  const geometry = STEPPER_SIZE[size];
  const isLg = size === "lg";
  const face: StepperVariant = variant ?? (isLg ? "filled" : "outlined");
  const label = addLabel ?? (isLg ? "Add to cart" : "ADD");
  const soldOut = product.in_stock === false;
  const inCart = qty > 0;
  const step = product.isLoose ? 0.25 : 1;
  const atMin = inCart && qty <= step + MIN_EPSILON;
  const looseDisplay = product.isLoose === true || !Number.isInteger(qty);
  const display = looseDisplay ? formatQuantityDisplay(qty, product.isLoose, product.unit) : String(qty);

  const animate = !flags.legacy && !reduced;
  const morph = animate && animateLayout && layoutEnabled && !flags.noMorph;
  const swap = animate && animateSwap;
  const roll = swap && !flags.noRoll;
  const showTrash = atMin && !flags.legacy && !flags.noTrash;

  // Latch (React reset-on-prop-change): `flipped` turns true the first time `inCart` moves away from the value seen
  // at mount for THIS product, and resets when a recycled cell receives another product. The controls' entering
  // fade reads it, so it plays for an in-place ADD and never for a mount or a recycle.
  const [latch, setLatch] = useState({ id: product.id, initialInCart: inCart, flipped: false });
  if (latch.id !== product.id) {
    setLatch({ id: product.id, initialInCart: inCart, flipped: false });
  } else if (!latch.flipped && inCart !== latch.initialInCart) {
    setLatch({ ...latch, flipped: true });
  }
  const controlsEnter = swap && latch.id === product.id && (latch.flipped || inCart !== latch.initialInCart);

  const handleAdd = useCallback(() => addToCart(product, onAdded), [product, onAdded]);
  const handleMinus = useCallback(() => stepCart(product, -1), [product]);
  const handlePlus = useCallback(() => stepCart(product, 1), [product]);

  const minWidth = fullWidth ? undefined : inCart && looseDisplay ? LOOSE_MIN_WIDTH[size] : geometry.minWidth;
  const frameStyle = [
    styles.frame,
    { height: geometry.height, minWidth },
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    style,
  ];
  const countStyle = [styles.countText, { fontSize: geometry.font, lineHeight: geometry.font + 4 }];

  if (soldOut) {
    return (
      <View
        style={[frameStyle, styles.soldOut]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${product.name}, sold out`}
        testID={testID}
      >
        <Text style={styles.soldOutText} maxFontSizeMultiplier={1.3}>
          Sold out
        </Text>
      </View>
    );
  }

  return (
    <Animated.View layout={morph ? layoutSpring() : undefined} style={frameStyle} hitSlop={QTY_HIT_SLOP} testID={testID}>
      {inCart ? (
        <Animated.View
          key="controls"
          entering={controlsEnter ? enter.fade() : undefined}
          style={styles.controls}
          hitSlop={QTY_HIT_SLOP}
        >
          <QtyButton
            icon={showTrash ? "trash-can-outline" : "minus"}
            iconSize={geometry.icon}
            width={QTY_BUTTON_WIDTH[size]}
            onPress={handleMinus}
            disabled={disabled}
            danger={showTrash}
            animate={swap}
            accessibilityLabel={showTrash ? `Remove ${product.name} from cart` : `Decrease quantity of ${product.name}`}
            testID={testID ? `${testID}-minus` : undefined}
          />
          <View
            style={styles.countWrap}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Quantity ${display}`}
            testID={testID ? `${testID}-count` : undefined}
          >
            {looseDisplay ? (
              swap ? (
                <Animated.Text
                  key={display}
                  entering={enter.fade()}
                  exiting={exit.fade()}
                  style={countStyle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {display}
                </Animated.Text>
              ) : (
                <Text style={countStyle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {display}
                </Text>
              )
            ) : roll ? (
              <AnimatedNumber key={product.id} mode="roll" value={qty} style={countStyle} accessibilityLabel={`Quantity ${display}`} />
            ) : (
              <Text style={countStyle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {display}
              </Text>
            )}
          </View>
          <QtyButton
            icon="plus"
            iconSize={geometry.icon}
            width={QTY_BUTTON_WIDTH[size]}
            onPress={handlePlus}
            disabled={disabled}
            danger={false}
            animate={swap}
            accessibilityLabel={`Increase quantity of ${product.name}`}
            testID={testID ? `${testID}-plus` : undefined}
          />
        </Animated.View>
      ) : (
        <Animated.View key="add" exiting={swap ? exit.fade() : undefined} style={styles.addWrap} hitSlop={QTY_HIT_SLOP}>
          <AddButton
            label={label}
            face={face}
            fontSize={geometry.font}
            large={isLg}
            onPress={handleAdd}
            disabled={disabled}
            accessibilityLabel={`Add ${product.name}`}
            testID={testID ? `${testID}-add` : undefined}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ─── Parts ────────────────────────────────────────────────────────────────────
// Both buttons own their Pressable through `usePressScale` (not `PressableScale`) so the OUTER scaled view can carry
// `hitSlop` as well — on Android a touch must fall inside every ancestor's (slop-expanded) bounds to reach a child.

type AddButtonProps = {
  label: string;
  face: StepperVariant;
  fontSize: number;
  large: boolean;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
  testID?: string;
};

const FACE_STYLE: Record<StepperVariant, ViewStyle> = {
  outlined: { backgroundColor: C.card, borderWidth: 1, borderColor: C.primary },
  filled: { backgroundColor: C.primary },
  tinted: { backgroundColor: C.primaryXLight, borderWidth: 1, borderColor: C.primary },
};
const FACE_PRESSED_STYLE: Record<StepperVariant, ViewStyle> = {
  outlined: { backgroundColor: C.primaryXLight },
  filled: { backgroundColor: C.primaryDark },
  tinted: { backgroundColor: C.primaryLight },
};
const FACE_LABEL_COLOR: Record<StepperVariant, string> = {
  outlined: C.primary,
  filled: C.onPrimary,
  tinted: C.primary,
};

function AddButton({ label, face, fontSize, large, onPress, disabled, accessibilityLabel, testID }: AddButtonProps) {
  const press = usePressScale({ scale: large ? motion.scale.cta : motion.scale.tile });
  return (
    <Animated.View style={[styles.addOuter, press.animatedStyle]} hitSlop={QTY_HIT_SLOP}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled}
        hitSlop={QTY_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.addFace, FACE_STYLE[face], pressed && FACE_PRESSED_STYLE[face]]}
        testID={testID}
      >
        <Text
          style={[
            large ? styles.addLabelLg : styles.addLabel,
            { fontSize, lineHeight: fontSize + 4, color: FACE_LABEL_COLOR[face] },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

type QtyButtonProps = {
  icon: IconName;
  iconSize: number;
  width: number;
  onPress: () => void;
  disabled: boolean;
  /** Trash state: the pressed face tints C.danger instead of C.primaryDark (design §2.6). */
  danger: boolean;
  /** Crossfade the glyph when it changes (minus ↔ trash). */
  animate: boolean;
  accessibilityLabel: string;
  testID?: string;
};

function QtyButton({ icon, iconSize, width, onPress, disabled, danger, animate, accessibilityLabel, testID }: QtyButtonProps) {
  // The glyph present at mount never fades in (cold start, list mount); only a minus ↔ trash change crossfades.
  const [initialIcon] = useState(icon);
  const press = usePressScale({ scale: motion.scale.icon });
  const glyph = <MaterialCommunityIcons name={icon} size={iconSize} color={C.onPrimary} />;
  return (
    <Animated.View style={[styles.qtyBtnOuter, { width }, press.animatedStyle]} hitSlop={QTY_HIT_SLOP}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled}
        hitSlop={QTY_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.qtyBtn, pressed && (danger ? styles.qtyBtnPressedDanger : styles.qtyBtnPressed)]}
        testID={testID}
      >
        {animate ? (
          <Animated.View key={icon} entering={icon !== initialIcon ? enter.fade() : undefined} exiting={exit.fade()}>
            {glyph}
          </Animated.View>
        ) : (
          glyph
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // No shadow anywhere on the control, so `overflow: hidden` is safe (MAP §7.4).
  frame: { alignSelf: "flex-start", borderRadius: radius.md, overflow: "hidden" },
  fullWidth: { alignSelf: "stretch", width: "100%" },
  disabled: { opacity: opacity.disabled },
  // ADD face
  addWrap: { flex: 1, alignSelf: "stretch" },
  addOuter: { flex: 1, alignSelf: "stretch" },
  addFace: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.md },
  addLabel: { fontFamily: fontFamily.bold, letterSpacing: 0.6 },
  addLabelLg: { fontFamily: fontFamily.extrabold, letterSpacing: 0.2 },
  // Stepper state
  controls: {
    flex: 1,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: C.primary,
    borderRadius: radius.md,
  },
  qtyBtnOuter: { alignSelf: "stretch" },
  qtyBtn: { flex: 1, alignItems: "center", justifyContent: "center" },
  qtyBtnPressed: { backgroundColor: C.primaryDark },
  qtyBtnPressedDanger: { backgroundColor: C.danger },
  countWrap: { flex: 1, minWidth: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  countText: { fontFamily: fontFamily.bold, color: C.onPrimary, textAlign: "center" },
  // Sold out
  soldOut: { backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  soldOutText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: C.textSub },
});
