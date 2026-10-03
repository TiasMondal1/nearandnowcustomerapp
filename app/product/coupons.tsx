// codename: juno
// Coupons & offers — a sheet-styled MODAL ROUTE. app/_layout.tsx presents it with `MODAL` (containedModal on
// iOS), so this file must never wrap its content in a Modal/BottomSheet (double-modal freeze, MAP §7.5).
// The promo code is validated against the cached active list only; `lib/couponMath.ts` is a display-only mirror
// and the backend re-derives every discount at order time.
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import {
  Badge,
  EmptyState,
  IconButton,
  Input,
  PressableScale,
  PrimaryButton,
  Screen,
  Skeleton,
  SkeletonScreen,
  enter,
  notify,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { border, fontFamily, layout, motion, opacity, radius, space, text } from "../../constants/ui";
import { useCart } from "../../context/CartContext";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { computeCouponDiscount, couponValidityState } from "../../lib/couponMath";
import {
  findCouponByCode,
  getActiveCoupons,
  peekActiveCoupons,
  toCartCoupon,
  type ActiveCoupon,
} from "../../lib/couponService";
import { useDevFlag } from "../../lib/devFlags";
import { feedback } from "../../lib/feedback";
import { formatMoney } from "../../lib/formatMoney";
import { logSilentFailure } from "../../lib/logSilentFailure";

// ─── Constants ────────────────────────────────────────────────────────────────

/** The sheet closes this long after a successful apply so the "Applied" state is seen before the pop. */
const CLOSE_AFTER_APPLY_MS = 300;

/** Opened from a cold deep link there is nothing to go back to: land on checkout instead (CONTRACTS §2.5 #20, W3 R6-15). */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/support/checkout");
}
/** Dashed ticket stub on the left of every row. */
const STUB_SIZE = 56;
/** Longest code the backend issues is 12 chars; the cap only stops runaway paste. */
const PROMO_MAX_LENGTH = 24;
/** Width of the right-hand action column (Apply / Applied + Remove) so rows line up. */
const ACTION_COL_WIDTH = 84;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Row state resolved at RENDER time, not fetch time: the list is server-filtered when fetched, but this
 * sheet can stay open past a coupon's end time, so validity is re-checked instead of offering a coupon
 * checkout will refuse. (Audit C2, 2026-10-02.)
 */
type RowState = "apply" | "applied" | "ineligible" | "expired" | "not_started";

function rowState(c: ActiveCoupon, appliedId: string | null | undefined, subtotal: number): RowState {
  if (appliedId === c.id) return "applied";
  const validity = couponValidityState(c);
  if (validity !== "active") return validity;
  if (c.min_order_value && subtotal < c.min_order_value) return "ineligible";
  return "apply";
}

/** "₹50" for flat coupons; "10%" for percent AND first_order_discount (both are percentages — backend percentCheck). */
function valueLabel(c: ActiveCoupon): string {
  return c.coupon_type === "flat" ? formatMoney(c.discount_value) : `${c.discount_value}%`;
}

/** Rupees still missing before `c` becomes eligible — rounded UP so the copy never under-states. */
function shortfall(c: ActiveCoupon, subtotal: number): number {
  return Math.max(0, Math.ceil((c.min_order_value ?? 0) - subtotal));
}

