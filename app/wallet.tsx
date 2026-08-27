import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRazorpay } from "@codearcade/expo-razorpay";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { Card, IconWrap, Screen, ScreenHeader, Skeleton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import {
    createWalletTopupOrder,
    getWalletBalance,
    getWalletTransactions,
    verifyWalletTopup,
    type WalletTransaction,
} from "../lib/walletService";

const T = {
  green: "#2D7A4F",
  greenLight: "#3DA668",
  greenXLight: "#EAF6EE",
  white: "#FFFFFF",
  bg: "#F8F8F6",
  bark: "#3C2F1E",
  barkMid: "#6B5744",
  barkLight: "#A89282",
  cardBorder: "rgba(60,47,30,0.08)",
};

const QUICK_AMOUNTS = [100, 250, 500, 1000];
// Must match MIN_TOPUP_RUPEES/MAX_TOPUP_RUPEES in backend/src/controllers/wallet.controller.ts
const MIN_TOPUP = 10;
const MAX_TOPUP = 50_000;

type TopupPhase = "idle" | "preparing" | "awaiting_gateway" | "verifying";

const PHASE_LABEL: Record<Exclude<TopupPhase, "idle">, string> = {
  preparing: "Setting up…",
  awaiting_gateway: "Waiting for payment…",
  verifying: "Verifying…",
};

const TX_REASON_LABEL: Record<WalletTransaction["reason"], string> = {
  topup: "Wallet Top-up",
  order_payment: "Order Payment",
  refund: "Refund",
};

export default function WalletScreen() {
  const { user, customer } = useAuth();
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [phase, setPhase] = useState<TopupPhase>("idle");
  // Synchronous double-tap guard — phase state alone doesn't take effect
  // until the next render commits.
  const inFlight = useRef(false);

  const TX_PAGE_SIZE = 20;
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(false);
  // getWalletTransactions() always used its default limit=20/offset=0 with
  // no way to see anything older — a customer with more than 20 wallet
  // events (top-ups, order payments, refunds) had no way to reach any of
  // them. loadingMore/hasMore drive a "Load more" button that pages forward
  // instead of ever refetching/replacing what's already on screen.
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreTx, setHasMoreTx] = useState(true);

  const finalAmount = custom.trim() !== "" ? Number(custom) : selected;
  const isValid =
    finalAmount != null &&
    Number.isFinite(finalAmount) &&
    finalAmount >= MIN_TOPUP &&
    finalAmount <= MAX_TOPUP;
  const customOutOfRange =
    custom.trim() !== "" && Number.isFinite(Number(custom)) && !isValid;

  useEffect(() => {
    (async () => {
      try {
        const b = await getWalletBalance();
        setBalance(b);
      } catch {
        // Leave balance null -> renders "—" rather than a misleading ₹0.00
        // that could be mistaken for a real (empty) balance.
      } finally {
        setLoadingBalance(false);
      }
    })();
  }, []);

  const fetchTransactions = React.useCallback(() => {
    setTxLoading(true);
    setTxError(false);
    getWalletTransactions(TX_PAGE_SIZE, 0)
      .then((page) => {
        setTransactions(page);
        setHasMoreTx(page.length === TX_PAGE_SIZE);
      })
      .catch(() => setTxError(true))
      .finally(() => setTxLoading(false));
  }, []);

  const loadMoreTransactions = React.useCallback(async () => {
    if (loadingMore || !hasMoreTx) return;
    setLoadingMore(true);
    try {
      const page = await getWalletTransactions(TX_PAGE_SIZE, transactions.length);
      setTransactions((prev) => [...prev, ...page]);
      setHasMoreTx(page.length === TX_PAGE_SIZE);
    } catch {
      // Non-fatal — the button just stays available to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreTx, transactions.length]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleAddMoney = async () => {
    if (!isValid || inFlight.current) return;
    inFlight.current = true;
    setPhase("preparing");
    try {
      const order = await createWalletTopupOrder(finalAmount!);

      setPhase("awaiting_gateway");
      const gatewayResult = await new Promise<
        | { kind: "success"; paymentId: string; razorpayOrderId: string; signature: string }
        | { kind: "cancelled" }
        | { kind: "failed"; description?: string }
      >((resolve) => {
        openCheckout(
          {
            key: order.key_id,
            amount: order.amount,
            currency: order.currency,
            order_id: order.razorpay_order_id,
            name: "Near & Now Wallet",
            description:
              order.razorpay_mode === "test" ? "Test top-up (Razorpay sandbox)" : "Wallet top-up",
            prefill: {
              name: user?.name || "Customer",
              email: user?.email || "",
              contact: user?.phone || customer?.phone || "",
            },
            theme: { color: T.green },
          },
          {
            onSuccess: (response: {
              razorpay_payment_id: string;
              razorpay_order_id: string;
              razorpay_signature: string;
            }) => {
              resolve({
                kind: "success",
                paymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                signature: response.razorpay_signature,
              });
            },
            onFailure: (error: { description?: string }) => {
              resolve({ kind: "failed", description: error?.description });
            },
            onClose: () => resolve({ kind: "cancelled" }),
          },
        );
      });
      closeCheckout?.();

      if (gatewayResult.kind === "cancelled") return;
      if (gatewayResult.kind === "failed") {
        Alert.alert("Payment failed", gatewayResult.description || "Payment could not be completed.");
        return;
      }

      setPhase("verifying");
      const newBalance = await verifyWalletTopup({
        paymentId: gatewayResult.paymentId,
        razorpayOrderId: gatewayResult.razorpayOrderId,
        signature: gatewayResult.signature,
        amount: finalAmount!,
      });
      setBalance(newBalance);
      setSelected(null);
      setCustom("");
      Alert.alert("Money added", `₹${finalAmount} was added to your wallet.`);
      fetchTransactions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      Alert.alert("Add money failed", message);
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  };

  return (
    <Screen edges={["top"]} bg={T.bg}>
      {/* Header — T-palette variant: transparent 40px chevron back, bark title */}
      <ScreenHeader
        title="My Wallet"
        titleStyle={styles.headerTitle}
        backProps={{ size: 40, bg: "transparent", icon: "chevron-left", iconSize: 28, color: T.bark }}
        right={<View style={styles.headerSpacer} />}
        style={styles.header}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Balance card */}
        <LinearGradient
          colors={[T.greenLight, T.green]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          <View style={styles.balanceIconWrap}>
            <MaterialCommunityIcons name="wallet" size={28} color="rgba(255,255,255,0.9)" />
          </View>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          {loadingBalance ? (
            <ActivityIndicator color="rgba(255,255,255,0.9)" style={{ marginVertical: 6 }} />
          ) : balance == null ? (
            <Text style={styles.balanceAmount}>—</Text>
          ) : (
            <Text style={styles.balanceAmount}>₹{balance.toFixed(2)}</Text>
          )}
          <Text style={styles.balanceSub}>Near &amp; Now Wallet</Text>
        </LinearGradient>

        {/* Add money section */}
        <Card size="lg" bg={T.white} borderColor={T.cardBorder} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Add Money</Text>
            <Text style={styles.cardSubtitle}>Choose a quick amount or enter custom</Text>
          </View>

          {/* Quick amounts */}
          <View style={styles.quickGrid}>
            {QUICK_AMOUNTS.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[
                  styles.quickBtn,
                  selected === amt && custom === "" && styles.quickBtnActive,
                ]}
                onPress={() => {
                  setSelected(amt);
                  setCustom("");
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === amt && custom === "" }}
              >
                <Text
                  style={[
                    styles.quickBtnText,
                    selected === amt && custom === "" && styles.quickBtnTextActive,
                  ]}
                >
                  ₹{amt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom amount */}
          <View style={styles.inputGroup}>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>₹</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter amount"
                placeholderTextColor={T.barkLight}
                selectionColor={T.green}
                keyboardType="number-pad"
                returnKeyType="done"
                value={custom}
                onChangeText={(v) => {
                  setCustom(v.replace(/[^0-9]/g, ""));
                  if (v) setSelected(null);
                }}
                maxLength={6}
              />
            </View>
            {customOutOfRange && (
              <Text style={styles.rangeError}>
                Amount must be between ₹{MIN_TOPUP} and ₹{MAX_TOPUP.toLocaleString("en-IN")}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.addBtn, (!isValid || phase !== "idle") && styles.addBtnDisabled]}
            onPress={handleAddMoney}
            activeOpacity={isValid && phase === "idle" ? 0.85 : 1}
            disabled={!isValid || phase !== "idle"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid || phase !== "idle", busy: phase !== "idle" }}
          >
            {phase !== "idle" ? (
              <ActivityIndicator size="small" color={T.barkLight} />
            ) : (
              <MaterialCommunityIcons
                name="plus-circle-outline"
                size={18}
                color={isValid ? T.white : T.barkLight}
              />
            )}
            <Text style={[styles.addBtnText, (!isValid || phase !== "idle") && styles.addBtnTextDisabled]}>
              {phase !== "idle" ? PHASE_LABEL[phase] : isValid ? `Add ₹${finalAmount}` : "Add Money"}
            </Text>
          </TouchableOpacity>
        </Card>

        {/* Transaction history */}
        <Card size="lg" bg={T.white} borderColor={T.cardBorder} style={styles.card}>
          <Text style={styles.cardTitle}>Transaction History</Text>
          {txLoading ? (
            <TransactionsSkeleton />
          ) : txError ? (
            <View style={styles.txState}>
              <Text style={styles.emptyText}>Couldn&apos;t load transaction history.</Text>
              <TouchableOpacity
                onPress={fetchTransactions}
                style={styles.retryBtn}
                activeOpacity={0.7}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : transactions.length === 0 ? (
            <View style={styles.txEmpty}>
              <IconWrap
                size={56}
                circle
                bg={T.greenXLight}
                icon="receipt-text-outline"
                iconSize={26}
                iconColor={T.barkLight}
              />
              <Text style={styles.txEmptyTitle}>No transactions yet.</Text>
              <Text style={styles.txEmptySub}>Top-ups and payments will show here</Text>
            </View>
          ) : (
            transactions.map((tx, i) => (
              <View
                key={tx.id}
                style={[styles.txRow, i === transactions.length - 1 && styles.txRowLast]}
              >
                <View style={styles.txText}>
                  <Text style={styles.txReason} numberOfLines={1}>
                    {TX_REASON_LABEL[tx.reason] || tx.reason}
                  </Text>
                  <Text style={styles.txDate} numberOfLines={1}>
                    {new Date(tx.created_at).toLocaleDateString("en-IN", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Text style={[styles.txAmount, { color: tx.type === "credit" ? T.green : "#dc2626" }]}>
                  {tx.type === "credit" ? "+" : "-"}₹{Number(tx.amount).toFixed(2)}
                </Text>
              </View>
            ))
          )}
          {!txLoading && !txError && hasMoreTx && transactions.length > 0 && (
            <TouchableOpacity
              onPress={loadMoreTransactions}
              disabled={loadingMore}
              style={styles.loadMoreBtn}
              accessibilityRole="button"
              accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
            >
              {loadingMore ? (
                <ActivityIndicator color={T.green} />
              ) : (
                <Text style={styles.retryText}>Load more</Text>
              )}
            </TouchableOpacity>
          )}
        </Card>

        {/* How it works */}
        <Card size="lg" bg={T.white} borderColor={T.cardBorder} style={styles.card}>
          <Text style={styles.cardTitle}>How it works</Text>
          {[
            { icon: "wallet-plus-outline" as const, text: "Add money to your wallet anytime" },
            { icon: "cart-check" as const, text: "Pay instantly at checkout — no UPI / card needed" },
            { icon: "cash-refund" as const, text: "Refunds are credited back to wallet automatically" },
          ].map(({ icon, text }) => (
            <View key={text} style={styles.howRow}>
              <IconWrap size={34} bg={T.greenXLight} icon={icon} iconSize={18} iconColor={T.green} />
              <Text style={styles.howText}>{text}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
      {RazorpayUI}
    </Screen>
  );
}

/**
 * Static placeholder rows mirroring txRow (reason + date left, amount right)
 * while the first page of transactions loads. Kept static (no pulse) to match
 * the payment-options skeleton.
 */
function TransactionsSkeleton() {
  return (
    <View style={styles.txSkeleton}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.txRow, i === 2 && styles.txRowLast]}>
          <View style={styles.txSkeletonLines}>
            <Skeleton width="45%" height={14} color={T.cardBorder} animated={false} />
            <Skeleton width="30%" height={12} color={T.cardBorder} animated={false} />
          </View>
          <Skeleton width={56} height={14} color={T.cardBorder} animated={false} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomColor: T.cardBorder },
  headerSpacer: { width: 40 },
  headerTitle: { color: T.bark, letterSpacing: -0.2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 60 },

  balanceCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 6,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  balanceIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  balanceLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "PlusJakartaSans_600SemiBold", letterSpacing: 0.3 },
  balanceAmount: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 40, color: T.white, letterSpacing: -1 },
  balanceSub: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 2 },

  card: {
    padding: 20,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHead: { gap: 4 },
  cardTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16, color: T.bark, letterSpacing: -0.2 },
  cardSubtitle: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: T.barkLight },

  quickGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  quickBtn: {
    flex: 1,
    minWidth: "20%",
    minHeight: 44,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: T.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: T.cardBorder,
  },
  quickBtnActive: {
    backgroundColor: T.greenXLight,
    borderColor: T.green,
  },
  quickBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14, color: T.barkMid },
  quickBtnTextActive: { color: T.green },

  inputGroup: { gap: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.bg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  inputPrefix: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, color: T.bark },
  input: { fontFamily: "PlusJakartaSans_700Bold", flex: 1, fontSize: 18, color: T.bark },
  rangeError: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, color: "#dc2626" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    backgroundColor: T.green,
    borderRadius: 14,
    paddingVertical: 14,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  addBtnDisabled: {
    backgroundColor: "#E5E7EB",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: T.white, letterSpacing: 0.2 },
  addBtnTextDisabled: { color: T.barkLight },

  txState: { alignItems: "center", paddingVertical: 12 },
  emptyText: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: T.barkLight, textAlign: "center", paddingVertical: 4 },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  retryText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, color: T.green },
  loadMoreBtn: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingVertical: 12 },

  txEmpty: { alignItems: "center", paddingVertical: 20, gap: 8 },
  txEmptyTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: T.bark },
  txEmptySub: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, color: T.barkLight, textAlign: "center" },

  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  txRowLast: { borderBottomWidth: 0 },
  txText: { flex: 1, flexShrink: 1 },
  txReason: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: T.bark },
  txDate: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 12, color: T.barkLight, marginTop: 2 },
  txAmount: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14, marginLeft: 12 },
  txSkeleton: { gap: 14 },
  txSkeletonLines: { flex: 1, gap: 6 },

  howRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  howText: { fontFamily: "PlusJakartaSans_500Medium", flex: 1, fontSize: 13, color: T.barkMid, lineHeight: 20 },
});
