// codename: capella
// Wallet — the owner's flat redesign kept verbatim (typographic balance, 8 px bands, pill chips, underline
// amount field, block CTA, bare glyphs) with the press code moved onto PressableScale/Input, `T.*` retinted
// to `C.*`, and capella's additions: balance seeded from memory and refetched on focus/reconnect, Retry on
// failure (never a permanent "—", U21), count-up + coin + toast after a verified top-up (M11), FlashList
// transactions with sticky month headers (P30), skeleton / empty / error states, low-balance nudge.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRazorpay } from "@codearcade/expo-razorpay";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import {
  AnimatedNumber,
  EmptyState,
  enter,
  exit,
  IconButton,
  Input,
  notify,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  useMotionReduced,
} from "../components/ui";
import { C } from "../constants/colors";
import { fontFamily, motion, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useRefetchOnReconnect } from "../hooks/useRefetchOnReconnect";
import { useForceSkeleton } from "../hooks/useSlowLoad";
import { getDevFlag, useDevFlag } from "../lib/devFlags";
import { feedback } from "../lib/feedback";
import { formatMoney } from "../lib/formatMoney";
import { logError } from "../lib/logError";
import { logSilentFailure } from "../lib/logSilentFailure";
import {
  createWalletTopupOrder,
  getWalletBalance,
  getWalletTransactions,
  isTopupGatewayInhibited,
  peekWalletBalance,
  verifyWalletTopup,
  type WalletTransaction,
} from "../lib/walletService";

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_AMOUNTS = [100, 250, 500, 1000];
// Must match MIN_TOPUP_RUPEES/MAX_TOPUP_RUPEES in backend/src/controllers/wallet.controller.ts
const MIN_TOPUP = 10;
const MAX_TOPUP = 50_000;
// getWalletTransactions() always used its default limit=20/offset=0 with
// no way to see anything older — a customer with more than 20 wallet
// events (top-ups, order payments, refunds) had no way to reach any of
// them. loadingMore/hasMore drive a "Load more" button that pages forward
// instead of ever refetching/replacing what's already on screen.
const TX_PAGE_SIZE = 20;
/** Below this the "Add ₹500 for faster checkout" nudge shows (BP-32). */
const LOW_BALANCE_THRESHOLD = 100;
const NUDGE_AMOUNT = 500;
/** How long the "+₹500" chip stays before it lifts away. */
const DELTA_CHIP_MS = 900;
/** Dev_Wallet_inhibit_TopupGateway: the fake verify step takes this long so the phase label is visible. */
const FAKE_VERIFY_MS = 600;
const SKELETON_ROWS = [0, 1, 2, 3] as const;

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

const HOW_IT_WORKS = [
  { icon: "wallet-plus-outline" as const, text: "Add money to your wallet anytime" },
  { icon: "cart-check" as const, text: "Pay instantly at checkout — no UPI / card needed" },
  { icon: "cash-refund" as const, text: "Refunds are credited back to wallet automatically" },
];

type GatewayResult =
  | { kind: "success"; paymentId: string; razorpayOrderId: string; signature: string }
  | { kind: "cancelled" }
  | { kind: "failed"; description?: string };

/** The low-balance nudge is dismissed for the app session only (in memory, read once per mount). */
let nudgeDismissedThisSession = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Transactions list model ──────────────────────────────────────────────────

type TxHeaderItem = { kind: "header"; key: string; label: string };
type TxRowItem = {
  kind: "tx";
  key: string;
  reasonLabel: string;
  dateLabel: string;
  amountLabel: string;
  credit: boolean;
  isLast: boolean;
};
type TxListItem = TxHeaderItem | TxRowItem;

