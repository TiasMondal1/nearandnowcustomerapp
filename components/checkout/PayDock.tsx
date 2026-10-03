// codename: cinder
// PayDock — the checkout's bottom dock (BP-17 / BP-18 pay-dock selector, cobalt BP-35 offline guard). The sticky
// address strip + the helper line (validation summary / offline reason / wallet hint) render INSIDE the same
// `BottomDock` as the pay row so `useDockHeight()` covers the whole stack: scroll padding, the ToastHost offset and
// the Android keyboard lift all read one number. The method selector subscribes to the payment-selection store in
// isolation (`usePaymentSelection`), so picking a rail on /support/payment-options re-renders this leaf only — the
// reason the old screen kept the selection out of React state. Every press here is silent: the pay button's result
// plays feedback (confirmation owns `success`; checkout plays `error` on cancel/fail), and the selector navigates.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, motion, opacity, radius } from "../../constants/ui";
import { formatMoney } from "../../lib/formatMoney";
import { PAYMENT_LOGOS } from "../../lib/paymentLogos";
import { usePaymentSelection, type PaymentSelection } from "../../lib/paymentSelection";
import { BottomDock, PressableScale, type IconName } from "../ui";

export type PayDockHelperTone = "danger" | "warning" | "neutral";

export type PayDockHelper = {
  /** One line, 12/500. */
  text: string;
  /** danger = validation summary / wallet shortfall (assertive live region); warning = offline; neutral = info. */
  tone: PayDockHelperTone;
};

export type PayDockProps = {
  /** Rounded rupee total shown on the button and read in its label. */
  finalPayable: number;
  /** Forwarded to /support/payment-options as `?tip=` so its total matches this screen. */
  tipAmount: number;
  /** Order in flight: spinner + `accessibilityState.busy`; presses ignored. */
  placing: boolean;
  /** Pay disabled (offline, unless `Dev_Cobalt_inhibit_Feature`); `accessibilityState.disabled` + `disabledHint`. */
  disabled: boolean;
  /** Read as the button's accessibilityHint while disabled ("Connect to the internet to place your order"). */
  disabledHint?: string | null;
  /** Helper line between the address strip and the pay row. */
  helper?: PayDockHelper | null;
  /** Rendered first, full-bleed — the sticky `AddressBlock`. */
  top?: React.ReactNode;
  onPay: () => void;
  testID?: string;
};

/** Width share of the method selector (BP-18: 38 %). */
const SELECTOR_WIDTH = "38%";
const SELECTOR_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

/** `PaymentSelection.icon` is a plain string; only a real MaterialCommunityIcons glyph may be rendered. */
function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(MaterialCommunityIcons.glyphMap, name);
}

function payLabel(sel: PaymentSelection): string {
  if (sel.mode === "cod") return "Place order";
  if (sel.mode === "wallet") return "Pay with wallet";
  return "Pay now";
}

function payA11yLabel(sel: PaymentSelection, money: string): string {
  if (sel.mode === "cod") return `Place order, cash on delivery, ${money}`;
  if (sel.mode === "wallet") return `Pay ${money} with wallet`;
  return `Pay ${money} with ${sel.label}`;
}

const HELPER_COLOR: Record<PayDockHelperTone, string> = {
  danger: C.danger,
  warning: C.warningText,
  neutral: C.textSub,
};

// ─── Method selector (isolated subscriber) ────────────────────────────────────

function PayMethodSelector({ tipAmount }: { tipAmount: number }): React.JSX.Element {
  const sel = usePaymentSelection();
  const logo = sel.logoKey ? PAYMENT_LOGOS[sel.logoKey] : null;
  const glyph: IconName = sel.icon && isIconName(sel.icon) ? sel.icon : "cellphone-wireless";

  const openOptions = () => {
    router.push({ pathname: "/support/payment-options", params: { tip: String(tipAmount) } });
  };

  return (
    <PressableScale
      scale={motion.scale.row}
      onPress={openOptions}
      hitSlop={SELECTOR_HIT_SLOP}
      style={styles.selectorOuter}
      innerStyle={styles.selector}
      pressedStyle={styles.selectorPressed}
      accessibilityLabel={`Pay using ${sel.label}. Change payment method`}
    >
      <View style={styles.logoWrap}>
        {logo ? (
          <Image source={logo} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
        ) : (
          <MaterialCommunityIcons name={glyph} size={22} color={C.text} />
        )}
      </View>
      <View style={styles.selectorText}>
        <View style={styles.selectorEyebrowRow}>
          <Text style={styles.selectorEyebrow} maxFontSizeMultiplier={1.3}>
            PAY USING
          </Text>
          <MaterialCommunityIcons name="chevron-up" size={14} color={C.textSub} />
        </View>
        <Text style={styles.selectorValue} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {sel.label}
        </Text>
      </View>
    </PressableScale>
  );
}

