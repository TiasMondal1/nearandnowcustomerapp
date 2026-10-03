// Payment-method modal route — altair sheet styling; the selection itself is persisted by lib/paymentSelection
// (W1-data-core, nn:payment:selection:v1). app/_layout.tsx presents this route with `MODAL` (containedModal on
// iOS), so this file must never wrap its content in a Modal/BottomSheet (double-modal freeze, MAP §7.5).
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import {
  IconButton,
  IconWrap,
  PressableScale,
  PrimaryButton,
  Screen,
  SectionLabel,
  Skeleton,
  SkeletonCircle,
  SkeletonScreen,
  spr,
  useMotionReduced,
  type IconName,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { border, circle, fontFamily, layout, motion, opacity, radius, space, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useForceSkeleton } from "../../hooks/useSlowLoad";
import { feedback } from "../../lib/feedback";
import { formatMoney, roundRupee } from "../../lib/formatMoney";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { getCachedOrderHistoryFlag, loadOrderHistoryFlag } from "../../lib/orderHistoryFlag";
import { PAYMENT_LOGOS, type PaymentLogoKey } from "../../lib/paymentLogos";
import {
  COD_SELECTION,
  setPaymentSelection,
  usePaymentSelection,
  WALLET_SELECTION,
  type PaymentSelection,
  type RazorpayMethod,
} from "../../lib/paymentSelection";
import {
  getCachedSavedPaymentMethods,
  getSavedPaymentMethods,
  isSavedPaymentMethodsEnabled,
  type SavedPaymentMethod,
} from "../../lib/razorpayService";
import { getWalletBalance, peekWalletBalance } from "../../lib/walletService";

// ─── Constants ────────────────────────────────────────────────────────────────

/** The sheet closes this long after a pick so the radio fill is seen. */
const CLOSE_AFTER_PICK_MS = 120;

/** Opened from a cold deep link there is nothing to go back to: land on checkout instead (CONTRACTS §2.5 #20, W3 R6-15). */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/support/checkout");
}
/** Leading column = ListRow lg IconWrap (44); brand marks sit 36 px inside it. */
const LEADING_SIZE = 44;
const LOGO_SIZE = 36;
const RADIO_SIZE = 20;
const RADIO_DOT_SIZE = 10;

type RailOption = {
  key: string;
  mode: "upi";
  method: RazorpayMethod;
  /** Headline shown here and on the checkout pay dock under "PAY USING". */
  label: string;
  subLabel: string;
  icon: IconName;
  /** Bundled brand mark (36 px) — UPI apps only. */
  logoKey?: PaymentLogoKey;
};

// UPI apps — all open Razorpay on the UPI tab; the label is what the checkout pay dock displays.
// The last row mirrors lib/paymentSelection's DEFAULT byte-for-byte so a fresh install renders it selected.
const UPI_APPS: readonly RailOption[] = [
  { key: "gpay", mode: "upi", method: "upi", label: "Google Pay", subLabel: "Pay via Google Pay UPI", icon: "cellphone-wireless", logoKey: "gpay" },
  { key: "phonepe", mode: "upi", method: "upi", label: "PhonePe", subLabel: "Pay via PhonePe UPI", icon: "cellphone-wireless", logoKey: "phonepe" },
  { key: "paytm", mode: "upi", method: "upi", label: "Paytm", subLabel: "Pay via Paytm UPI", icon: "cellphone-wireless", logoKey: "paytm" },
  { key: "upi-other", mode: "upi", method: "upi", label: "Other UPI Apps", subLabel: "Any UPI ID or UPI app", icon: "cellphone-wireless", logoKey: "upi" },
];

const CARD_OPTION: RailOption = {
  key: "card",
  mode: "upi",
  method: "card",
  label: "Credit / Debit Card",
  subLabel: "Visa, Mastercard, RuPay, Amex",
  icon: "credit-card-outline",
};

const NETBANKING_OPTION: RailOption = {
  key: "netbanking",
  mode: "upi",
  method: "netbanking",
  label: "Netbanking",
  subLabel: "All major Indian banks",
  icon: "bank-outline",
};

function railToSelection(opt: RailOption): PaymentSelection {
  return { mode: opt.mode, label: opt.label, subLabel: opt.subLabel, icon: opt.icon, method: opt.method, logoKey: opt.logoKey };
}

function savedToSelection(m: SavedPaymentMethod): PaymentSelection {
  return {
    mode: "upi",
    label: m.label,
    subLabel: m.subLabel,
    icon: m.method === "upi" ? "cellphone-wireless" : "credit-card-outline",
    method: m.method,
    tokenId: m.tokenId,
  };
}

