import { MaterialCommunityIcons } from "@expo/vector-icons";
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

import { getSession } from "../../session";

const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1A1440";
const PRIMARY = "#765fba";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";
const GREEN = "#3CFF8F";
const YELLOW = "#FFD166";

const API_BASE = "http://192.168.1.117:3001";

type Payment = {
  id: string;
  order_code: string;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  placed_at: string;
};

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPayments = async () => {
    try {
      const session = await getSession();
      if (!session?.token) return;

      const res = await fetch(`${API_BASE}/customer/orders`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      const json = await res.json();
      if (!res.ok || !json.success) return;

      // map orders → payments view
      const mapped = (json.orders || []).map((o: any) => ({
        id: o.id,
        order_code: o.order_code,
        total_amount: Number(o.total_amount),
        payment_method: o.payment_method ?? "upi",
        payment_status: o.payment_status ?? "paid",
        placed_at: o.placed_at,
      }));

      setPayments(mapped);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payments</Text>
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPayments();
            }}
            tintColor={PRIMARY}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="credit-card-outline"
              size={56}
              color={MUTED}
            />
            <Text style={styles.emptyText}>No payments yet</Text>
          </View>
        }
        renderItem={({ item }) => <PaymentCard payment={item} />}
      />
    </SafeAreaView>
  );
}

function PaymentCard({ payment }: { payment: Payment }) {
  const paid = payment.payment_status === "paid";

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.card}
      onPress={() => {
        // future: router.push(`/payments/${payment.id}`)
      }}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.orderCode}>Order #{payment.order_code}</Text>

        <View
          style={[styles.badge, { backgroundColor: paid ? GREEN : YELLOW }]}
        >
          <Text style={styles.badgeText}>{paid ? "PAID" : "PENDING"}</Text>
        </View>
      </View>

      <Text style={styles.date}>
        {new Date(payment.placed_at).toLocaleString()}
      </Text>

      <View style={styles.rowBetween}>
        <Text style={styles.method}>
          {payment.payment_method.toUpperCase()}
        </Text>

        <Text style={styles.amount}>₹{payment.total_amount.toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },

  card: {
    backgroundColor: CARD_SOFT,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  orderCode: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },

  date: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },

  method: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  amount: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },

  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#000",
  },

  empty: {
    alignItems: "center",
    marginTop: 80,
  },

  emptyText: {
    color: MUTED,
    fontSize: 13,
    marginTop: 10,
  },
});
