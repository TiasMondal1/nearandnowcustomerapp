import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import {
    Badge,
    Card,
    Divider,
    IconWrap,
    PrimaryButton,
    Screen,
    ScreenHeader,
    Skeleton,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { text } from "../../constants/ui";
import { useCart } from "../../context/CartContext";
import { apiFetch } from "../../lib/apiClient";

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
      const data = await apiFetch<Coupon[]>('/api/coupons/active');
      setCoupons(data || []);
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
    <Screen>
      <ScreenHeader title="Coupons" />

      {loading ? (
        <CouponsSkeleton />
      ) : coupons.length === 0 ? (
        <View style={styles.center}>
          <IconWrap
            size={72}
            circle
            bg={C.bgSoft}
            icon="ticket-percent-outline"
            iconSize={36}
            iconColor={C.textLight}
          />
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
              <Card
                size="lg"
                shadow="card"
                style={[styles.couponCard, applied && styles.couponCardApplied]}
              >
                <View style={styles.couponTop}>
                  <View style={styles.couponTopLeft}>
                    <Badge
                      label={
                        item.discount_type === "flat"
                          ? `₹${item.value} OFF`
                          : `${item.value}% OFF`
                      }
                      bg={applied ? C.primaryLight : C.bgSoft}
                      color={applied ? C.primary : C.text}
                      bordered
                      borderColor={applied ? C.primary : C.border}
                      style={styles.discountPill}
                      textStyle={styles.discountPillText}
                    />
                    <Text style={styles.code} numberOfLines={1}>{item.code}</Text>
                  </View>
                  {applied && (
                    <Badge
                      label="APPLIED"
                      tone="primary"
                      icon="check"
                      iconSize={12}
                      pill
                      bordered
                      borderColor={C.primaryLight}
                      style={styles.appliedBadge}
                      textStyle={styles.appliedText}
                    />
                  )}
                </View>

                <Divider spacing={0} />

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

                <PrimaryButton
                  size="sm"
                  fullWidth
                  variant={applied ? "danger" : "primary"}
                  disabled={disabled && !applied}
                  label={applied ? "Remove" : disabled ? "Not Applicable" : "Apply Coupon"}
                  onPress={() => {
                    if (applied) {
                      removeCoupon();
                    } else {
                      applyCoupon({ ...item, type: item.discount_type });
                      router.back();
                    }
                  }}
                  style={styles.actionBtn}
                  textStyle={styles.actionText}
                />
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

/** Three placeholder cards mirroring the coupon card layout while the list loads. */
function CouponsSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Card key={i} size="lg" style={styles.couponCard}>
          <View style={styles.couponTopLeft}>
            <Skeleton width={72} height={24} radius={8} />
            <Skeleton width="40%" height={18} />
          </View>
          <Divider spacing={0} />
          <Skeleton width="90%" height={13} />
          <Skeleton width="60%" height={13} />
          <Skeleton height={44} radius={12} />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 48 },
  emptyTitle: { ...text.emptyTitle },
  emptyText: { ...text.emptyText },

  list: { padding: 16, paddingBottom: 32, gap: 12 },

  couponCard: { gap: 12 },
  couponCardApplied: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },

  couponTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  couponTopLeft: { flex: 1, flexShrink: 1, gap: 8, marginRight: 10 },
  discountPill: { paddingVertical: 4 },
  discountPillText: { fontFamily: "PlusJakartaSans_800ExtraBold" },
  code: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 18, letterSpacing: 1.5 },

  appliedBadge: { flexShrink: 0 },
  appliedText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 11 },

  desc: { ...text.bodySm },

  minOrderRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  minOrderText: { ...text.rowSubtitle },
  needMore: { fontFamily: "PlusJakartaSans_700Bold",
    color: C.warning,
    fontSize: 12,
    backgroundColor: C.warningLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },

  actionBtn: { height: 44 },
  actionText: { fontFamily: "PlusJakartaSans_800ExtraBold" },
});