/** Display-only estimate for the toast (the backend re-derives the real discount). */
function estimateDiscount(c: ActiveCoupon, subtotal: number): number {
  return computeCouponDiscount(
    { type: c.coupon_type, value: c.discount_value, maxDiscount: c.max_discount_amount ?? null },
    subtotal,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Couldn't load coupons";
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CouponsScreen() {
  const { appliedCoupon, applyCoupon, removeCoupon, subtotal } = useCart();
  // Dev_Juno_inhibit_Feature hides the promo input (CONTRACTS §7: "no promo input; no best-coupon inline row" —
  // the inline row lives on checkout); Dev_Juno_inhibit_PromoInput hides only the input.
  const inhibitFeature = useDevFlag("Dev_Juno_inhibit_Feature");
  const inhibitPromoInput = useDevFlag("Dev_Juno_inhibit_PromoInput");
  const showPromo = !inhibitFeature && !inhibitPromoInput;

  // Memory-first: the second open paints from the 5-min cache before the effect's (deduped) revalidate lands.
  const [coupons, setCoupons] = useState<ActiveCoupon[] | undefined>(() => peekActiveCoupons());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [code, setCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoShake, setPromoShake] = useState(0);

  // One pending close at a time; cleared on unmount so a swipe-dismiss mid-window never pops checkout too.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const load = useCallback(async (force: boolean) => {
    try {
      const list = await getActiveCoupons({ force });
      setCoupons(list);
      setLoadError(null);
    } catch (err) {
      logSilentFailure("Load active coupons", err);
      // A stale list stays on screen (offline pull-to-refresh); only an empty screen shows the error state.
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeSheet();
  }, []);

  const handleApply = useCallback(
    (c: ActiveCoupon) => {
      if (closeTimerRef.current) return; // an apply is already closing the sheet
      const saving = estimateDiscount(c, subtotal);
      applyCoupon(toCartCoupon(c));
      feedback.coin();
      notify({
        id: "coupon",
        title: `${c.code} applied`,
        message: `You save ₹${formatMoney(saving, { symbol: false })}`,
        tone: "success",
      });
      setPromoError(null);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        closeSheet();
      }, CLOSE_AFTER_APPLY_MS);
    },
    [applyCoupon, subtotal],
  );

  const handleRemove = useCallback(() => {
    removeCoupon();
    feedback.remove();
    notify({ id: "coupon", title: "Coupon removed" });
  }, [removeCoupon]);

  const failPromo = (message: string, invalid: boolean) => {
    setPromoError(message);
    setPromoShake((n) => n + 1);
    // Only an unknown code is an error event; an ineligible/expired code is information (card feedback map).
    if (invalid) feedback.error();
  };

  const handlePromoSubmit = () => {
    const needle = code.trim();
    if (!needle) return;
    if (!coupons) {
      failPromo("Offers haven't loaded yet — pull to refresh", false);
      return;
    }
    const found = findCouponByCode(coupons, needle);
    if (!found) {
      failPromo("Code not found", true);
      return;
    }
    switch (rowState(found, appliedCoupon?.id, subtotal)) {
      case "apply":
      case "applied":
        handleApply(found);
        return;
      case "ineligible":
        failPromo(`Add ${formatMoney(shortfall(found, subtotal))} more to use this code`, false);
        return;
      case "expired":
        failPromo("This code has expired", false);
        return;
      case "not_started":
        failPromo("This code isn't active yet", false);
        return;
    }
  };

  const loading = useForceSkeleton(coupons === undefined && !loadError);
  const showError = coupons === undefined && !!loadError;
  const isEmpty = !!coupons && coupons.length === 0;

  return (
    <Screen bg={C.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            Coupons & offers
          </Text>
          <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={handleClose} />
        </View>
        {showPromo ? (
          <Input
            variant="outlined"
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase());
              if (promoError) setPromoError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            placeholder="Enter promo code"
            accessibilityLabel="Promo code"
            returnKeyType="done"
            onSubmitEditing={handlePromoSubmit}
            maxLength={PROMO_MAX_LENGTH}
            error={promoError}
            shakeTrigger={promoShake}
            right={
              <PrimaryButton
                size="xs"
                label="Apply"
                onPress={handlePromoSubmit}
                disabled={!code.trim()}
                accessibilityLabel="Apply promo code"
              />
            }
          />
        ) : null}
      </View>

      {loading ? (
        <CouponsSkeleton />
      ) : showError ? (
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load coupons"
          text={loadError ?? undefined}
          action={{
            label: "Retry",
            onPress: () => {
              setLoadError(null);
              void load(true);
            },
          }}
        />
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => (
            <CouponRow
              coupon={item}
              state={rowState(item, appliedCoupon?.id, subtotal)}
              subtotal={subtotal}
              onApply={handleApply}
              onRemove={handleRemove}
            />
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState
              fill
              icon="ticket-percent-outline"
              title="No coupons right now"
              text="Check back soon for new offers"
            />
          }
          contentContainerStyle={[styles.list, isEmpty && styles.listEmpty]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

const keyExtractor = (c: ActiveCoupon) => c.id;

function Separator() {
  return <View style={styles.separator} />;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

type CouponRowProps = {
  coupon: ActiveCoupon;
  state: RowState;
  subtotal: number;
  onApply: (c: ActiveCoupon) => void;
  onRemove: () => void;
};

/**
 * Flat ticket row. The ROW is the single control (one a11y node per coupon): the Apply / Remove buttons on the
 * right are visual affordances hidden from touch and assistive tech, so a press can never fire twice.
 */
const CouponRow = React.memo(function CouponRow({ coupon, state, subtotal, onApply, onRemove }: CouponRowProps) {
  const applied = state === "applied";
  const disabled = state === "ineligible" || state === "expired" || state === "not_started";
  const value = valueLabel(coupon);
  const minOrder = coupon.min_order_value ?? 0;
  const statusText =
    state === "ineligible"
      ? `Add ${formatMoney(shortfall(coupon, subtotal))} more`
      : state === "expired"
        ? "Expired"
        : state === "not_started"
          ? "Starts soon"
          : null;

  const accessibilityLabel = [
    coupon.code,
    `${value} off`,
    minOrder > 0 ? `min order ${formatMoney(minOrder)}` : null,
    applied ? "applied, remove" : statusText ? statusText.toLowerCase() : "apply",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <PressableScale
      scale={motion.scale.row}
      innerStyle={styles.row}
      pressedStyle={styles.rowPressed}
      disabled={disabled}
      onPress={applied ? onRemove : () => onApply(coupon)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: applied }}
      testID={`coupon-${coupon.code}`}
    >
      <View style={[styles.rowInner, disabled && styles.rowDisabled]}>
        <View style={styles.stub}>
          <Text style={styles.stubValue} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {value}
          </Text>
          <Text style={styles.stubOff} maxFontSizeMultiplier={1.2}>
            OFF
          </Text>
        </View>

        <View style={styles.textCol}>
          <View style={styles.codeRow}>
            <Text style={styles.code} numberOfLines={1}>
              {coupon.code}
            </Text>
            {coupon.coupon_type === "first_order_discount" ? (
              <Badge tone="primary" size="sm" label="First order" />
            ) : null}
          </View>
          {coupon.description ? (
            <Text style={styles.description} numberOfLines={2}>
              {coupon.description}
            </Text>
          ) : null}
          {minOrder > 0 ? <Text style={styles.minOrder}>Min order {formatMoney(minOrder)}</Text> : null}
          {statusText ? (
            <Text style={[styles.status, state === "ineligible" && styles.statusWarn]}>{statusText}</Text>
          ) : null}
        </View>

        <View
          style={styles.actionCol}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {applied ? (
            <Animated.View key="applied" entering={enter.fade()} style={styles.appliedCol}>
              <Badge tone="success" icon="check" label="Applied" />
              <PrimaryButton size="xs" variant="ghost" label="Remove" />
            </Animated.View>
          ) : !disabled ? (
            <PrimaryButton size="xs" variant="ghost" label="Apply" />
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/** Three row twins (stub + three lines + action pill) inside one "Loading…" progressbar node. */
function CouponsSkeleton() {
  return (
    <SkeletonScreen label="Loading coupons…" style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i}>
          <View style={[styles.row, styles.rowInner]}>
            <Skeleton width={STUB_SIZE} height={STUB_SIZE} radius={radius.lg} />
            <View style={styles.skeletonLines}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="85%" height={12} />
              <Skeleton width="30%" height={11} />
            </View>
            <Skeleton width={64} height={32} radius={radius.xl} />
          </View>
          {i < 2 ? <Separator /> : null}
        </View>
      ))}
    </SkeletonScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { paddingHorizontal: layout.gutter, paddingTop: space[8], paddingBottom: space[12], gap: space[12] },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[12] },
  title: { ...text.screenTitle, flex: 1 },

  list: { paddingBottom: layout.scrollBottom },
  listEmpty: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginLeft: layout.gutter },

  row: { paddingHorizontal: layout.gutter, paddingVertical: space[14] },
  rowPressed: { backgroundColor: C.bgSoft },
  rowInner: { flexDirection: "row", alignItems: "center", gap: space[12] },
  rowDisabled: { opacity: opacity.disabled },

  // Deal tones are correct here: a coupon's value is a commercial-benefit signal (constants/colors.ts).
  // 13/700 not 13/800: D10 forbids the ExtraBold face under 14 px.
  stub: {
    width: STUB_SIZE,
    minHeight: STUB_SIZE,
    borderRadius: radius.lg,
    borderWidth: border.thin,
    borderStyle: "dashed",
    borderColor: C.deal,
    backgroundColor: C.dealLight,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space[6],
    paddingHorizontal: space[4],
  },
  stubValue: { fontFamily: fontFamily.bold, fontSize: 13, color: C.dealDark, letterSpacing: -0.2 },
  stubOff: { fontFamily: fontFamily.bold, fontSize: 11, color: C.dealDark, letterSpacing: 0.6, marginTop: 1 },

  textCol: { flex: 1, gap: space[2] },
  codeRow: { flexDirection: "row", alignItems: "center", gap: space[8] },
  code: { fontFamily: fontFamily.extrabold, fontSize: 14, color: C.text, letterSpacing: 1, flexShrink: 1 },
  description: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: C.textSub },
  minOrder: { fontFamily: fontFamily.medium, fontSize: 12, color: C.textSub },
  status: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub, marginTop: space[2] },
  statusWarn: { color: C.warningText },

  actionCol: { width: ACTION_COL_WIDTH, alignItems: "flex-end", justifyContent: "center" },
  appliedCol: { alignItems: "flex-end", gap: space[4] },

  skeletonLines: { flex: 1, gap: space[8] },
});
