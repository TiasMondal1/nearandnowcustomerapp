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

import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { supabaseAdmin } from "../../lib/supabase";

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
      const { data } = await supabaseAdmin
        .from('coupons')
        .select('id, code, description, discount_type, value, min_order_value, expires_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      setCoupons((data as Coupon[]) || []);
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coupons</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : coupons.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="ticket-percent-outline" size={56} color={C.textLight} />
          <Text style={styles.emptyTitle}>No coupons available</Text>
          <Text style={styles.emptyText}>Check back later for offers</Text>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const applied = appliedCoupon?.id === item.id;
            const disabled = !isApplicable(item);

            return (
              <View style={[styles.couponCard, applied && styles.couponCardApplied]}>
                <View style={styles.couponTop}>
                  <View style={styles.couponTopLeft}>
                    <View style={[styles.discountPill, applied && styles.discountPillApplied]}>
                      <Text style={[styles.discountPillText, applied && { color: C.primary }]}>
                        {item.discount_type === "flat"
                          ? `₹${item.value} OFF`
                          : `${item.value}% OFF`}
                      </Text>
                    </View>
                    <Text style={styles.code}>{item.code}</Text>
                  </View>
                  {applied && (
                    <View style={styles.appliedBadge}>
                      <MaterialCommunityIcons name="check" size={12} color={C.primary} />
                      <Text style={styles.appliedText}>APPLIED</Text>
                    </View>
                  )}
                </View>

                <View style={styles.divider} />

                <Text style={styles.desc}>{item.description}</Text>

                {item.min_order_value != null && item.min_order_value > 0 && (
                  <View style={styles.minOrderRow}>
                    <MaterialCommunityIcons name="cart-outline" size={13} color={C.textLight} />
                    <Text style={styles.minOrderText}>Min order ₹{item.min_order_value}</Text>
                    {disabled && !applied && (
                      <Text style={styles.needMore}>
                        Add ₹{(item.min_order_value - subtotal).toFixed(0)} more
                      </Text>
                    )}
                  </View>
                )}

                <TouchableOpacity
                  disabled={disabled && !applied}
                  style={[
                    styles.actionBtn,
                    applied && styles.removeBtnStyle,
                    disabled && !applied && styles.disabledBtn,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (applied) {
                      removeCoupon();
                    } else {
                      applyCoupon({ ...item, type: item.discount_type });
                      router.back();
                    }
                  }}
                >
                  <Text style={[styles.actionText, applied && { color: C.danger }]}>
                    {applied ? "Remove" : disabled ? "Not Applicable" : "Apply Coupon"}
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
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  emptyText: { color: C.textSub, fontSize: 14 },

  list: { padding: 16, gap: 12 },

  couponCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: 10,
  },
  couponCardApplied: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },

  couponTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  couponTopLeft: { gap: 6 },
  discountPill: {
    alignSelf: "flex-start",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  discountPillApplied: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  discountPillText: { color: C.text, fontSize: 12, fontWeight: "800" },
  code: { color: C.text, fontSize: 18, fontWeight: "900", letterSpacing: 1.5 },

  appliedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.primaryXLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  appliedText: { color: C.primary, fontSize: 11, fontWeight: "800" },

  divider: { height: 1, backgroundColor: C.border },

  desc: { color: C.textSub, fontSize: 13, lineHeight: 19 },

  minOrderRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  minOrderText: { color: C.textSub, fontSize: 12 },
  needMore: {
    color: C.warning,
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: C.warningLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },

  actionBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnStyle: {
    backgroundColor: C.dangerLight,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  disabledBtn: { opacity: 0.45 },
  actionText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
