import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../../constants/colors";
import { useAuth } from "../../../context/AuthContext";
import {
    formatCurrency,
    formatInvoiceDate,
    orderToInvoice,
    type InvoiceData,
} from "../../../lib/invoiceService";
import { getUserOrders, type Order } from "../../../lib/orderService";

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId, user, customer } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;

    (async () => {
      try {
        const orders = await getUserOrders(userId);
        const found = orders.find((o) => o.id === id);
        if (!cancelled && found) {
          setOrder(found);

          const invoiceData = orderToInvoice(
            found,
            undefined,
            {
              name: user?.name || customer?.name || 'Customer',
              phone: user?.phone || customer?.phone || '',
              email: user?.email ?? undefined,
            }
          );
          setInvoice(invoiceData);
        }
      } catch (err) {
        console.error("Failed to load invoice:", err);
        Alert.alert("Error", "Failed to load invoice details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, userId, user, customer]);

  const handleShare = async () => {
    if (!invoice) return;

    try {
      const message = `
Invoice: ${invoice.invoiceNumber}
Order: #${invoice.orderNumber}
Date: ${formatInvoiceDate(invoice.invoiceDate)}

${invoice.businessName}
${invoice.businessAddress}
GSTIN: ${invoice.businessGSTIN}

Bill To:
${invoice.customerName}
${invoice.customerPhone}
${invoice.customerAddress}

Items:
${invoice.items.map((item, idx) =>
  `${idx + 1}. ${item.name} ${item.unit ? `(${item.unit})` : ''}\n   ${item.quantity} × ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.total)}`
).join('\n')}

Subtotal: ${formatCurrency(invoice.subtotal)}
Delivery Fee: ${formatCurrency(invoice.deliveryFee)}
Tax (${invoice.taxRate}%): ${formatCurrency(invoice.taxAmount)}
Total: ${formatCurrency(invoice.total)}

Payment: ${invoice.paymentMethod} - ${invoice.paymentStatus}

Thank you for your order!
      `.trim();

      await Share.share({
        message,
        title: `Invoice ${invoice.invoiceNumber}`,
      });
    } catch (err) {
      console.error("Failed to share invoice:", err);
    }
  };

  const handleDownload = () => {
    Alert.alert(
      "Download Invoice",
      "PDF download will be available in the next update. You can share the invoice details for now.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Share", onPress: handleShare },
      ]
    );
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

  if (!invoice || !order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <MaterialCommunityIcons name="file-alert-outline" size={64} color={C.danger} />
          <Text style={styles.errorText}>Invoice not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const gst = {
    cgst: invoice.taxAmount / 2,
    sgst: invoice.taxAmount / 2,
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Tax Invoice</Text>
          <Text style={styles.headerSubtitle}>{invoice.invoiceNumber}</Text>
        </View>
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={handleShare}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="share-variant" size={20} color={C.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Invoice Container */}
        <View style={styles.invoiceContainer}>
          {/* Invoice Header */}
          <View style={styles.invoiceHeader}>
            <View>
              <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
              <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.invoiceDate}>
                Date: {formatInvoiceDate(invoice.invoiceDate)}
              </Text>
              <Text style={styles.orderRef}>Order: #{invoice.orderNumber}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Business & Customer Details */}
          <View style={styles.detailsRow}>
            <View style={styles.detailsColumn}>
              <Text style={styles.detailsLabel}>From:</Text>
              <Text style={styles.businessName}>{invoice.businessName}</Text>
              <Text style={styles.detailsText}>{invoice.businessAddress}</Text>
              <Text style={styles.detailsText}>GSTIN: {invoice.businessGSTIN}</Text>
              <Text style={styles.detailsText}>Phone: {invoice.businessPhone}</Text>
              <Text style={styles.detailsText}>Email: {invoice.businessEmail}</Text>
            </View>

            <View style={styles.detailsColumn}>
              <Text style={styles.detailsLabel}>Bill To:</Text>
              <Text style={styles.customerName}>{invoice.customerName}</Text>
              <Text style={styles.detailsText}>{invoice.customerPhone}</Text>
              {invoice.customerEmail && (
                <Text style={styles.detailsText}>{invoice.customerEmail}</Text>
              )}
              <Text style={styles.detailsText}>{invoice.customerAddress}</Text>
              {invoice.customerGSTIN && (
                <Text style={styles.detailsText}>GSTIN: {invoice.customerGSTIN}</Text>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Items Table */}
          <View style={styles.table}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { flex: 2 }]}>Item</Text>
              <Text style={[styles.tableHeaderText, { flex: 0.8, textAlign: 'center' }]}>Qty</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Rate</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Amount</Text>
            </View>

            {/* Table Rows */}
            {invoice.items.map((item, idx) => (
              <View key={idx} style={styles.tableRow}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.unit && <Text style={styles.itemUnit}>{item.unit}</Text>}
                </View>
                <Text style={[styles.tableText, { flex: 0.8, textAlign: 'center' }]}>
                  {item.quantity}
                </Text>
                <Text style={[styles.tableText, { flex: 1, textAlign: 'right' }]}>
                  {formatCurrency(item.unitPrice)}
                </Text>
                <Text style={[styles.tableText, { flex: 1, textAlign: 'right', fontWeight: '700' }]}>
                  {formatCurrency(item.unitPrice * item.quantity)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.divider} />

          {/* Totals */}
          <View style={styles.totalsSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.subtotal)}</Text>
            </View>

            {invoice.deliveryFee > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Delivery Fee</Text>
                <Text style={styles.totalValue}>{formatCurrency(invoice.deliveryFee)}</Text>
              </View>
            )}

            {invoice.discount > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: C.success }]}>Discount</Text>
                <Text style={[styles.totalValue, { color: C.success }]}>
                  -{formatCurrency(invoice.discount)}
                </Text>
              </View>
            )}

            <View style={styles.taxBreakdown}>
              <View style={styles.totalRow}>
                <Text style={styles.taxLabel}>CGST ({invoice.taxRate / 2}%)</Text>
                <Text style={styles.taxValue}>{formatCurrency(gst.cgst)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.taxLabel}>SGST ({invoice.taxRate / 2}%)</Text>
                <Text style={styles.taxValue}>{formatCurrency(gst.sgst)}</Text>
              </View>
            </View>

            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total Amount</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(invoice.total)}</Text>
            </View>
          </View>

          {/* Payment Status */}
          <View style={styles.paymentSection}>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Payment Method:</Text>
              <Text style={styles.paymentValue}>{invoice.paymentMethod}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Payment Status:</Text>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      invoice.paymentStatus === 'Paid' ? C.successLight : C.warningLight,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    {
                      color: invoice.paymentStatus === 'Paid' ? C.success : C.warning,
                    },
                  ]}
                >
                  {invoice.paymentStatus}
                </Text>
              </View>
            </View>
          </View>

          {/* Terms & Conditions */}
          <View style={styles.termsSection}>
            <Text style={styles.termsTitle}>Terms & Conditions:</Text>
            {invoice.termsAndConditions.map((term, idx) => (
              <Text key={idx} style={styles.termText}>
                {idx + 1}. {term}
              </Text>
            ))}
          </View>

          {/* Footer */}
          <View style={styles.invoiceFooter}>
            <Text style={styles.footerText}>
              This is a computer-generated invoice and does not require a signature.
            </Text>
            <Text style={styles.footerThank}>Thank you for your business!</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.downloadBtn]}
            onPress={handleDownload}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="download" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Download PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.shareActionBtn]}
            onPress={handleShare}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="share-variant" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Share Invoice</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  errorText: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: 12 },
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

  scrollContent: { paddingBottom: 40 },

  invoiceContainer: {
    margin: 16,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },

  invoiceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  invoiceTitle: {
    color: C.primary,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  invoiceNumber: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  invoiceDate: { color: C.textSub, fontSize: 13, fontWeight: "600" },
  orderRef: { color: C.textSub, fontSize: 12, marginTop: 2 },

  divider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 16,
  },

  detailsRow: {
    flexDirection: "row",
    gap: 16,
  },
  detailsColumn: {
    flex: 1,
  },
  detailsLabel: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  businessName: {
    color: C.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  customerName: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  detailsText: {
    color: C.textSub,
    fontSize: 12,
    lineHeight: 18,
  },

  table: {
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.bgSoft,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  tableHeaderText: {
    color: C.text,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  itemName: {
    color: C.text,
    fontSize: 13,
    fontWeight: "600",
  },
  itemUnit: {
    color: C.textSub,
    fontSize: 11,
    marginTop: 2,
  },
  tableText: {
    color: C.text,
    fontSize: 13,
  },

  totalsSection: {
    marginTop: 8,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  totalLabel: {
    color: C.textSub,
    fontSize: 14,
    fontWeight: "600",
  },
  totalValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
  taxBreakdown: {
    backgroundColor: C.bgSoft,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  taxLabel: {
    color: C.textSub,
    fontSize: 13,
    fontWeight: "600",
  },
  taxValue: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.primaryLight,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  grandTotalLabel: {
    color: C.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  grandTotalValue: {
    color: C.primary,
    fontSize: 18,
    fontWeight: "900",
  },

  paymentSection: {
    backgroundColor: C.bgSoft,
    padding: 14,
    borderRadius: 10,
    marginTop: 16,
    gap: 8,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  paymentLabel: {
    color: C.textSub,
    fontSize: 13,
    fontWeight: "600",
  },
  paymentValue: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },

  termsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  termsTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
  },
  termText: {
    color: C.textSub,
    fontSize: 11,
    lineHeight: 18,
    marginBottom: 4,
  },

  invoiceFooter: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    alignItems: "center",
  },
  footerText: {
    color: C.textLight,
    fontSize: 11,
    fontStyle: "italic",
    textAlign: "center",
  },
  footerThank: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
  },

  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 8,
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
