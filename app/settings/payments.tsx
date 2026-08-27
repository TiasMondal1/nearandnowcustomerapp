import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
    Alert,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { Badge, Card, IconWrap, Screen, ScreenHeader, Skeleton } from "../../components/ui";
import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load previous orders";
      Alert.alert("Previous orders", message);
      setPayments([]);
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
      <Screen>
        <ScreenHeader title="Payments" />
        <PaymentsSkeleton />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Payments" />

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
            <IconWrap
              size={72}
              circle
              bg={C.bgSoft}
              icon="credit-card-outline"
              iconSize={36}
              iconColor={C.textLight}
            />
            <Text style={styles.emptyTitle}>No payments yet</Text>
            <Text style={styles.emptyText}>Your payment history will appear here</Text>
          </View>
        }
        renderItem={({ item }) => <PaymentCard payment={item} />}
      />
    </Screen>
  );
}

/** Four placeholder cards mirroring PaymentCard's geometry while the first fetch is in flight. */
function PaymentsSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} shadow="card" style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.skeletonLines}>
              <Skeleton width="40%" height={15} />
              <Skeleton width="55%" height={12} />
            </View>
            <Skeleton width={60} height={22} radius={999} />
          </View>
          <View style={styles.cardBottom}>
            <Skeleton width="35%" height={13} />
            <Skeleton width="20%" height={17} />
          </View>
        </Card>
      ))}
    </View>
  );
}

function PaymentCard({ payment }: { payment: Payment }) {
  const paid = payment.payment_status === "paid";
  const d = new Date(payment.placed_at);
  const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <Card shadow="card" style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardTopText}>
          <Text style={styles.orderCode} numberOfLines={1} ellipsizeMode="middle">
            #{payment.order_code}
          </Text>
          <Text style={styles.date} numberOfLines={1}>{dateStr}</Text>
        </View>
        <Badge
          label={paid ? "PAID" : "PENDING"}
          bg={paid ? C.successLight : C.warningLight}
          color={paid ? C.success : C.warning}
          pill
          style={styles.badge}
          textStyle={styles.badgeText}
        />
      </View>
      <View style={styles.cardBottom}>
        <View style={styles.methodPill}>
          <MaterialCommunityIcons
            name={payment.payment_method === "cod" ? "cash" : "qrcode-scan"}
            size={14}
            color={C.textSub}
          />
          <Text style={styles.method}>
            {payment.payment_method === "cod" ? "Cash on Delivery" : "UPI"}
          </Text>
        </View>
        <Text style={styles.amount}>₹{payment.total_amount.toFixed(2)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  card: { marginBottom: 12 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  cardTopText: { flex: 1, flexShrink: 1 },
  cardBottom: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },

  orderCode: { ...text.cardTitle },
  date: { ...text.rowSubtitle, marginTop: 4 },

  methodPill: { flexDirection: "row", alignItems: "center", gap: 6 },
  method: { ...text.rowValue },
  amount: { color: C.primary, fontSize: 16, fontFamily: "PlusJakartaSans_800ExtraBold" },

  badge: { paddingVertical: 4, flexShrink: 0 },
  badgeText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 11, letterSpacing: 0.4 },

  skeletonLines: { flex: 1, gap: 6 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 48 },
  emptyTitle: { ...text.emptyTitle },
  emptyText: { ...text.emptyText },
});
