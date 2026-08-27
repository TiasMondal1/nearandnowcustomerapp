import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Linking,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    Card,
    EmptyState,
    IconButton,
    IconWrap,
    Screen,
    ScreenHeader,
    Skeleton,
    SkeletonCircle,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import { text } from "../../../constants/ui";
import { apiFetch } from "../../../lib/apiClient";
import { logError } from "../../../lib/logError";
import { logSilentFailure } from "../../../lib/logSilentFailure";
import { getUserOrders, type Order } from "../../../lib/orderService";
import { useAuth } from "../../../context/AuthContext";

interface InvoiceResponse {
  success: boolean;
  url: string;
  expires_in: number;
  invoice_number?: string;
  invoice_date?: string;
  grand_total?: number;
}

function formatInvoiceDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Real backend-generated tax invoice (proper HSN/GST math), not a
      // client-side approximation — auto-generates on first access if this
      // order's invoice PDF doesn't exist yet.
      const [invoiceData, orders] = await Promise.all([
        apiFetch<InvoiceResponse>(`/api/invoices/order/${id}/customer`),
        userId ? getUserOrders(userId) : Promise.resolve<Order[]>([]),
      ]);
      setInvoice(invoiceData);
      setOrder(orders.find((o) => o.id === id) ?? null);
    } catch (err: any) {
      logError("Load invoice", err);
      setError(err?.message || "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpen = async () => {
    if (!invoice?.url) return;
    setOpening(true);
    try {
      const supported = await Linking.canOpenURL(invoice.url);
      if (!supported) throw new Error("No app available to open this invoice");
      await Linking.openURL(invoice.url);
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to open invoice");
    } finally {
      setOpening(false);
    }
  };

  const handleShare = async () => {
    if (!invoice) return;
    try {
      await Share.share({
        message: `Invoice ${invoice.invoice_number ?? ""} for order ${
          order?.order_number ?? id
        }${invoice.grand_total != null ? ` — ₹${invoice.grand_total.toFixed(2)}` : ""}\n${invoice.url}`,
        title: invoice.invoice_number || "Invoice",
      });
    } catch (err) {
      // Also fires on a plain user-cancelled share sheet, not just a real
      // failure — no UI change either way, matches the fire-and-forget case.
      logSilentFailure("Share invoice", err);
    }
  };

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Tax Invoice" align="left" onBack={() => router.back()} />
        <View style={styles.content} accessible accessibilityLabel="Loading invoice">
          <Card shadow="card" style={styles.summaryCard}>
            <SkeletonCircle size={72} />
            <View style={styles.rows}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.summaryRow}>
                  <Skeleton width={90} height={12} />
                  <Skeleton width={120} height={12} />
                </View>
              ))}
            </View>
            <Skeleton width="70%" height={10} style={styles.hintSkeleton} />
          </Card>
          <View style={styles.actions}>
            <Skeleton height={48} radius={12} style={styles.actionSkeleton} />
            <Skeleton height={48} radius={12} style={styles.actionSkeleton} />
          </View>
        </View>
      </Screen>
    );
  }

  if (error || !invoice) {
    return (
      <Screen>
        <ScreenHeader title="Tax Invoice" align="left" onBack={() => router.back()} />
        <EmptyState
          fill
          icon="file-alert-outline"
          iconSize={64}
          iconColor={C.danger}
          title={error || "Invoice not found"}
          action={{ label: "Go Back", onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Tax Invoice"
        subtitle={invoice.invoice_number}
        align="left"
        onBack={() => router.back()}
        right={
          <IconButton
            icon="share-variant"
            iconSize={20}
            bg={C.primaryLight}
            color={C.primary}
            accessibilityLabel="Share invoice"
            onPress={handleShare}
          />
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card shadow="card" style={styles.summaryCard}>
          <IconWrap size={72} radius={20} icon="file-document-outline" iconSize={36} />

          <View style={styles.rows}>
            {invoice.invoice_number && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Invoice Number</Text>
                <Text style={styles.summaryValue}>{invoice.invoice_number}</Text>
              </View>
            )}
            {invoice.invoice_date && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Date</Text>
                <Text style={styles.summaryValue}>{formatInvoiceDate(invoice.invoice_date)}</Text>
              </View>
            )}
            {order?.order_number && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Order</Text>
                <Text style={styles.summaryValue}>#{order.order_number}</Text>
              </View>
            )}
            {invoice.grand_total != null && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total Amount</Text>
                <Text style={styles.grandTotalValue}>₹{invoice.grand_total.toFixed(2)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.hint}>
            Your full tax invoice, with itemized GST breakdown, is ready as a PDF.
          </Text>
        </Card>

        {/* Action Buttons — kept local: the download button swaps its icon for a spinner
            while the label stays visible, which PrimaryButton's `loading` mode does not do. */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.downloadBtn, opening && styles.actionBtnDisabled]}
            onPress={handleOpen}
            activeOpacity={0.8}
            disabled={opening}
            accessibilityRole="button"
            accessibilityState={{ disabled: opening, busy: opening }}
          >
            {opening ? (
              <ActivityIndicator size="small" color={C.card} />
            ) : (
              <MaterialCommunityIcons name="file-pdf-box" size={20} color={C.card} />
            )}
            <Text style={styles.actionBtnText}>View / Download PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.shareActionBtn]}
            onPress={handleShare}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="share-variant" size={20} color={C.card} />
            <Text style={styles.actionBtnText}>Share</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // flexGrow (not flex) so the card stays centered on tall screens and scrolls on short ones.
  content: { flexGrow: 1, padding: 16, justifyContent: "center" },

  summaryCard: {
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  rows: { alignSelf: "stretch" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  summaryLabel: { color: C.textSub, fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", flexShrink: 0 },
  // Values wrap instead of truncating — an invoice number must stay fully readable.
  summaryValue: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14, flexShrink: 1, marginLeft: 12, textAlign: "right" },
  grandTotalValue: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 16, flexShrink: 1, marginLeft: 12, textAlign: "right" },
  hint: { fontFamily: "PlusJakartaSans_400Regular",
    color: C.textLight,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
  hintSkeleton: { marginTop: 8 },

  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  actionSkeleton: { flex: 1 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  actionBtnDisabled: { opacity: 0.7 },
  downloadBtn: {
    backgroundColor: C.primary,
    shadowColor: C.primary,
  },
  shareActionBtn: {
    backgroundColor: C.success,
    shadowColor: C.success,
  },
  actionBtnText: { ...text.buttonSm },
});