/** `?tip=` arrives from the checkout pay dock (its tip is a separate step after fees/discount, not inside calcOrderTotal). */
function parseTip(raw: string | string[] | undefined): number {
  const val = parseFloat(Array.isArray(raw) ? raw[0] : (raw ?? "0"));
  return Number.isFinite(val) && val > 0 ? val : 0;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PaymentOptionsScreen() {
  const { subtotal, totalQty, discount } = useCart();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = usePaymentSelection();
  const { tip } = useLocalSearchParams<{ tip?: string }>();
  const tipAmount = parseTip(tip);

  // Same math as checkout.tsx (baseFinalPayable + tipAmount, rounded like its pay button / order_total) — the
  // amount lives in the header only; rows never carry an inline "Pay ₹X" (C27).
  const { projected } = calcOrderTotal(subtotal, totalQty, 2);
  const finalPayable = roundRupee(Math.max(projected - discount, 0) + tipAmount);

  // Wallet: the peeked (≤30 s old, user-scoped) balance paints on the first frame; the cached() revalidate
  // replaces it. A failed refresh keeps the peeked value; with nothing peeked the row shows "Balance —" and stays
  // enabled — checkout re-checks the real balance at Pay time.
  const [walletBalance, setWalletBalance] = useState<number | undefined>(() => peekWalletBalance());
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getWalletBalance()
      .then((b) => {
        if (!cancelled) setWalletBalance(b);
      })
      .catch((err) => logSilentFailure("Wallet balance (payment options)", err));
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const walletInsufficient = walletBalance !== undefined && walletBalance < finalPayable;
  const walletShort = walletInsufficient ? Math.ceil(finalPayable - (walletBalance ?? 0)) : 0;
  const walletSubtitle =
    walletBalance === undefined
      ? "Balance —"
      : walletInsufficient
        ? `Insufficient balance · Add ${formatMoney(walletShort)}`
        : walletBalance === 0
          ? "Balance ₹0 · Add money"
          : `Balance ${formatMoney(walletBalance)}`;
  const walletA11y = walletInsufficient
    ? `Near & Now wallet, insufficient balance, add ${formatMoney(walletShort)} more to use`
    : `Near & Now wallet, ${walletSubtitle.replace("—", "unknown")}`;
  const showAddMoney = walletInsufficient || walletBalance === 0;

  // Saved Razorpay tokens ("Preferred payment"): only when the backend pipeline flag is on (C27). The block
  // skeletons only while a fetch is really in flight — cache hit, first-time users (orderHistoryFlag false) and the
  // flag-off case all answer synchronously, so the screen paints in one frame.
  const savedEnabled = isSavedPaymentMethodsEnabled();
  const [savedMethods, setSavedMethods] = useState<SavedPaymentMethod[]>(() => getCachedSavedPaymentMethods(userId) ?? []);
  const [loadingSaved, setLoadingSaved] = useState(
    () => savedEnabled && !!userId && getCachedSavedPaymentMethods(userId) == null && getCachedOrderHistoryFlag() !== false,
  );
  useEffect(() => {
    if (!isSavedPaymentMethodsEnabled() || !userId) return;
    if (getCachedSavedPaymentMethods(userId) != null) return;
    let cancelled = false;
    (async () => {
      try {
        const flag = getCachedOrderHistoryFlag();
        const hasOrdered = flag != null ? flag : await loadOrderHistoryFlag();
        if (cancelled) return;
        if (!hasOrdered) {
          setSavedMethods([]);
          setLoadingSaved(false);
          return;
        }
        const methods = await getSavedPaymentMethods(userId);
        if (!cancelled) {
          setSavedMethods(methods);
          setLoadingSaved(false);
        }
      } catch (err) {
        logSilentFailure("Saved payment methods", err);
        if (!cancelled) setLoadingSaved(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // One pending close at a time; cleared on unmount so a swipe-dismiss mid-window never pops checkout too.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeSheet();
  }, []);

  const select = useCallback((sel: PaymentSelection, alreadySelected: boolean) => {
    if (closeTimerRef.current) return; // a pick is already closing the sheet
    // Synchronous on purpose: checkout reads getPaymentSelection() at Pay time; the persist inside is fire-and-forget.
    setPaymentSelection(sel);
    // One gesture → one haptic, and only when the state actually changes.
    if (!alreadySelected) feedback.toggle(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closeSheet();
    }, CLOSE_AFTER_PICK_MS);
  }, []);

  // Dev_Onyx_inhibit_SkeletonExit forces the saved-methods skeleton like every other screen (W3 R3-08).
  const showSavedSkeleton = useForceSkeleton(loadingSaved);
  const isCod = current.mode === "cod";
  const isWallet = current.mode === "wallet";
  const isRail = (opt: RailOption) =>
    current.mode === opt.mode && current.method === opt.method && !current.tokenId && current.label === opt.label;
  const isSaved = (m: SavedPaymentMethod) => !!current.tokenId && current.tokenId === m.tokenId;

  const itemsLabel = `${totalQty} ${totalQty === 1 ? "item" : "items"}`;

  return (
    <Screen bg={C.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleCol}>
            <Text style={styles.title} accessibilityRole="header">
              Pay using
            </Text>
            <Text style={styles.subtitle}>
              {itemsLabel} · {formatMoney(finalPayable)}
            </Text>
          </View>
          <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={handleClose} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {savedEnabled && showSavedSkeleton ? (
            <>
              <SectionLabel style={styles.eyebrow}>Preferred payment</SectionLabel>
              <SavedMethodsSkeleton />
            </>
          ) : savedEnabled && savedMethods.length > 0 ? (
            <>
              <SectionLabel style={styles.eyebrow}>Preferred payment</SectionLabel>
              {savedMethods.map((m, i) => (
                <PayRow
                  key={m.tokenId}
                  title={m.label}
                  subtitle={m.subLabel}
                  icon={m.method === "upi" ? "cellphone-wireless" : "credit-card-outline"}
                  selected={isSaved(m)}
                  onPress={() => select(savedToSelection(m), isSaved(m))}
                  accessibilityLabel={`${m.label}, saved ${m.method === "upi" ? "UPI ID" : "card"}${m.subLabel ? `, ${m.subLabel}` : ""}`}
                  divider={i < savedMethods.length - 1}
                  testID={`pay-saved-${m.tokenId}`}
                />
              ))}
            </>
          ) : null}

          <SectionLabel style={styles.eyebrow}>Cash on delivery</SectionLabel>
          <PayRow
            title={COD_SELECTION.label}
            subtitle={COD_SELECTION.subLabel}
            icon="cash"
            selected={isCod}
            onPress={() => select(COD_SELECTION, isCod)}
            divider={false}
            testID="pay-cod"
          />

          <SectionLabel style={styles.eyebrow}>Near & Now wallet</SectionLabel>
          <PayRow
            title={WALLET_SELECTION.label}
            subtitle={walletSubtitle}
            icon="wallet-outline"
            selected={isWallet}
            disabled={walletInsufficient}
            onPress={() => select(WALLET_SELECTION, isWallet)}
            accessibilityLabel={walletA11y}
            divider={false}
            testID="pay-wallet"
          />
          {showAddMoney ? (
            <View style={styles.addMoneyRow}>
              <PrimaryButton
                size="xs"
                variant="ghost"
                icon="plus"
                label="Add money"
                onPress={() => router.push("/wallet")}
                accessibilityLabel="Add money to wallet"
                testID="pay-wallet-add-money"
              />
            </View>
          ) : null}

          <SectionLabel style={styles.eyebrow}>UPI</SectionLabel>
          {UPI_APPS.map((opt, i) => (
            <PayRow
              key={opt.key}
              title={opt.label}
              subtitle={opt.subLabel}
              icon={opt.icon}
              logoKey={opt.logoKey}
              selected={isRail(opt)}
              onPress={() => select(railToSelection(opt), isRail(opt))}
              divider={i < UPI_APPS.length - 1}
              testID={`pay-${opt.key}`}
            />
          ))}

          <SectionLabel style={styles.eyebrow}>Cards</SectionLabel>
          <PayRow
            title={CARD_OPTION.label}
            subtitle={CARD_OPTION.subLabel}
            icon={CARD_OPTION.icon}
            selected={isRail(CARD_OPTION)}
            onPress={() => select(railToSelection(CARD_OPTION), isRail(CARD_OPTION))}
            divider={false}
            testID="pay-card"
          />

          <SectionLabel style={styles.eyebrow}>Netbanking</SectionLabel>
          <PayRow
            title={NETBANKING_OPTION.label}
            subtitle={NETBANKING_OPTION.subLabel}
            icon={NETBANKING_OPTION.icon}
            selected={isRail(NETBANKING_OPTION)}
            onPress={() => select(railToSelection(NETBANKING_OPTION), isRail(NETBANKING_OPTION))}
            divider={false}
            testID="pay-netbanking"
          />
        </View>

        <Text style={styles.footer}>
          All online payments are handled securely by Razorpay. We never see your card or UPI credentials.
        </Text>
      </ScrollView>
    </Screen>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

type PayRowProps = {
  title: string;
  subtitle?: string;
  icon: IconName;
  /** 36 px brand mark; replaces the bare glyph. */
  logoKey?: PaymentLogoKey;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Default `"${title}, ${subtitle}"`. */
  accessibilityLabel?: string;
  /** Hairline under the row, drawn OUTSIDE the scaled view. Default true. */
  divider?: boolean;
  testID?: string;
};

/**
 * ListRow lg geometry (ph16 pv16 gap14, 44 leading, 15/700 title, 13/400 subtitle, pressed C.bgSoft, 0.98 scale)
 * rebuilt on PressableScale because the row must be a `radio` with `checked` state, which ListRow (role "button",
 * no role/state props) cannot express. Bare glyphs (`iconBg="transparent"` idiom) — Uber-style, no tinted squares.
 */
function PayRow({ title, subtitle, icon, logoKey, selected, disabled = false, onPress, accessibilityLabel, divider = true, testID }: PayRowProps) {
  return (
    <View style={divider ? styles.divider : undefined}>
      <PressableScale
        scale={motion.scale.row}
        innerStyle={styles.row}
        pressedStyle={styles.rowPressed}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
        accessibilityState={{ checked: selected, disabled }}
        testID={testID}
      >
        <View style={[styles.rowInner, disabled && styles.rowDisabled]}>
          {logoKey ? (
            <View style={styles.logoWrap}>
              <Image source={PAYMENT_LOGOS[logoKey]} style={styles.logo} contentFit="contain" transition={motion.imageFade} />
            </View>
          ) : (
            <IconWrap size={LEADING_SIZE} bg="transparent" icon={icon} iconSize={22} iconColor={C.primary} />
          )}
          <View style={styles.textCol}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.rowSubtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Radio selected={selected} />
        </View>
      </PressableScale>
    </View>
  );
}

/** 20 px radio: idle 1.5 px C.border ring; selected C.primary ring + 10 px dot that pops in on `spring.pop`. */
function Radio({ selected }: { selected: boolean }) {
  const reduced = useMotionReduced();
  const dot = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (!selected) {
      dot.set(0);
      return;
    }
    dot.set(reduced ? 1 : withSpring(1, spr(motion.spring.pop)));
  }, [selected, reduced, dot]);

  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.get() }] }));

  return (
    <View style={[styles.radio, selected && styles.radioOn]} pointerEvents="none">
      <Animated.View style={[styles.radioDot, dotStyle]} />
    </View>
  );
}

