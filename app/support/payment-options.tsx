import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import {
    getCachedOrderHistoryFlag,
    loadOrderHistoryFlag,
} from "../../lib/orderHistoryFlag";
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

type RailOption = {
  key: string;
  mode: "upi" | "cod";
  method?: RazorpayMethod;
  label: string;
  subLabel?: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor?: string;
  iconBg?: string;
};

// All rails that Razorpay exposes. Tapping any of these writes the selection
// and returns to the checkout — the checkout then launches the Razorpay sheet
// with `prefill.method` pointing at the chosen rail so the user lands on the
// right tab immediately.
const UPI_OPTION: RailOption = {
  key: "upi",
  mode: "upi",
  method: "upi",
  label: "Pay by UPI",
  subLabel: "Google Pay, PhonePe, Paytm, BHIM & any UPI app",
  icon: "cellphone-wireless",
  iconColor: "#fc8019",
  iconBg: "#fff2e5",
};

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
  label: "Pay on Delivery",
  subLabel: "Pay in cash when your order arrives",
  icon: "cash-multiple",
  iconColor: "#16a34a",
  iconBg: "#dcfce7",
};

export default function PaymentOptionsScreen() {
  const { items, discount } = useCart();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = getPaymentSelection();

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

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const { finalPayable } = calcOrderTotal(subtotal, totalItems, 2, discount);

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

  const handlePickRail = useCallback(
    (opt: RailOption) => {
      applyAndClose({
        mode: opt.mode,
        label: opt.label,
        subLabel: opt.subLabel,
        icon: opt.icon as string,
        method: opt.method,
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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Payment Options</Text>
          <Text style={styles.headerSub}>
            {totalItems} {totalItems === 1 ? "item" : "items"}. Total: ₹
            {finalPayable.toFixed(0)}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Preferred Payment — saved Razorpay tokens (empty on first visit) */}
        <Text style={styles.sectionTitle}>Preferred Payment</Text>
        <View style={styles.card}>
          {loadingSaved ? (
            <SavedMethodsSkeleton />
          ) : savedMethods.length === 0 ? (
            <View style={styles.emptySaved}>
              <View style={styles.emptySavedIconWrap}>
                <MaterialCommunityIcons
                  name="shield-lock-outline"
                  size={22}
                  color={C.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
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
        </View>

        {/* UPI — single rail entry, hands off to Razorpay UPI tab */}
        <View style={styles.upiHeaderRow}>
          <View style={styles.upiBadge}>
            <Text style={styles.upiBadgeText}>UPI</Text>
          </View>
          <Text style={styles.sectionTitleInline}>Pay by any UPI App</Text>
        </View>
        <View style={styles.card}>
          <RailRow
            opt={UPI_OPTION}
            selected={isSelectedRail(UPI_OPTION)}
            onPress={() => handlePickRail(UPI_OPTION)}
          />
        </View>

        {/* Cards */}
        <Text style={styles.sectionTitle}>Credit & Debit Cards</Text>
        <View style={styles.card}>
          <RailRow
            opt={CARD_OPTION}
            selected={isSelectedRail(CARD_OPTION)}
            onPress={() => handlePickRail(CARD_OPTION)}
          />
        </View>

        {/* More Payment Options */}
        <Text style={styles.sectionTitle}>More Payment Options</Text>
        <View style={styles.card}>
          <RailRow
            opt={WALLET_OPTION}
            selected={isSelectedRail(WALLET_OPTION)}
            onPress={() => handlePickRail(WALLET_OPTION)}
            divider
          />
          <RailRow
            opt={NETBANKING_OPTION}
            selected={isSelectedRail(NETBANKING_OPTION)}
            onPress={() => handlePickRail(NETBANKING_OPTION)}
            divider
          />
          <RailRow
            opt={COD_OPTION}
            selected={isSelectedRail(COD_OPTION)}
            onPress={() => handlePickRail(COD_OPTION)}
          />
        </View>

        <Text style={styles.footerNote}>
          All online payments are handled securely by Razorpay. We never see
          your card or UPI credentials.
        </Text>
      </ScrollView>
    </SafeAreaView>
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
          style={[
            styles.row,
            i === 0 ? { borderBottomWidth: 1, borderBottomColor: C.borderSoft } : null,
          ]}
        >
          <View style={[styles.rowIcon, styles.skeletonBlock]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeletonLine, { width: "55%", height: 12 }]} />
            <View style={[styles.skeletonLine, { width: "80%", height: 10 }]} />
          </View>
          <View style={[styles.radio, styles.skeletonBlock, { borderWidth: 0 }]} />
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
  return (
    <>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={onPress}
      >
        <View
          style={[
            styles.rowIcon,
            { backgroundColor: opt.iconBg ?? C.bgSoft },
          ]}
        >
          <MaterialCommunityIcons
            name={opt.icon}
            size={20}
            color={opt.iconColor ?? C.text}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{opt.label}</Text>
          {opt.subLabel ? (
            <Text style={styles.rowSub}>{opt.subLabel}</Text>
          ) : null}
        </View>
        <View
          style={[styles.radio, selected && styles.radioActive]}
          pointerEvents="none"
        >
          {selected ? (
            <MaterialCommunityIcons name="check" size={14} color="#fff" />
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
        style={styles.row}
        activeOpacity={0.7}
        onPress={onPress}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{method.label}</Text>
          {method.subLabel ? (
            <Text style={styles.rowSub}>{method.subLabel}</Text>
          ) : null}
          {showPayButton && amount != null ? (
            <>
              <TouchableOpacity
                style={styles.inlinePayBtn}
                activeOpacity={0.85}
                onPress={onPress}
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
          style={[styles.radio, selected && styles.radioActive]}
          pointerEvents="none"
        >
          {selected ? (
            <MaterialCommunityIcons name="check" size={14} color="#fff" />
          ) : null}
        </View>
      </TouchableOpacity>
      {divider ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f0f0f5" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  headerSub: { color: C.textSub, fontSize: 12, marginTop: 2 },

  sectionTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  sectionTitleInline: {
    color: C.text,
    fontSize: 14,
    fontWeight: "800",
  },

  card: {
    backgroundColor: C.card,
    marginHorizontal: 12,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.borderSoft,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  rowSub: { color: C.textSub, fontSize: 12, marginTop: 2 },
  rowDivider: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginLeft: 66,
  },

  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
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
  emptySavedIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySavedTitle: { color: C.text, fontSize: 14, fontWeight: "800" },
  emptySavedSub: {
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },

  skeletonBlock: {
    backgroundColor: "#EFEDE7",
  },
  skeletonLine: {
    backgroundColor: "#EFEDE7",
    borderRadius: 4,
  },

  inlinePayBtn: {
    marginTop: 10,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  inlinePayText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  inlinePayHint: {
    color: C.textSub,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 15,
  },

  upiHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  upiBadge: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  upiBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  },

  footerNote: {
    color: C.textSub,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 30,
  },
});
