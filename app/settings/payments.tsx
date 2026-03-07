import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { getUserOrders } from "../../lib/orderService";

type Payment = {
  id: string;
  order_code: string;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  placed_at: string;
};

export default function PaymentsScreen() {
  const { userId } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPayments = async () => {
    try {
      if (!userId) return;
      const orders = await getUserOrders(userId);
      const mapped = orders.map((o) => ({
        id: o.id,
        order_code: o.order_number ?? o.id,
        total_amount: o.order_total,
        payment_method: o.payment_method ?? "upi",
        payment_status: o.payment_status ?? "paid",
        placed_at: o.created_at,
      }));
      setPayments(mapped);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [userId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payments</Text>
          <View style={{ width: 38 }} />
        </View>
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payments</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchPayments(); }}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="credit-card-outline" size={56} color={C.textLight} />
            <Text style={styles.emptyTitle}>No payments yet</Text>
            <Text style={styles.emptyText}>Your payment history will appear here</Text>
          </View>
        }
        renderItem={({ item }) => <PaymentCard payment={item} />}
      />
    </SafeAreaView>
  );
}

function PaymentCard({ payment }: { payment: Payment }) {
  const paid = payment.payment_status === "paid";
  const d = new Date(payment.placed_at);
  const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.orderCode}>#{payment.order_code}</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: paid ? C.successLight : C.warningLight }]}>
          <Text style={[styles.badgeText, { color: paid ? C.success : C.warning }]}>
            {paid ? "PAID" : "PENDING"}
          </Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <View style={styles.methodPill}>
          <MaterialCommunityIcons
            name={payment.payment_method === "cod" ? "cash" : "qrcode-scan"}
            size={13}
            color={C.textSub}
          />
          <Text style={styles.method}>
            {payment.payment_method === "cod" ? "Cash on Delivery" : "UPI"}
          </Text>
        </View>
        <Text style={styles.amount}>₹{payment.total_amount.toFixed(2)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "800" },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  cardBottom: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },

  orderCode: { color: C.text, fontWeight: "800", fontSize: 15 },
  date: { color: C.textSub, fontSize: 12, marginTop: 3 },

  methodPill: { flexDirection: "row", alignItems: "center", gap: 5 },
  method: { color: C.textSub, fontSize: 13 },
  amount: { color: C.primary, fontSize: 17, fontWeight: "900" },

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: "800" },

  empty: { alignItems: "center", marginTop: 80, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  emptyText: { color: C.textSub, fontSize: 14 },
});
