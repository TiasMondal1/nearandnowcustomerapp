// codename: juno
// OffersRow — the checkout coupons row (CONTRACTS §4.18; speed-and-ease #23; blinkit-parity §3.7 / BP-19; motion
// M18; MAP §4.3 U15). Nothing applied → "Apply coupon · N available" (→ /product/coupons) plus, when the active
// list holds a coupon the bill already qualifies for, an inline one-tap "Apply CODE". Applied → "CODE applied /
// You save ₹N" with a one-tap remove. Loads `getActiveCoupons()` itself (5-min queryCache; `peekActiveCoupons()`
// paints first); a failed load silently drops the inline suggestion. Discount maths are display-only
// (lib/couponMath mirror) — the backend re-derives what is charged.
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, layout, space, text } from "../../constants/ui";
import { cartActions, type Coupon } from "../../context/CartContext";
import { couponValidityState } from "../../lib/couponMath";
import {
  findBestCoupon,
  getActiveCoupons,
  peekActiveCoupons,
  toCartCoupon,
  type ActiveCoupon,
} from "../../lib/couponService";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { AnimatedNumber, enter, IconButton, IconWrap, layoutTiming, ListRow, notify, PrimaryButton } from "../ui";

export type OffersRowProps = {
  /** Cart subtotal in rupees (eligibility + best-coupon maths). */
  subtotal: number;
  /** `useCart().appliedCoupon`. */
  appliedCoupon: Coupon | null;
  /** `useCart().isCouponEligible` — false when the subtotal fell under the coupon's minimum. */
  isCouponEligible: boolean;
  /** `useCart().discount` in rupees (the cart's own display-only figure). */
  discount: number;
  /** Outer block (margins). Pass a StyleSheet ref so the memo holds. */
  style?: StyleProp<ViewStyle>;
  /** Root testID; `${testID}-row`, `${testID}-apply`, `${testID}-remove` on the controls. */
  testID?: string;
};

type BestCoupon = { coupon: ActiveCoupon; discount: number } | null;

/** Apply and remove reuse one toast id so a quick apply → remove replaces in place instead of stacking. */
const TOAST_ID = "coupon";
/** M18: the savings amount is the ONLY animated money on checkout; bill totals never animate. */
const SAVINGS_COUNT_MS = 400;
/** 44 pt remove target (a11y). */
const REMOVE_BUTTON_SIZE = 44;
/** Leading glyph box matches ListRow md (34, transparent) so both states line up. */
const GLYPH_SIZE = 34;
const GLYPH_ICON_SIZE = 18;

/** Rupee figure without the symbol (the copy supplies it): 50 → "50", 1249.5 → "1,249.50". */
const rupees = (n: number): string => formatMoney(n, { symbol: false });
const formatSavings = (n: number): string => `You save ₹${rupees(n)}`;

/** Pure navigation — silent (CONTRACTS §8). */
const goToCoupons = (): void => {
  router.push("/product/coupons");
};

// ─── Row ─────────────────────────────────────────────────────────────────────