const keyExtractor = (item: TxListItem) => item.key;
const getItemType = (item: TxListItem) => item.kind;

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Month headers + rows with every label precomputed (nothing formats per render); `sticky` = header indices. */
function buildTxList(transactions: readonly WalletTransaction[]): { data: TxListItem[]; sticky: number[] } {
  const data: TxListItem[] = [];
  const sticky: number[] = [];
  let currentMonth: string | null = null;
  transactions.forEach((tx, i) => {
    const month = monthLabel(tx.created_at);
    if (month !== currentMonth) {
      currentMonth = month;
      sticky.push(data.length);
      data.push({ kind: "header", key: `month:${month}`, label: month });
    }
    const credit = tx.type === "credit";
    const amount = Number(tx.amount);
    data.push({
      kind: "tx",
      key: tx.id,
      reasonLabel: TX_REASON_LABEL[tx.reason] || tx.reason,
      dateLabel: dateLabel(tx.created_at),
      amountLabel: `${credit ? "+" : "-"}₹${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`,
      credit,
      isLast: i === transactions.length - 1,
    });
  });
  return { data, sticky };
}

const renderTxItem = ({ item }: ListRenderItemInfo<TxListItem>) =>
  item.kind === "header" ? (
    <View style={styles.monthHeader}>
      <Text style={styles.monthHeaderText} accessibilityRole="header">
        {item.label}
      </Text>
    </View>
  ) : (
    <View style={[styles.txRow, item.isLast && styles.txRowLast]} accessible accessibilityLabel={`${item.reasonLabel}, ${item.amountLabel}, ${item.dateLabel}`}>
      <View style={styles.txText}>
        <Text style={styles.txReason} numberOfLines={1}>
          {item.reasonLabel}
        </Text>
        <Text style={styles.txDate} numberOfLines={1}>
          {item.dateLabel}
        </Text>
      </View>
      <Text style={[styles.txAmount, item.credit ? styles.txAmountCredit : styles.txAmountDebit]}>{item.amountLabel}</Text>
    </View>
  );

// ─── Quick chip ───────────────────────────────────────────────────────────────

