import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSession } from "../../session";

const API_BASE = "http://192.168.1.117:3001";

/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#140F2D";
const BORDER = "#2A2450";
const MUTED = "#9C94D7";
const GREEN = "#3CFF8F";
const YELLOW = "#FFD166";
const RED = "#E54848";

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_store: { label: "Pending store", color: YELLOW },
  accepted_store: { label: "Accepted", color: YELLOW },
  awaiting_assignment: { label: "Finding rider", color: YELLOW },
  rider_assigned: { label: "Rider assigned", color: GREEN },
  en_route_delivery: { label: "En route", color: GREEN },
  completed: { label: "Delivered", color: GREEN },
  rejected_store: { label: "Rejected", color: RED },
};

export default function OrdersScreen() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const session = await getSession();
      if (!session?.token) return;

      const res = await fetch(`${API_BASE}/customer/orders`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      const json = await res.json();
      if (json.success) {
        setOrders(json.orders || []);
      }
    } catch (err) {
      console.error("FETCH_ORDERS_FAILED", err);
    } finally {
      setLoading(false);
    }
  };

  const renderOrder = ({ item }: { item: any }) => {
    const meta = STATUS_META[item.status] || {
      label: item.status,
      color: MUTED,
    };

    return (
      <View style={styles.card}>
        {/* HEADER */}
        <View style={styles.cardHeader}>
          <Text style={styles.orderCode}>
            Order #{item.order_code || item.id.slice(0, 6)}
          </Text>

          <View style={[styles.statusPill, { borderColor: meta.color }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>
        </View>

        {/* ITEMS */}
        {item.order_items?.map((it: any, idx: number) => (
          <Text key={idx} style={styles.itemRow}>
            {it.product_name} × {it.quantity}
          </Text>
        ))}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.total}>
            ₹{Number(item.total_amount).toFixed(2)}
          </Text>

          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/product/[id]",
                params: { id: item.id },
              })
            }
          >
            <Text style={styles.track}>Track</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Orders</Text>
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={GREEN}
          style={{ marginTop: 40 }}
        />
      ) : orders.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="receipt-text-outline"
            size={48}
            color={MUTED}
          />
          <Text style={styles.emptyText}>No orders yet</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={renderOrder}
        />
      )}
    </SafeAreaView>
  );
}

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    padding: 16,
  },

  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },

  card: {
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },

  orderCode: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },

  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },

  itemRow: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  footer: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  total: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  track: {
    color: "#765fba",
    fontWeight: "800",
  },

  empty: {
    marginTop: 80,
    alignItems: "center",
  },

  emptyText: {
    marginTop: 10,
    color: MUTED,
    fontSize: 13,
  },
});