// ─── Pay button (also an isolated subscriber for its label) ───────────────────

function PayButton({
  finalPayable,
  placing,
  disabled,
  disabledHint,
  onPay,
}: Pick<PayDockProps, "finalPayable" | "placing" | "disabled" | "disabledHint" | "onPay">): React.JSX.Element {
  const sel = usePaymentSelection();
  const money = formatMoney(finalPayable);
  const inert = disabled || placing;

  return (
    <PressableScale
      scale={motion.scale.cta}
      onPress={onPay}
      disabled={inert}
      style={styles.payOuter}
      innerStyle={[styles.pay, disabled && styles.payDisabled]}
      pressedStyle={styles.payPressed}
      accessibilityLabel={payA11yLabel(sel, money)}
      accessibilityHint={disabled ? (disabledHint ?? undefined) : undefined}
      accessibilityState={{ disabled: inert, busy: placing }}
    >
      <View style={styles.payAmount}>
        <Text style={styles.payAmountValue} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {money}
        </Text>
        <Text style={styles.payAmountLabel} maxFontSizeMultiplier={1.3}>
          TOTAL
        </Text>
      </View>
      {placing ? (
        <View style={styles.payCta}>
          <ActivityIndicator size="small" color={C.onPrimary} />
          <Text style={styles.payCtaText} maxFontSizeMultiplier={1.3}>
            Placing…
          </Text>
        </View>
      ) : (
        <View style={styles.payCta}>
          <Text style={styles.payCtaText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {payLabel(sel)}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={C.onPrimary} />
        </View>
      )}
    </PressableScale>
  );
}

// ─── Dock ─────────────────────────────────────────────────────────────────────

function PayDockBase({
  finalPayable,
  tipAmount,
  placing,
  disabled,
  disabledHint,
  helper,
  top,
  onPay,
  testID,
}: PayDockProps): React.JSX.Element {
  return (
    // `position: relative` — the screen wraps this dock in its own absolute, keyboard-lifted container.
    <BottomDock style={styles.dock} testID={testID}>
      {top}
      {helper ? (
        <Text
          style={[styles.helper, { color: HELPER_COLOR[helper.tone] }]}
          accessibilityLiveRegion={helper.tone === "danger" ? "assertive" : "polite"}
          maxFontSizeMultiplier={1.3}
        >
          {helper.text}
        </Text>
      ) : null}
      <View style={styles.row}>
        <PayMethodSelector tipAmount={tipAmount} />
        <PayButton finalPayable={finalPayable} placing={placing} disabled={disabled} disabledHint={disabledHint} onPay={onPay} />
      </View>
    </BottomDock>
  );
}

/** Memoised on primitives; the payment selection is read inside its two leaf subscribers. */
export const PayDock = React.memo(PayDockBase);
PayDock.displayName = "PayDock";

const styles = StyleSheet.create({
  // BottomDock supplies the top border, shadow.dock and the inset-aware paddingBottom; the horizontal padding
  // moves onto the pay row so the address strip can run full-bleed above it.
  dock: { position: "relative", paddingHorizontal: 0, paddingTop: 0 },
  helper: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  selectorOuter: { width: SELECTOR_WIDTH },
  selector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 44,
    borderRadius: radius.lg,
  },
  selectorPressed: { backgroundColor: C.bgSoft },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 32, height: 32 },
  selectorText: { flex: 1 },
  selectorEyebrowRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  // 11 px, not the spec's 10: DECISIONS D10 floors every text at 11 px.
  selectorEyebrow: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.4, color: C.textSub },
  selectorValue: { fontFamily: fontFamily.bold, fontSize: 13, color: C.text, marginTop: 1 },
  payOuter: { flex: 1 },
  pay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
    backgroundColor: C.primary,
  },
  payPressed: { backgroundColor: C.primaryDark },
  // A state, not a press fade (D10): offline / placing keeps the face but dims it.
  payDisabled: { opacity: opacity.disabled },
  payAmount: { justifyContent: "center" },
  payAmountValue: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.onPrimary, letterSpacing: 0.2 },
  // 11 px, not the spec's 10 (D10 floor); 85 % white → the C.onDarkSub token.
  payAmountLabel: { fontFamily: fontFamily.bold, fontSize: 11, color: C.onDarkSub, letterSpacing: 0.6, marginTop: 1 },
  payCta: { flexDirection: "row", alignItems: "center", gap: 6 },
  payCtaText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.onPrimary, letterSpacing: 0.2 },
});
