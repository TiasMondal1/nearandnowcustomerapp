import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Linking,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../../constants/colors";
import { apiFetch } from "../../../lib/apiClient";
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
      console.error("Failed to load invoice:", err);
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
      console.error("Failed to share invoice:", err);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading invoice...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !invoice) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <MaterialCommunityIcons name="file-alert-outline" size={64} color={C.danger} />
          <Text style={styles.errorText}>{error || "Invoice not found"}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Tax Invoice</Text>
          {invoice.invoice_number && (
            <Text style={styles.headerSubtitle}>{invoice.invoice_number}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
          <MaterialCommunityIcons name="share-variant" size={20} color={C.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="file-document-outline" size={48} color={C.primary} />

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

          <Text style={styles.hint}>
            Your full tax invoice, with itemized GST breakdown, is ready as a PDF.
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.downloadBtn]}
            onPress={handleOpen}
            activeOpacity={0.85}
            disabled={opening}
          >
            {opening ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="file-pdf-box" size={20} color="#fff" />
            )}
            <Text style={styles.actionBtnText}>View / Download PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.shareActionBtn]}
            onPress={handleShare}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="share-variant" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  loadingText: { color: C.textSub, fontSize: 14 },
  errorText: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: 12, textAlign: "center" },
  backButton: {
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bgSoft,
  },
  headerTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  headerSubtitle: { color: C.textSub, fontSize: 12, fontWeight: "600", marginTop: 2 },
  shareBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primaryLight,
  },

  content: { flex: 1, padding: 16, justifyContent: "center" },

  summaryCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 6,
  },
  summaryLabel: { color: C.textSub, fontSize: 13, fontWeight: "600" },
  summaryValue: { color: C.text, fontSize: 14, fontWeight: "700" },
  grandTotalValue: { color: C.primary, fontSize: 16, fontWeight: "900" },
  hint: {
    color: C.textLight,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },

  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  downloadBtn: {
    backgroundColor: C.primary,
    shadowColor: C.primary,
  },
  shareActionBtn: {
    backgroundColor: C.success,
    shadowColor: C.success,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