/** Two row twins while `getSavedPaymentMethods` is genuinely in flight (4 s hard cap in razorpayService). */
function SavedMethodsSkeleton() {
  return (
    <SkeletonScreen label="Loading saved payment methods…">
      {[0, 1].map((i) => (
        <View key={i} style={[styles.row, styles.rowInner, i === 0 && styles.divider]}>
          <SkeletonCircle size={LEADING_SIZE} />
          <View style={styles.skeletonLines}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="80%" height={11} />
          </View>
          <SkeletonCircle size={RADIO_SIZE} />
        </View>
      ))}
    </SkeletonScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { paddingHorizontal: layout.gutter, paddingTop: space[8], paddingBottom: space[4] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[12] },
  titleCol: { flex: 1 },
  title: { ...text.screenTitle },
  subtitle: { ...text.screenSubtitle },

  scroll: { paddingBottom: layout.scrollBottom },
  eyebrow: { paddingHorizontal: layout.gutter, marginTop: space[16], marginBottom: space[4] },

  // ListRow lg geometry; the hairline sits on the outer, unscaled view.
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  row: { paddingHorizontal: layout.gutter, paddingVertical: space[16] },
  rowPressed: { backgroundColor: C.bgSoft },
  rowInner: { flexDirection: "row", alignItems: "center", gap: space[14] },
  rowDisabled: { opacity: opacity.disabled },
  logoWrap: { width: LEADING_SIZE, height: LEADING_SIZE, alignItems: "center", justifyContent: "center" },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: radius.lg },
  textCol: { flex: 1 },
  rowTitle: { fontFamily: fontFamily.bold, fontSize: 15, color: C.text },
  rowSubtitle: { fontFamily: fontFamily.regular, fontSize: 13, color: C.textSub, marginTop: layout.subtitleGap },

  radio: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: circle(RADIO_SIZE),
    borderWidth: border.input,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: C.primary },
  radioDot: { width: RADIO_DOT_SIZE, height: RADIO_DOT_SIZE, borderRadius: circle(RADIO_DOT_SIZE), backgroundColor: C.primary },

  // Aligns with the wallet row's text column (gutter + leading + gap).
  addMoneyRow: { paddingLeft: layout.gutter + LEADING_SIZE + space[14], paddingBottom: space[8], alignItems: "flex-start" },

  footer: { ...text.caption, textAlign: "center", marginTop: space[24], paddingHorizontal: layout.emptyPadding },
  skeletonLines: { flex: 1, gap: space[8] },
});
