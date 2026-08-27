import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    Card,
    IconWrap,
    Screen,
    ScreenHeader,
    Section,
    SectionLabel,
    Skeleton,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import {
    getCachedOrderHistoryFlag,
    loadOrderHistoryFlag,
} from "../../lib/orderHistoryFlag";
import {
    PAYMENT_LOGOS,
    type PaymentLogoKey,
} from "../../lib/paymentLogos";
import {
    getPaymentSelection,
    setPaymentSelection,
    type PaymentSelection,
    type RazorpayMethod,
} from "../../lib/paymentSelection";
import {
    getCachedSavedPaymentMethods,
    getSavedPaymentMethods,
    isSavedPaymentMethodsEnabled,
    type SavedPaymentMethod,
} from "../../lib/razorpayService";
import { getWalletBalance } from "../../lib/walletService";

type RailOption = {
  key: string;
  mode: "upi" | "cod";
  method?: RazorpayMethod;
  /** Short label shown on the checkout "PAY USING" row. */
  label: string;
  subLabel?: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  /** Bundled brand mark for UPI apps. */
  logoKey?: PaymentLogoKey;
};

// UPI apps — all open Razorpay on the UPI tab; the label is what the
// checkout footer displays under "PAY USING".
const UPI_APPS: RailOption[] = [
  {
    key: "gpay",
    mode: "upi",
    method: "upi",
    label: "Google Pay",
    subLabel: "Pay via Google Pay UPI",
    icon: "cellphone-wireless",
    logoKey: "gpay",
    iconBg: C.card,
  },
  {
    key: "phonepe",
    mode: "upi",
    method: "upi",
    label: "PhonePe",
    subLabel: "Pay via PhonePe UPI",
    icon: "cellphone-wireless",
    logoKey: "phonepe",
    iconBg: "#5f259f",
  },
  {
    key: "paytm",
    mode: "upi",
    method: "upi",
    label: "Paytm",
    subLabel: "Pay via Paytm UPI",
    icon: "cellphone-wireless",
    logoKey: "paytm",
    iconBg: C.card,
  },
  {
    key: "cred",
    mode: "upi",
    method: "upi",
    label: "CRED UPI",
    subLabel: "Pay via CRED",
    icon: "cellphone-wireless",
    logoKey: "cred",
    iconBg: C.card,
  },
  {
    key: "bhim",
    mode: "upi",
    method: "upi",
    label: "BHIM UPI",
    subLabel: "Pay via BHIM",
    icon: "cellphone-wireless",
    logoKey: "bhim",
    iconBg: C.card,
  },
  {
    key: "upi-other",
    mode: "upi",
    method: "upi",
    label: "Other UPI Apps",
    subLabel: "Any UPI ID or UPI app",
    icon: "cellphone-wireless",
    logoKey: "upi",
    iconBg: C.card,
  },
];

const CARD_OPTION: RailOption = {
  key: "card",
  mode: "upi",
  method: "card",
  label: "Credit / Debit Card",
  subLabel: "Visa, Mastercard, RuPay, Amex",
  icon: "credit-card-outline",
  iconColor: "#1a1f71",
  iconBg: "#e8ecff",
};

const NETBANKING_OPTION: RailOption = {
  key: "netbanking",
  mode: "upi",
  method: "netbanking",
  label: "Netbanking",
  subLabel: "All major Indian banks",
  icon: "bank-outline",
  iconColor: "#0f766e",
  iconBg: "#ccfbf1",
};

const COD_OPTION: RailOption = {
  key: "cod",
  mode: "cod",
  label: "Cash on Delivery",
  subLabel: "Pay in cash when your order arrives",
  icon: "cash-multiple",
  iconColor: "#16a34a",
  iconBg: "#dcfce7",
};

const WALLET_OPTION: RailOption = {
  key: "wallet",
  mode: "upi",
  method: "wallet",
  label: "Wallets",
  subLabel: "PhonePe, Amazon Pay, Paytm & more",
  icon: "wallet-outline",
  iconColor: "#6d28d9",
  iconBg: "#ede9fe",
};

/** Warm skeleton gray shared with home.tsx (not a C token). */
const SKELETON_COLOR = "#EFEDE7";

