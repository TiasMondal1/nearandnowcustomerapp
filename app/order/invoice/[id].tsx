// Tax invoice: seeds the order from `peekOrder(id)` (refreshed through `getOrderById`), then fetches the real
// backend-generated invoice (`/api/invoices/order/:id/customer` — proper HSN/GST math, auto-generated on first
// access) and offers Open / Share. The invoice endpoint is only called once the order is eligible
// (`isInvoiceAvailable`), so an ineligible order shows "Invoice not ready yet" instead of a 409.
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import {
  EmptyState,
  IconButton,
  IconWrap,
  notify,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonCircle,
  SkeletonScreen,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import { fontFamily, layout, radius, text } from "../../../constants/ui";
import { useForceSkeleton, useSlowLoad } from "../../../hooks/useSlowLoad";
import { apiFetch } from "../../../lib/apiClient";
import { formatMoney } from "../../../lib/formatMoney";
import { isInvoiceAvailable } from "../../../lib/invoiceEligibility";
import { logError } from "../../../lib/logError";
import { logSilentFailure } from "../../../lib/logSilentFailure";
import { getOrderById, peekOrder, type Order } from "../../../lib/orderService";

interface InvoiceResponse {
  success: boolean;
  url: string;
  expires_in: number;
  invoice_number?: string;
  invoice_date?: string;
  grand_total?: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const SKELETON_LINES = [0, 1, 2, 3] as const;

/** "01 Oct 2026" — hand-rolled so no Intl runs; computed once per invoice (memo), never per render. */
function formatInvoiceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  return `${day < 10 ? "0" : ""}${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function InvoiceScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";

  const [order, setOrder] = useState<Order | null>(() => peekOrder(orderId) ?? null);
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!orderId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setNotReady(false);
    try {
      // Order first (memory seed or a single-order fetch — never the whole history, MAP P8).
      let current = peekOrder(orderId) ?? null;
      if (current) {
        setOrder(current);
        // Background refresh keeps the order number / status current without blocking the invoice.
        getOrderById(orderId)
          .then((fresh) => {
            if (seq === seqRef.current) setOrder(fresh);
          })
          .catch((err) => logSilentFailure("Refresh order for invoice", err));
      } else {
        current = await getOrderById(orderId);
        if (seq !== seqRef.current) return;
        setOrder(current);
      }

      if (!isInvoiceAvailable(current)) {
        setInvoice(null);
        setNotReady(true);
        return;
      }

      const data = await apiFetch<InvoiceResponse>(`/api/invoices/order/${encodeURIComponent(orderId)}/customer`);
      if (seq !== seqRef.current) return;
      setInvoice(data);
    } catch (err) {
      if (seq !== seqRef.current) return;
      logError("Load invoice", err);
      setError(err instanceof Error ? err.message : "Couldn't load the invoice");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const invoiceDate = useMemo(() => (invoice?.invoice_date ? formatInvoiceDate(invoice.invoice_date) : ""), [invoice?.invoice_date]);
  const grandTotal = invoice?.grand_total != null ? formatMoney(invoice.grand_total, { decimals: 2 }) : null;

  const handleOpen = useCallback(async () => {
    if (!invoice?.url || opening) return;
    setOpening(true);
    try {
      const supported = await Linking.canOpenURL(invoice.url);
      if (!supported) throw new Error("No app available to open this invoice");
      await Linking.openURL(invoice.url);
    } catch (err) {
      logError("Open invoice", err);
      notify({
        id: "invoice-open",
        tone: "error",
        title: "Couldn't open the invoice",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOpening(false);
    }
  }, [invoice?.url, opening]);

  const handleShare = useCallback(async () => {
    if (!invoice) return;
    try {
      await Share.share({
        message: `Invoice ${invoice.invoice_number ?? ""} for order ${order?.order_number ?? orderId}${
          grandTotal ? ` — ${grandTotal}` : ""
        }\n${invoice.url}`,
        title: invoice.invoice_number || "Invoice",
      });
    } catch (err) {
      // Also fires on a plain user-cancelled share sheet, not just a real failure — no UI change either way.
      logSilentFailure("Share invoice", err);
    }
  }, [invoice, order?.order_number, orderId, grandTotal]);

  // ─── States ────────────────────────────────────────────────────────────────
  const showSkeleton = useForceSkeleton(loading && !invoice && !notReady);
  const slow = useSlowLoad(showSkeleton);

  if (showSkeleton) {
    return (
      <Screen bg={C.card}>
        <ScreenHeader title="Tax invoice" backFallbackHref="/orders" />
        <SkeletonScreen label="Loading invoice" style={styles.content}>
          <View style={styles.hero}>
            <SkeletonCircle size={72} />
            <Skeleton width={160} height={16} />
          </View>
          <View style={styles.rows}>
            {SKELETON_LINES.map((i) => (
              <View key={i} style={styles.row}>
                <Skeleton width={90} height={12} />
                <Skeleton width={120} height={12} />
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <Skeleton height={48} radius={radius.xl} style={styles.flex1} />
            <Skeleton height={48} radius={radius.xl} style={styles.flex1} />
          </View>
        </SkeletonScreen>
        {slow ? (
          <View style={styles.slowWrap}>
            <Text style={styles.slowText}>Still loading… check your connection</Text>
            <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={load} />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (notReady) {
    return (
      <Screen bg={C.card}>
        <ScreenHeader title="Tax invoice" backFallbackHref="/orders" />
        <EmptyState
          fill
          iconWrap
          icon="file-document-outline"
          title="Invoice not ready yet"
          text="Available once the order is delivered"
          action={{ label: "Back to order", onPress: () => router.replace(`/order/${orderId}`) }}
        />
      </Screen>
    );
  }

  if (error || !invoice) {
    return (
      <Screen bg={C.card}>
        <ScreenHeader title="Tax invoice" backFallbackHref="/orders" />
        <EmptyState
          fill
          tone="error"
          icon="file-alert-outline"
          title="Couldn't load the invoice"
          text={error ?? undefined}
          action={{ label: "Retry", icon: "refresh", onPress: load }}
        />
      </Screen>
    );
  }

  return (
    <Screen bg={C.card}>
      <ScreenHeader
        title="Tax invoice"
        subtitle={invoice.invoice_number}
        backFallbackHref="/orders"
        right={
          <IconButton icon="share-variant" iconSize={20} accessibilityLabel="Share invoice" onPress={handleShare} />
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <IconWrap size={72} radius={radius.xxxl} icon="file-document-outline" iconSize={36} />
          <Text style={styles.heroTitle} maxFontSizeMultiplier={1.3}>
            Your tax invoice is ready
          </Text>
          <Text style={styles.hint}>Full itemised GST breakdown as a PDF</Text>
        </View>

        <View style={styles.rows}>
          {invoice.invoice_number ? <SummaryRow label="Invoice number" value={invoice.invoice_number} /> : null}
          {invoiceDate ? <SummaryRow label="Date" value={invoiceDate} /> : null}
          {order?.order_number ? <SummaryRow label="Order" value={`#${order.order_number}`} /> : null}
          {grandTotal ? <SummaryRow label="Total amount" value={grandTotal} strong last /> : null}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label="Open invoice"
            icon="file-pdf-box"
            loading={opening}
            onPress={handleOpen}
            style={styles.flex1}
            accessibilityLabel={`Open invoice ${invoice.invoice_number ?? ""} as a PDF`}
          />
          <PrimaryButton
            label="Share"
            icon="share-variant"
            variant="outline"
            onPress={handleShare}
            style={styles.flex1}
            accessibilityLabel={`Share invoice ${invoice.invoice_number ?? ""}`}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value, strong, last }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {/* Values wrap instead of truncating — an invoice number must stay fully readable. */}
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  // flexGrow (not flex) so the block stays centred on tall screens and scrolls on short ones.
  content: { flexGrow: 1, padding: layout.gutter, justifyContent: "center", gap: 24 },
  slowWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  slowText: { ...text.caption, textAlign: "center" },

  hero: { alignItems: "center", gap: 12 },
  heroTitle: { ...text.sectionTitleLg, textAlign: "center" },
  hint: { ...text.bodySm, textAlign: "center" },

  rows: { alignSelf: "stretch" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowLabel: { ...text.label, flexShrink: 0 },
  rowValue: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  rowValueStrong: { fontFamily: fontFamily.extrabold, fontSize: 16 },

  actions: { flexDirection: "row", gap: 12 },
});