function OffersRowBase({ subtotal, appliedCoupon, isCouponEligible, discount, style, testID }: OffersRowProps): React.JSX.Element {
  // Juno master flag (CONTRACTS §7): the plain "Apply coupon" row stays; the inline best-coupon offer goes.
  const inhibitBest = useDevFlag("Dev_Juno_inhibit_Feature");
  const [coupons, setCoupons] = useState<ActiveCoupon[] | undefined>(() => peekActiveCoupons());

  useEffect(() => {
    let cancelled = false;
    getActiveCoupons()
      .then((list) => {
        if (!cancelled) setCoupons(list);
      })
      .catch((err) => {
        // Silent: the row still opens the coupons screen, which has its own Retry.
        logSilentFailure("[CHECKOUT] Load coupons", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { eligibleCount, best } = useMemo<{ eligibleCount: number; best: BestCoupon }>(() => {
    if (!coupons || coupons.length === 0) return { eligibleCount: 0, best: null };
    const now = Date.now();
    let count = 0;
    for (const coupon of coupons) {
      if (couponValidityState(coupon, now) === "active" && (coupon.min_order_value ?? 0) <= subtotal) count += 1;
    }
    return { eligibleCount: count, best: findBestCoupon(coupons, subtotal, now) };
  }, [coupons, subtotal]);

  const onApplyBest = useCallback(() => {
    if (!best) return;
    // State change: one `coin` (haptic + ui_coin) + a silent success toast (CONTRACTS §8).
    cartActions.applyCoupon(toCartCoupon(best.coupon));
    feedback.coin();
    notify({
      id: TOAST_ID,
      title: `${best.coupon.code} applied`,
      message: formatSavings(best.discount),
      tone: "success",
    });
  }, [best]);

  const onRemove = useCallback(() => {
    cartActions.removeCoupon();
    feedback.remove();
    notify({ id: TOAST_ID, title: "Coupon removed" });
  }, []);

  // ─── Applied ───────────────────────────────────────────────────────────────
  if (appliedCoupon) {
    const code = appliedCoupon.code;
    const shortfall = Math.max(0, Math.ceil((appliedCoupon.min_order_value ?? 0) - subtotal));
    const tone = isCouponEligible ? C.successText : C.warningText;
    return (
      // Keyed so the apply → applied switch remounts and plays `enter.drop()` (M18); reduced motion snaps.
      <Animated.View key="applied" entering={enter.drop()} style={[styles.root, style]} testID={testID}>
        <View style={styles.appliedRow}>
          <IconWrap size={GLYPH_SIZE} bg="transparent" icon="ticket-percent-outline" iconSize={GLYPH_ICON_SIZE} iconColor={tone} />
          <View
            style={styles.textCol}
            accessible
            accessibilityLabel={
              isCouponEligible
                ? `${code} applied, you save ₹${rupees(discount)}`
                : `${code} applied, add ₹${shortfall} more to use this coupon`
            }
          >
            <Text style={[styles.appliedTitle, { color: tone }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {code} applied
            </Text>
            {isCouponEligible ? (
              <AnimatedNumber
                value={discount}
                mode="count"
                duration={SAVINGS_COUNT_MS}
                format={formatSavings}
                style={styles.savings}
                testID={testID ? `${testID}-savings` : undefined}
              />
            ) : (
              <Text style={styles.shortfall} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                Add ₹{shortfall} more to use this coupon
              </Text>
            )}
          </View>
          <IconButton
            icon="close"
            bg="transparent"
            size={REMOVE_BUTTON_SIZE}
            iconSize={20}
            color={C.textSub}
            onPress={onRemove}
            accessibilityLabel="Remove coupon"
            testID={testID ? `${testID}-remove` : undefined}
          />
        </View>
      </Animated.View>
    );
  }

  // ─── Nothing applied ───────────────────────────────────────────────────────
  const showBest = best !== null && !inhibitBest;
  return (
    <Animated.View key="offer" layout={layoutTiming()} style={[styles.root, style]} testID={testID}>
      <ListRow
        iconBg="transparent"
        icon="ticket-percent-outline"
        title="Apply coupon"
        value={eligibleCount > 0 ? `${eligibleCount} available` : undefined}
        onPress={goToCoupons}
        accessibilityLabel={eligibleCount > 0 ? `Apply coupon, ${eligibleCount} available` : "Apply coupon"}
        testID={testID ? `${testID}-row` : undefined}
      />
      {showBest ? (
        <Animated.View key={best.coupon.id} entering={enter.fade()} style={styles.bestRow}>
          <Text style={styles.bestText} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            <Text style={styles.bestCode}>{best.coupon.code}</Text>
            {` saves you ₹${rupees(best.discount)} on this order`}
          </Text>
          <PrimaryButton
            size="xs"
            variant="outline"
            label={`Apply ${best.coupon.code}`}
            onPress={onApplyBest}
            accessibilityLabel={`Apply coupon ${best.coupon.code}`}
            testID={testID ? `${testID}-apply` : undefined}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Memoised on its props (primitives + the cart's stable coupon object); the active-coupon load lives inside. */
export const OffersRow: React.MemoExoticComponent<(props: OffersRowProps) => React.JSX.Element> = React.memo(OffersRowBase);
OffersRow.displayName = "OffersRow";

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Text column starts after ListRow md's padding + glyph + gap, so the inline offer aligns with the title above it. */
const TEXT_INSET = layout.rowPaddingX + GLYPH_SIZE + layout.rowGap;

const styles = StyleSheet.create({
  root: {},
  // Mirrors ListRow md geometry (ph14 pv13 gap12) so the applied state sits exactly where the row was.
  appliedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: layout.rowPaddingX,
    paddingVertical: layout.rowPaddingY - 4,
    gap: layout.rowGap,
  },
  textCol: { flex: 1 },
  appliedTitle: { ...text.rowTitle },
  savings: { ...text.rowSubtitle, marginTop: 1 },
  shortfall: { ...text.rowSubtitle, color: C.warningText, marginTop: 1 },
  bestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: layout.rowGap,
    paddingLeft: TEXT_INSET,
    paddingRight: layout.rowPaddingX,
    paddingBottom: space[12],
  },
  bestText: { ...text.rowSubtitle, flex: 1 },
  // Coupon tag → the deal accent (C.deal* is for commercial-benefit signals only).
  bestCode: { fontFamily: fontFamily.bold, color: C.dealDark },
});