export default function PaymentOptionsScreen() {
  const { items, discount } = useCart();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = getPaymentSelection();
  const { tip } = useLocalSearchParams<{ tip?: string }>();
  const tipAmount = (() => {
    const val = parseFloat(Array.isArray(tip) ? tip[0] : tip ?? "0");
    return Number.isFinite(val) && val > 0 ? val : 0;
  })();

  // Seed from the module-level cache so re-entering the screen paints
  // instantly with the last known list (scoped to this user).
  const cachedSaved = getCachedSavedPaymentMethods(userId);
  const cachedFlag = getCachedOrderHistoryFlag();
  const savedEnabled = isSavedPaymentMethodsEnabled();

  // Decide the initial render state synchronously. We want ZERO skeleton
  // frames whenever we can already answer the question, so the Preferred
  // Payment card paints on the same frame as the rest of the page.
  //
  // Short-circuits, in order:
  //   1. Backend pipeline not enabled (EXPO_PUBLIC_SAVED_METHODS_ENABLED
  //      is unset/false) → always render the empty state, no fetch, no
  //      skeleton. Until the backend wires up Razorpay Customer tokens
  //      there is literally nothing to display, and this path makes the
  //      whole screen feel instant.
  //   2. We have a cached list of saved methods → show it (even if empty).
  //   3. We know the user has NOT placed an order yet → render empty state
  //      immediately, no fetch at all.
  //   4. Otherwise (returning user, no cache, feature enabled) → show
  //      skeleton, fetch in background with a 4s timeout hard-cap (see
  //      `razorpayService`).
  const initialLoading =
    savedEnabled && cachedSaved == null && cachedFlag !== false;

  const [savedMethods, setSavedMethods] = useState<SavedPaymentMethod[]>(
    cachedSaved ?? [],
  );
  const [loadingSaved, setLoadingSaved] = useState(initialLoading);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loadingWalletBalance, setLoadingWalletBalance] = useState(!!userId);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  // Mirrors checkout.tsx's own baseFinalPayable + tipAmount formula exactly
  // (not calcOrderTotal's own rounded finalPayable), since tip is applied
  // as a separate step after the fee/discount calc, not inside the shared util.
  const { projected } = calcOrderTotal(subtotal, totalItems, 2);
  const baseFinalPayable = Math.max(projected - discount, 0);
  const finalPayable = baseFinalPayable + tipAmount;

  useEffect(() => {
    if (!userId) { setLoadingWalletBalance(false); return; }
    let cancelled = false;
    getWalletBalance()
      .then((b) => { if (!cancelled) setWalletBalance(b); })
      .catch(() => { /* leave null -> row shows "Unable to load balance" once loading finishes */ })
      .finally(() => { if (!cancelled) setLoadingWalletBalance(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const walletInsufficient = walletBalance != null && walletBalance < finalPayable;
  const isWalletSelected = current.mode === "wallet";
  // Same expression as the wallet row's `disabled` prop; drives the a11y
  // state and the dimmed look (which stays full-opacity while loading).
  const walletRowDisabled =
    loadingWalletBalance || walletBalance == null || walletInsufficient;
  const walletRowDimmed = walletRowDisabled && !loadingWalletBalance;

  useEffect(() => {
    // Feature off, not logged in, or we already know the answer → nothing to
    // do. Keeps the effect body completely cold on first-run users (the
    // common case) and on logged-out preview navigations.
    if (!savedEnabled) return;
    if (!userId) return;
    if (cachedSaved != null) return;
    let cancelled = false;
    (async () => {
      const hasOrdered =
        cachedFlag != null ? cachedFlag : await loadOrderHistoryFlag();
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
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Close animation first, then update the shared selection store. This
  // keeps the pop animation buttery smooth — the checkout screen's tiny
  // "Pay using…" row re-renders on the *next* frame instead of during the
  // transition, which was making the screen feel like it hung.
  const applyAndClose = useCallback((sel: PaymentSelection) => {
    router.back();
    requestAnimationFrame(() => setPaymentSelection(sel));
  }, []);

  const handlePickWallet = useCallback(() => {
    if (walletBalance == null || walletInsufficient) return;
    applyAndClose({
      mode: "wallet",
      label: "Near & Now Wallet",
      subLabel: `Balance: ₹${walletBalance.toFixed(2)}`,
      icon: "wallet-outline",
    });
  }, [walletBalance, walletInsufficient, applyAndClose]);

  const handlePickRail = useCallback(
    (opt: RailOption) => {
      applyAndClose({
        mode: opt.mode,
        label: opt.label,
        subLabel: opt.subLabel,
        icon: opt.icon as string,
        method: opt.method,
        logoKey: opt.logoKey,
      });
    },
    [applyAndClose],
  );

  const handlePickSaved = useCallback(
    (m: SavedPaymentMethod) => {
      applyAndClose({
        mode: "upi",
        label: m.label,
        subLabel: m.subLabel,
        icon: m.method === "upi" ? "cellphone-wireless" : "credit-card-outline",
        method: m.method,
        tokenId: m.tokenId,
      });
    },
    [applyAndClose],
  );

  const isSelectedRail = (opt: RailOption) =>
    current.mode === opt.mode &&
    current.method === opt.method &&
    !current.tokenId &&
    current.label === opt.label;

  const isSelectedSaved = (m: SavedPaymentMethod) =>
    !!current.tokenId && current.tokenId === m.tokenId;

  return (
    <Screen edges={["top"]} bg="#f0f0f5">
      {/* Header — left-aligned title with the item count + total beneath */}
      <ScreenHeader
        title="Payment Options"
        subtitle={`${totalItems} ${totalItems === 1 ? "item" : "items"}. Total: ₹${finalPayable.toFixed(0)}`}
        align="left"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Preferred Payment — saved Razorpay tokens (empty on first visit) */}
        <Section title="Preferred Payment" style={styles.section} cardStyle={styles.sectionCard}>
          {loadingSaved ? (
            <SavedMethodsSkeleton />
          ) : savedMethods.length === 0 ? (
            <View style={styles.emptySaved}>
              <IconWrap size={40} radius={10} icon="shield-lock-outline" iconSize={22} />
              <View style={styles.emptySavedText}>
                <Text style={styles.emptySavedTitle}>
                  No saved payment methods yet
                </Text>
                <Text style={styles.emptySavedSub}>
                  After your first online payment, your saved cards and UPI
                  IDs will appear here for one-tap checkout.
                </Text>
              </View>
            </View>
          ) : (
            savedMethods.map((m, i) => (
              <SavedRow
                key={m.tokenId}
                method={m}
                selected={isSelectedSaved(m)}
                onPress={() => handlePickSaved(m)}
                amount={finalPayable}
                showPayButton={i === 0 && isSelectedSaved(m)}
                divider={i < savedMethods.length - 1}
              />
            ))
          )}
        </Section>

        {/* Near & Now Wallet — real stored-value balance, separate from the
            "Wallets" rail below (which is Razorpay's third-party wallet
            aggregator — PhonePe/Amazon Pay/Paytm — not our own balance). */}
        <Section title="Near & Now Wallet" style={styles.section} cardStyle={styles.sectionCard}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={handlePickWallet}
            disabled={loadingWalletBalance || walletBalance == null || walletInsufficient}
            accessibilityRole="radio"
            accessibilityState={{
              selected: isWalletSelected,
              checked: isWalletSelected,
              disabled: walletRowDisabled,
            }}
          >
            <View style={[styles.rowIcon, styles.walletIcon, walletRowDimmed && styles.dimmed]}>
              <MaterialCommunityIcons name="wallet-outline" size={20} color="#2D7A4F" />
            </View>
            <View style={[styles.rowText, walletRowDimmed && styles.dimmed]}>
              <Text style={styles.rowTitle} numberOfLines={1}>Near & Now Wallet</Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {loadingWalletBalance
                  ? "Loading balance…"
                  : walletBalance == null
                    ? "Unable to load balance"
                    : walletInsufficient
                      ? `Insufficient balance (₹${walletBalance.toFixed(2)}) — top up to use`
                      : `Balance: ₹${walletBalance.toFixed(2)}`}
              </Text>
            </View>
            <View
              style={[styles.radio, isWalletSelected && styles.radioActive]}
              pointerEvents="none"
            >
              {isWalletSelected ? (
                <MaterialCommunityIcons name="check" size={14} color={C.card} />
              ) : null}
            </View>
          </TouchableOpacity>
        </Section>

        {/* UPI apps — hand-rolled section so the label can carry the UPI badge */}
        <View style={styles.upiSection}>
          <View style={styles.upiHeaderRow}>
            <View style={styles.upiBadge}>
              <Text style={styles.upiBadgeText}>UPI</Text>
            </View>
            <SectionLabel style={styles.sectionLabelInline}>Pay by any UPI App</SectionLabel>
          </View>
          <Card padded={false} borderColor={C.borderSoft}>
            {UPI_APPS.map((opt, i) => (
              <RailRow
                key={opt.key}
                opt={opt}
                selected={isSelectedRail(opt)}
                onPress={() => handlePickRail(opt)}
                divider={i < UPI_APPS.length - 1}
              />
            ))}
          </Card>
        </View>

        {/* COD */}
        <Section title="Cash on Delivery" style={styles.section} cardStyle={styles.sectionCard}>
          <RailRow
            opt={COD_OPTION}
            selected={isSelectedRail(COD_OPTION)}
            onPress={() => handlePickRail(COD_OPTION)}
          />
        </Section>

        {/* Cards */}
        <Section title="Credit & Debit Cards" style={styles.section} cardStyle={styles.sectionCard}>
          <RailRow
            opt={CARD_OPTION}
            selected={isSelectedRail(CARD_OPTION)}
            onPress={() => handlePickRail(CARD_OPTION)}
          />
        </Section>

        {/* Netbanking */}
        <Section title="Netbanking" style={styles.section} cardStyle={styles.sectionCard}>
          <RailRow
            opt={NETBANKING_OPTION}
            selected={isSelectedRail(NETBANKING_OPTION)}
            onPress={() => handlePickRail(NETBANKING_OPTION)}
          />
        </Section>

        {/* More — third-party wallets via Razorpay */}
        <Section title="More Payment Options" style={styles.section} cardStyle={styles.sectionCard}>
          <RailRow
            opt={WALLET_OPTION}
            selected={isSelectedRail(WALLET_OPTION)}
            onPress={() => handlePickRail(WALLET_OPTION)}
          />
        </Section>

        <Text style={styles.footerNote}>
          All online payments are handled securely by Razorpay. We never see
          your card or UPI credentials.
        </Text>
      </ScrollView>
    </Screen>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * Static skeleton placeholder for the Preferred Payment card while we wait
 * on `getSavedPaymentMethods`. Two shimmer-style rows is enough to signal
 * "loading" without being distracting. We intentionally avoid an animated
 * shimmer here because the fetch is capped at 4s and is almost always a
 * cache-hit on repeat visits — a plain soft-gray block reads as "loading"
 * without burning an animation frame.
 */
function SavedMethodsSkeleton() {
  return (
    <View>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={[styles.row, i === 0 && styles.skeletonRowDivider]}
        >
          <Skeleton width={40} height={40} radius={10} color={SKELETON_COLOR} animated={false} />
          <View style={styles.skeletonLines}>
            <Skeleton width="55%" height={12} color={SKELETON_COLOR} animated={false} />
            <Skeleton width="80%" height={10} color={SKELETON_COLOR} animated={false} />
          </View>
          <Skeleton width={22} height={22} radius={11} color={SKELETON_COLOR} animated={false} />
        </View>
      ))}
    </View>
  );
}

function RailRow({
  opt,
  selected,
  onPress,
  divider,
}: {
  opt: RailOption;
  selected: boolean;
  onPress: () => void;
  divider?: boolean;
}) {
  const logo = opt.logoKey ? PAYMENT_LOGOS[opt.logoKey] : null;
  return (
    <>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
      >
        <View
          style={[
            styles.rowIcon,
            { backgroundColor: opt.iconBg ?? C.bgSoft },
            logo ? styles.rowIconLogo : null,
          ]}
        >
          {logo ? (
            <Image
              source={logo}
              style={styles.rowLogo}
              contentFit="contain"
              transition={120}
            />
          ) : (
            <MaterialCommunityIcons
              name={opt.icon}
              size={20}
              color={opt.iconColor ?? C.text}
            />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{opt.label}</Text>
          {opt.subLabel ? (
            <Text style={styles.rowSub} numberOfLines={2}>{opt.subLabel}</Text>
          ) : null}
        </View>
        <View
          style={[styles.radio, selected && styles.radioActive]}
          pointerEvents="none"
        >
          {selected ? (
            <MaterialCommunityIcons name="check" size={14} color={C.card} />
          ) : null}
        </View>
      </TouchableOpacity>
      {divider ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

function SavedRow({
  method,
  selected,
  onPress,
  divider,
  showPayButton,
  amount,
}: {
  method: SavedPaymentMethod;
  selected: boolean;
  onPress: () => void;
  divider?: boolean;
  showPayButton?: boolean;
  amount?: number;
}) {
  const icon: keyof typeof MaterialCommunityIcons.glyphMap =
    method.method === "upi" ? "cellphone-wireless" : "credit-card-outline";
  const iconBg = method.method === "upi" ? "#fff2e5" : "#e8ecff";
  const iconColor = method.method === "upi" ? "#fc8019" : "#1a1f71";
  return (
    <>
      <TouchableOpacity
        style={[styles.row, showPayButton && styles.rowTop]}
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{method.label}</Text>
          {method.subLabel ? (
            <Text style={styles.rowSub} numberOfLines={2}>{method.subLabel}</Text>
          ) : null}
          {showPayButton && amount != null ? (
            <>
              <TouchableOpacity
                style={styles.inlinePayBtn}
                activeOpacity={0.8}
                onPress={onPress}
                accessibilityRole="button"
              >
                <Text style={styles.inlinePayText}>
                  Pay ₹{amount.toFixed(0)}
                </Text>
              </TouchableOpacity>
              <Text style={styles.inlinePayHint}>
                CVV is not needed for cards saved as per RBI guidelines
              </Text>
            </>
          ) : null}
        </View>
        <View
          style={[styles.radio, showPayButton && styles.radioTop, selected && styles.radioActive]}
          pointerEvents="none"
        >
          {selected ? (
            <MaterialCommunityIcons name="check" size={14} color={C.card} />
          ) : null}
        </View>
      </TouchableOpacity>
      {divider ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: { paddingTop: 20, paddingBottom: 40 },

  // Section (label + card) — the primitive supplies marginBottom 20; the
  // label's own paddingHorizontal 2 sits it 2px inside the card edge.
  section: { marginHorizontal: 16 },
  // Keep the original soft card edge (a color decision left to the orchestrator).
  sectionCard: { borderColor: C.borderSoft },
  upiSection: { marginHorizontal: 16, marginBottom: 20 },
  upiHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionLabelInline: { marginBottom: 0, paddingHorizontal: 0 },
  upiBadge: {
    backgroundColor: C.warning,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  upiBadgeText: {
    color: C.card,
    fontSize: 10,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    letterSpacing: 0.3,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  // When the inline Pay button makes the row tall, pin the tile + radio to
  // the title line instead of floating them mid-height.
  rowTop: { alignItems: "flex-start" },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  rowIconLogo: {
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 0,
  },
  rowLogo: {
    width: 40,
    height: 40,
  },
  walletIcon: { backgroundColor: "#EAF6EE" },
  rowText: { flex: 1, flexShrink: 1 },
  rowTitle: { ...text.rowTitle },
  rowSub: { ...text.rowSubtitle, marginTop: 2 },
  // 66 = row paddingHorizontal 14 + rowIcon 40 + gap 12 — keep in lockstep.
  rowDivider: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginLeft: 66,
  },
  dimmed: { opacity: 0.55 },

  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioTop: { marginTop: 10 },
  radioActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },

  emptySaved: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  emptySavedText: { flex: 1 },
  emptySavedTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14 },
  emptySavedSub: { fontFamily: "PlusJakartaSans_400Regular",
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },

  skeletonRowDivider: { borderBottomWidth: 1, borderBottomColor: C.borderSoft },
  skeletonLines: { flex: 1, gap: 8 },

  inlinePayBtn: {
    marginTop: 10,
    minHeight: 44,
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  inlinePayText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 15 },
  inlinePayHint: { fontFamily: "PlusJakartaSans_300Light",
    color: C.textSub,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 15,
  },

  footerNote: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.textSub,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 4,
    paddingHorizontal: 32,
  },
});