// Quick-amount pill: gray chip that fills green when selected, with a quick
// scale-down on press that springs back on release. Selecting an amount is a
// state change, so the press carries the `toggle` haptic (not when already selected).
function QuickChip({ amount, active, onPress }: { amount: number; active: boolean; onPress: () => void }) {
  // `feedback.toggle(true)` carries the direction + ui_toggle; the `haptic` prop path cannot (W3 R4-13).
  const handlePress = () => {
    if (!active) feedback.toggle(true);
    onPress();
  };
  return (
    <PressableScale
      scale={motion.scale.chip}
      haptic={false}
      style={styles.chipWrap}
      innerStyle={[styles.quickChip, active && styles.quickChipActive]}
      pressedStyle={active ? undefined : styles.chipPressedInactive}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`₹${amount}`}
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.quickChipText, active && styles.quickChipTextActive]}>₹{amount}</Text>
    </PressableScale>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WalletScreen() {
  const { user, customer } = useAuth();
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();
  const inhibitFeature = useDevFlag("Dev_Capella_inhibit_Feature");
  const inhibitCountUp = useDevFlag("Dev_Capella_inhibit_CountUp");
  const reduced = useMotionReduced();

  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  // Seeded from the 30 s memory cache so a revisit paints the balance on the first frame.
  const [balance, setBalance] = useState<number | null>(() => peekWalletBalance() ?? null);
  const [balanceError, setBalanceError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [phase, setPhase] = useState<TopupPhase>("idle");
  // Synchronous double-tap guard — phase state alone doesn't take effect
  // until the next render commits.
  const inFlight = useRef(false);
  // Snap-then-animate (CONTRACTS §4.3 rev. 2): the balance counts ONLY right after a verified top-up.
  const [countUpArmed, setCountUpArmed] = useState(false);
  const [deltaChip, setDeltaChip] = useState<number | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => nudgeDismissedThisSession);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreTx, setHasMoreTx] = useState(true);

  const balanceSeq = useRef(0);
  const txSeq = useRef(0);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (chipTimer.current) clearTimeout(chipTimer.current);
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const finalAmount = custom.trim() !== "" ? Number(custom) : selected;
  const isValid =
    finalAmount != null &&
    Number.isFinite(finalAmount) &&
    finalAmount >= MIN_TOPUP &&
    finalAmount <= MAX_TOPUP;
  const customOutOfRange =
    custom.trim() !== "" && Number.isFinite(Number(custom)) && !isValid;

  // ── Balance ──────────────────────────────────────────────────────────────
  const refetchBalance = useCallback(async (force: boolean) => {
    const seq = ++balanceSeq.current;
    try {
      const b = await getWalletBalance({ force });
      if (seq !== balanceSeq.current) return;
      setBalance(b);
      setBalanceError(false);
    } catch (err) {
      if (seq !== balanceSeq.current) return;
      logSilentFailure("Load wallet balance", err);
      // A stale cached balance keeps painting; with nothing cached the Retry state shows — never a
      // misleading ₹0.00 and never a permanent "—" (U21).
      setBalanceError(true);
    }
  }, []);

  // Stale after a wallet payment at checkout → refetch on every focus (30 s cache makes it cheap).
  useFocusEffect(
    useCallback(() => {
      void refetchBalance(false);
    }, [refetchBalance]),
  );
  useRefetchOnReconnect(() => {
    void refetchBalance(false);
  });

  // ── Transactions ─────────────────────────────────────────────────────────
  const fetchTransactions = useCallback(() => {
    const seq = ++txSeq.current;
    setTxLoading(true);
    setTxError(false);
    getWalletTransactions(TX_PAGE_SIZE, 0)
      .then((page) => {
        if (seq !== txSeq.current) return;
        setTransactions(page);
        setHasMoreTx(page.length === TX_PAGE_SIZE);
      })
      .catch((err) => {
        if (seq !== txSeq.current) return;
        logSilentFailure("Load wallet transactions", err);
        setTxError(true);
      })
      .finally(() => {
        if (seq === txSeq.current) setTxLoading(false);
      });
  }, []);

  const loadMoreTransactions = useCallback(async () => {
    if (loadingMore || !hasMoreTx) return;
    setLoadingMore(true);
    try {
      const page = await getWalletTransactions(TX_PAGE_SIZE, transactions.length);
      setTransactions((prev) => [...prev, ...page]);
      setHasMoreTx(page.length === TX_PAGE_SIZE);
    } catch (err) {
      // Non-fatal — the button just stays available to retry.
      logSilentFailure("Load more wallet transactions", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreTx, transactions.length]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    fetchTransactions();
    await refetchBalance(true);
    setRefreshing(false);
  }, [fetchTransactions, refetchBalance]);

  // ── Top-up ───────────────────────────────────────────────────────────────
  const celebrate = useCallback(
    (amount: number, newBalance: number) => {
      // Dev_Capella_inhibit_Feature: balance snaps, no coin, no delta chip (CONTRACTS §7).
      const quiet = getDevFlag("Dev_Capella_inhibit_Feature");
      if (!quiet) {
        setCountUpArmed(true);
        setDeltaChip(amount);
        feedback.coin();
        if (chipTimer.current) clearTimeout(chipTimer.current);
        chipTimer.current = setTimeout(() => setDeltaChip(null), DELTA_CHIP_MS);
        if (armTimer.current) clearTimeout(armTimer.current);
        // Disarm once the count-up has landed so the next focus refetch snaps again.
        armTimer.current = setTimeout(() => setCountUpArmed(false), motion.duration.countUp + 200);
      }
      setBalance(newBalance);
      setBalanceError(false);
      setSelected(null);
      setCustom("");
      // The toast is silent — the coin already played.
      notify({ title: `₹${amount} added to your wallet`, tone: "success" });
      fetchTransactions();
    },
    [fetchTransactions],
  );

  const handleAddMoney = async () => {
    if (!isValid || inFlight.current || finalAmount == null) return;
    const amount = finalAmount;
    inFlight.current = true;
    setPhase("preparing");
    try {
      // Dev_Wallet_inhibit_TopupGateway (via isTopupGatewayInhibited): skip Razorpay and the backend
      // entirely so the celebration can be exercised offline — verify resolves balance + amount.
      if (isTopupGatewayInhibited()) {
        setPhase("verifying");
        await sleep(FAKE_VERIFY_MS);
        celebrate(amount, (balance ?? 0) + amount);
        return;
      }

      const order = await createWalletTopupOrder(amount);

      setPhase("awaiting_gateway");
      const gatewayResult = await new Promise<GatewayResult>((resolve) => {
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
            theme: { color: C.primary },
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
        feedback.error();
        notify({
          title: "Payment failed",
          message: gatewayResult.description || "Payment could not be completed.",
          tone: "error",
        });
        return;
      }

      setPhase("verifying");
      const newBalance = await verifyWalletTopup({
        paymentId: gatewayResult.paymentId,
        razorpayOrderId: gatewayResult.razorpayOrderId,
        signature: gatewayResult.signature,
        amount,
      });
      celebrate(amount, newBalance);
    } catch (err: unknown) {
      logError("Wallet top-up", err);
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      feedback.error();
      notify({ title: "Add money failed", message, tone: "error" });
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  };

  const dismissNudge = useCallback(() => {
    nudgeDismissedThisSession = true;
    setNudgeDismissed(true);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const { data: txData, sticky: txSticky } = useMemo(() => buildTxList(transactions), [transactions]);
  const ctaEnabled = isValid && phase === "idle";
  const ctaLabel = phase !== "idle" ? PHASE_LABEL[phase] : isValid ? `Add ₹${finalAmount}` : "Add money";
  // First paint SNAPS (duration 0); only a verified top-up arms the count. Both Capella flags force 0.
  const countDuration = countUpArmed && !inhibitFeature && !inhibitCountUp ? motion.duration.countUp : 0;
  const showNudge = balance != null && balance < LOW_BALANCE_THRESHOLD && !nudgeDismissed;
  const showLoadMore = !txLoading && !txError && hasMoreTx && transactions.length > 0;
  // Dev_Onyx_inhibit_SkeletonExit forces the transactions skeleton like every other screen (W3 R3-08).
  const showTxSkeleton = useForceSkeleton(txLoading);

  const header = (
    <>
      {/* Balance — flat and typographic, no hero card */}
      <View style={styles.balanceBlock}>
        <Text style={styles.balanceLabel}>Wallet balance</Text>
        {balance == null ? (
          balanceError ? (
            <View style={styles.balanceErrorRow}>
              <Text style={styles.balanceErrorText}>Couldn&apos;t load balance</Text>
              <PressableScale
                scale={motion.scale.chip}
                pressedStyle={styles.pressedBg}
                innerStyle={styles.retryBtn}
                onPress={() => void refetchBalance(true)}
                accessibilityRole="button"
                accessibilityLabel="Retry loading balance"
              >
                <Text style={styles.retryText}>Retry</Text>
              </PressableScale>
            </View>
          ) : (
            <ActivityIndicator color={C.primary} style={styles.balanceSpinner} />
          )
        ) : (
          <View style={styles.balanceRow} accessibilityLiveRegion={countUpArmed ? "polite" : "none"}>
            <AnimatedNumber
              value={balance}
              mode="count"
              format={(n) => formatMoney(n)}
              duration={countDuration}
              style={styles.balanceAmount}
              accessibilityLabel={`Wallet balance ${formatMoney(balance)}`}
            />
            {deltaChip != null ? (
              <Animated.View
                style={styles.deltaChip}
                entering={reduced ? undefined : enter.rise()}
                exiting={reduced ? undefined : exit.lift()}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={styles.deltaChipText}>+{formatMoney(deltaChip)}</Text>
              </Animated.View>
            ) : null}
          </View>
        )}
        {showNudge ? (
          <View style={styles.nudgeRow}>
            <Text style={styles.nudgeText}>Add ₹{NUDGE_AMOUNT} for faster checkout</Text>
            <IconButton icon="close" size={28} iconSize={16} bg="transparent" color={C.textSub} accessibilityLabel="Dismiss" onPress={dismissNudge} />
          </View>
        ) : null}
      </View>

      <View style={styles.band} />

      {/* Add money */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add money</Text>

        {/* Quick amounts */}
        <View style={styles.quickGrid}>
          {QUICK_AMOUNTS.map((amt) => (
            <QuickChip
              key={amt}
              amount={amt}
              active={selected === amt && custom === ""}
              onPress={() => {
                setSelected(amt);
                setCustom("");
              }}
            />
          ))}
        </View>

        {/* Custom amount — underline field */}
        <Input
          variant="underline"
          left={<Text style={styles.inputPrefix}>₹</Text>}
          placeholder="Enter amount"
          selectionColor={C.primary}
          keyboardType="number-pad"
          returnKeyType="done"
          value={custom}
          onChangeText={(v) => {
            setCustom(v.replace(/[^0-9]/g, ""));
            if (v) setSelected(null);
          }}
          maxLength={6}
          accessibilityLabel="Custom amount"
          error={customOutOfRange ? `Amount must be between ₹${MIN_TOPUP} and ₹${MAX_TOPUP.toLocaleString("en-IN")}` : null}
        />

        {/* Add button — presses down like a physical key (silent; the result plays coin/error) */}
        <PressableScale
          scale={motion.scale.cta}
          pressedStyle={ctaEnabled ? styles.addBtnPressed : undefined}
          innerStyle={[styles.addBtn, !ctaEnabled && styles.addBtnDisabled]}
          onPress={() => void handleAddMoney()}
          disabled={!ctaEnabled}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: !ctaEnabled, busy: phase !== "idle" }}
        >
          {phase !== "idle" ? <ActivityIndicator size="small" color={C.textLight} /> : null}
          <Text style={[styles.addBtnText, !ctaEnabled && styles.addBtnTextDisabled]}>{ctaLabel}</Text>
        </PressableScale>
      </View>

      <View style={styles.band} />

      {/* Transaction history — rows follow as list items (month headers stick) */}
      <View style={styles.txTitleBlock}>
        <Text style={styles.sectionTitle}>Transactions</Text>
      </View>
    </>
  );

  const empty = showTxSkeleton ? (
    <SkeletonScreen label="Loading transactions…">
      {SKELETON_ROWS.map((i) => (
        <View key={i} style={[styles.txRow, i === SKELETON_ROWS.length - 1 && styles.txRowLast]}>
          <View style={styles.txSkeletonLines}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="30%" height={12} />
          </View>
          <Skeleton width={56} height={14} />
        </View>
      ))}
    </SkeletonScreen>
  ) : txError ? (
    <View style={styles.txState}>
      <Text style={styles.emptyText}>Couldn&apos;t load transactions</Text>
      <PressableScale
        scale={motion.scale.chip}
        pressedStyle={styles.pressedBg}
        innerStyle={styles.retryBtn}
        onPress={fetchTransactions}
        accessibilityRole="button"
        accessibilityLabel="Retry loading transactions"
      >
        <Text style={styles.retryText}>Retry</Text>
      </PressableScale>
    </View>
  ) : (
    <EmptyState
      icon="receipt-text-outline"
      title="No transactions yet"
      text="Top-ups and payments will show here"
      style={styles.txEmpty}
    />
  );

  const footer = (
    <>
      {showLoadMore ? (
        <View style={styles.loadMoreWrap}>
          <PrimaryButton
            size="xs"
            variant="ghost"
            label="Load more"
            loading={loadingMore}
            disabled={loadingMore}
            onPress={() => void loadMoreTransactions()}
          />
        </View>
      ) : (
        <View style={styles.txBottomPad} />
      )}

      <View style={styles.band} />

      {/* How it works — bare glyphs, no colored chips */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How it works</Text>
        {HOW_IT_WORKS.map(({ icon, text: copy }) => (
          <View key={copy} style={styles.howRow}>
            <MaterialCommunityIcons name={icon} size={20} color={C.text} />
            <Text style={styles.howText}>{copy}</Text>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <Screen edges={["top"]} bg={C.white}>
      {/* Header — transparent 40px chevron back, ink title; no onBack (deep-link-safe fallback) */}
      <ScreenHeader
        title="My Wallet"
        titleStyle={styles.headerTitle}
        backProps={{ size: 40, bg: "transparent", icon: "chevron-left", iconSize: 28, color: C.text }}
        backFallbackHref="/(tabs)/home"
        right={<View style={styles.headerSpacer} />}
        style={styles.header}
      />

      <FlashList
        data={txData}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderTxItem}
        stickyHeaderIndices={txSticky.length > 0 ? txSticky : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={C.primary} colors={[C.primary]} />
        }
      />
      {RazorpayUI}
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { borderBottomColor: C.hairline },
  headerSpacer: { width: 40 },
  headerTitle: { color: C.text, letterSpacing: -0.2 },
  scroll: { paddingBottom: 60 },

  // Flat typographic balance block (Uber Cash layout)
  balanceBlock: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  balanceLabel: { fontSize: 13, color: C.textSub, fontFamily: fontFamily.semibold, letterSpacing: 0.3 },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  balanceAmount: { fontFamily: fontFamily.extrabold, fontSize: 44, lineHeight: 52, color: C.text, letterSpacing: -1.2 },
  balanceSpinner: { alignSelf: "flex-start", marginTop: 14 },
  balanceErrorRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  balanceErrorText: { fontFamily: fontFamily.medium, fontSize: 13, color: C.textSub },
  deltaChip: { backgroundColor: C.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  deltaChipText: { fontFamily: fontFamily.bold, fontSize: 13, color: C.primaryDark },
  nudgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 },
  nudgeText: { fontFamily: fontFamily.medium, fontSize: 12, color: C.textSub, flex: 1 },

  // Thick gray band between flat sections
  band: { height: 8, backgroundColor: C.surfaceBand },

  section: { paddingHorizontal: 20, paddingVertical: 20, gap: 14 },
  sectionTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.text, letterSpacing: -0.2 },
  txTitleBlock: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  txBottomPad: { height: 12 },

  quickGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  chipWrap: { flex: 1, minWidth: "20%" },
  quickChip: {
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: C.surfaceBand,
    alignItems: "center",
    justifyContent: "center",
  },
  chipPressedInactive: { backgroundColor: C.hairline },
  quickChipActive: { backgroundColor: C.primary },
  quickChipText: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text },
  quickChipTextActive: { color: C.onPrimary },

  inputPrefix: { fontFamily: fontFamily.extrabold, fontSize: 18, color: C.text, marginRight: 6 },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 50,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 15,
  },
  addBtnPressed: { backgroundColor: C.primaryDark },
  addBtnDisabled: { backgroundColor: C.border },
  addBtnText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.onPrimary, letterSpacing: 0.2 },
  addBtnTextDisabled: { color: C.textLight },

  pressedBg: { backgroundColor: C.surfaceBand, borderRadius: 10 },

  txState: { alignItems: "center", paddingVertical: 12 },
  emptyText: { fontFamily: fontFamily.medium, fontSize: 13, color: C.textSub, textAlign: "center", paddingVertical: 4 },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" },
  retryText: { fontFamily: fontFamily.bold, fontSize: 13, color: C.primary },
  loadMoreWrap: { alignItems: "center", paddingVertical: 8 },

  txEmpty: { marginTop: 0, paddingVertical: 20 },

  monthHeader: { backgroundColor: C.surfaceBand, paddingHorizontal: 20, paddingVertical: 6 },
  monthHeaderText: { ...text.eyebrow },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    marginHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
    backgroundColor: C.white,
  },
  txRowLast: { borderBottomWidth: 0 },
  txText: { flex: 1, flexShrink: 1 },
  txReason: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text },
  txDate: { fontFamily: fontFamily.regular, fontSize: 12, color: C.textSub, marginTop: 2 },
  txAmount: { fontFamily: fontFamily.extrabold, fontSize: 14, marginLeft: 12 },
  txAmountCredit: { color: C.successText },
  txAmountDebit: { color: C.text },
  txSkeletonLines: { flex: 1, gap: 6 },

  howRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  howText: { fontFamily: fontFamily.medium, flex: 1, fontSize: 13, color: C.textSub, lineHeight: 20 },
});
