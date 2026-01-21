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
import { useCart } from "../cart/CartContext";


/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1B1542";
const PRIMARY = "#7C6AE6";
const GREEN = "#3CFF8F";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";
const DASH = "#2F2970";

const API_BASE = "http://192.168.1.117:3001";

/* ───────── TYPES ───────── */
type Coupon = {
  id: string;
  code: string;
  description: string;
  discount_type: "flat" | "percent";
  value: number;
  min_order_value?: number;
  expires_at?: string;
};

export default function CouponsScreen() {
  const { appliedCoupon, applyCoupon, removeCoupon, subtotal } = useCart();

  const [loading, setLoading] = useState(true);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  useEffect(() => {
    fetchCoupons();
  }, []);



  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const session = await getSession();
      if (!session?.token) return;

      const res = await fetch(`${API_BASE}/customer/coupons`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });

      const json = await res.json();
      setCoupons(json.coupons || []);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  };

  const isApplicable = (c: Coupon) => {
    if (!c.min_order_value) return true;
    return subtotal >= c.min_order_value;
  };

  

  /* ───────── UI ───────── */

  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color="#fff"
          />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Available Coupons</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* LOADING */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : coupons.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name="ticket-percent-outline"
            size={56}
            color={MUTED}
          />
          <Text style={styles.emptyText}>
            No coupons available right now
          </Text>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 48, paddingTop: 8 }}
          renderItem={({ item }) => {
            const applied = appliedCoupon?.id === item.id;
            const disabled = !isApplicable(item);

            return (
              <View
                style={[
                  styles.couponWrapper,
                  applied && styles.wrapperApplied,
                ]}
              >
                {/* PERFORATION CUTS */}
                <View style={styles.cutLeft} />
                <View style={styles.cutRight} />

                {/* TOP */}
                <View style={styles.topRow}>
                  <Text style={styles.code}>{item.code}</Text>

                  {applied && (
                    <View style={styles.appliedBadge}>
                      <MaterialCommunityIcons
                        name="check-bold"
                        size={12}
                        color="#000"
                      />
                      <Text style={styles.appliedText}>APPLIED</Text>
                    </View>
                  )}
                </View>

                {/* DASH LINE */}
                <View style={styles.dashRow}>
                  <View style={styles.dash} />
                </View>

                {/* DESCRIPTION */}
                <Text style={styles.desc}>{item.description}</Text>

                {/* META */}
                <View style={styles.metaRow}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaStrong}>
                      {item.type === "flat"
                    ? `₹${item.value} OFF`
                    : `${item.value}% OFF`}

                    </Text>
                  </View>

                  {item.min_order_value != null && item.min_order_value > 0 && (
  <Text style={styles.meta}>
    Min order ₹{item.min_order_value}
  </Text>
)}

                </View>

                {/* ACTION */}
                <TouchableOpacity
                  disabled={disabled}
                  style={[
                    styles.actionBtn,
                    applied && styles.removeBtn,
                    disabled && styles.disabledBtn,
                  ]}
                  onPress={() => {
                    if (applied) {
                      removeCoupon();
                    } else {
                      applyCoupon(item);
                      router.back();
                    }
                  }}
                >
                  <Text style={styles.actionText}>
                    {applied
                      ? "Remove Coupon"
                      : disabled
                      ? "Not Applicable"
                      : "Apply Coupon"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  backBtn: {
    height: 36,
    width: 36,
    borderRadius: 12,
    backgroundColor: CARD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.3,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },

  emptyText: {
    color: MUTED,
    fontSize: 14,
  },

  /* ───── COUPON ───── */

  couponWrapper: {
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginBottom: 18,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    position: "relative",
  },

  wrapperApplied: {
    borderColor: GREEN,
    shadowColor: GREEN,
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },

  /* Perforation */
  cutLeft: {
    position: "absolute",
    left: -10,
    top: "50%",
    marginTop: -10,
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: BG,
  },

  cutRight: {
    position: "absolute",
    right: -10,
    top: "50%",
    marginTop: -10,
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: BG,
  },

  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  code: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  appliedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GREEN,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  appliedText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "900",
  },

  dashRow: {
    marginVertical: 14,
  },

  dash: {
    height: 1,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: DASH,
  },

  desc: {
    color: "#C9C3F2",
    fontSize: 13,
    lineHeight: 18,
  },

  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },

  metaPill: {
    backgroundColor: CARD_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },

  metaStrong: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },

  meta: {
    color: MUTED,
    fontSize: 12,
  },

  actionBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 999,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },

  removeBtn: {
    backgroundColor: CARD_SOFT,
  },

  disabledBtn: {
    opacity: 0.4,
  },

  actionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
