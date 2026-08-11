import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRazorpay } from "@codearcade/expo-razorpay";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";

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

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(false);

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
    getWalletTransactions()
      .then(setTransactions)
      .catch(() => setTxError(true))
      .finally(() => setTxLoading(false));
  }, []);

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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={T.bark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Wallet</Text>
        <View style={{ width: 40 }} />
      </View>

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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add Money</Text>
          <Text style={styles.cardSubtitle}>Choose a quick amount or enter custom</Text>

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
          <View style={styles.inputWrap}>
            <Text style={styles.inputPrefix}>₹</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter amount"
              placeholderTextColor={T.barkLight}
              keyboardType="number-pad"
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

          <TouchableOpacity
            style={[styles.addBtn, (!isValid || phase !== "idle") && styles.addBtnDisabled]}
            onPress={handleAddMoney}
            activeOpacity={isValid && phase === "idle" ? 0.85 : 1}
            disabled={!isValid || phase !== "idle"}
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
        </View>

        {/* Transaction history */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transaction History</Text>
          {txLoading ? (
            <ActivityIndicator color={T.green} style={{ marginVertical: 12 }} />
          ) : txError ? (
            <View style={{ alignItems: "center", paddingVertical: 12 }}>
              <Text style={styles.emptyText}>Couldn't load transaction history.</Text>
              <TouchableOpacity onPress={fetchTransactions} style={{ marginTop: 8 }}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : transactions.length === 0 ? (
            <Text style={styles.emptyText}>No transactions yet.</Text>
          ) : (
            transactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txReason}>{TX_REASON_LABEL[tx.reason] || tx.reason}</Text>
                  <Text style={styles.txDate}>
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
        </View>

        {/* How it works */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How it works</Text>
          {[
            { icon: "wallet-plus-outline" as const, text: "Add money to your wallet anytime" },
            { icon: "cart-check" as const, text: "Pay instantly at checkout — no UPI / card needed" },
            { icon: "cash-refund" as const, text: "Refunds are credited back to wallet automatically" },
          ].map(({ icon, text }) => (
            <View key={text} style={styles.howRow}>
              <View style={styles.howIconWrap}>
                <MaterialCommunityIcons name={icon} size={18} color={T.green} />
              </View>
              <Text style={styles.howText}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {RazorpayUI}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.bark, letterSpacing: -0.2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 60 },

  balanceCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 6,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 10,
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
  balanceLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600", letterSpacing: 0.3 },
  balanceAmount: { fontSize: 40, color: T.white, fontWeight: "900", letterSpacing: -1 },
  balanceSub: { fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: "600", marginTop: 2 },

  card: {
    backgroundColor: T.white,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: T.cardBorder,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: T.bark, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: 13, color: T.barkLight, fontWeight: "500", marginTop: -8 },

  quickGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  quickBtn: {
    flex: 1,
    minWidth: "20%",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.bg,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: T.cardBorder,
  },
  quickBtnActive: {
    backgroundColor: T.greenXLight,
    borderColor: T.green,
  },
  quickBtnText: { fontSize: 14, fontWeight: "800", color: T.barkMid },
  quickBtnTextActive: { color: T.green },

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
  inputPrefix: { fontSize: 18, fontWeight: "800", color: T.bark },
  input: { flex: 1, fontSize: 18, fontWeight: "700", color: T.bark },
  rangeError: { fontSize: 12, color: "#dc2626", marginTop: -6 },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: T.green,
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: T.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  addBtnDisabled: {
    backgroundColor: "#E5E7EB",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: { fontSize: 15, fontWeight: "800", color: T.white, letterSpacing: 0.2 },
  addBtnTextDisabled: { color: T.barkLight },

  emptyText: { fontSize: 13, color: T.barkLight, textAlign: "center", paddingVertical: 4 },
  retryText: { fontSize: 13, fontWeight: "700", color: T.green },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  txReason: { fontSize: 14, fontWeight: "700", color: T.bark },
  txDate: { fontSize: 12, color: T.barkLight, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: "800" },

  howRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  howIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: T.greenXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  howText: { flex: 1, fontSize: 13, color: T.barkMid, lineHeight: 20, fontWeight: "500", paddingTop: 8 },
});
