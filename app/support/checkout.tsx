import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSession } from "../../session";
import { useCart } from "../cart/CartContext";
import { useLocation } from "../location/locationContent";

const API_BASE = "http://192.168.1.117:3001";

/* ───────── COLORS ───────── */
const BG = "#05030A";
const CARD = "#140F2D";
const CARD_SOFT = "#1A1440";
const PRIMARY = "#765fba";
const GREEN = "#3CFF8F";
const MUTED = "#9C94D7";
const BORDER = "#2A2450";

type PaymentMode = "upi" | "cod";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart } = useCart();
  const [showSuccess, setShowSuccess] = useState(false);
  const { location } = useLocation();

  const [payment, setPayment] = useState<PaymentMode>("upi");

  /* ───────── SAME PRICING LOGIC AS cart.tsx ───────── */

  const derivedSubtotal = useMemo(
    () => items.reduce((s, i) => s + i.price * i.quantity, 0),
    [items],
  );

  const convFee = useMemo(() => {
    if (derivedSubtotal <= 0) return 0;
    if (derivedSubtotal < 100) return 60;
    if (derivedSubtotal <= 300) return 30;
    return 0;
  }, [derivedSubtotal]);

  const totalItems = useMemo(
    () => items.reduce((s, i) => s + i.quantity, 0),
    [items],
  );

  const packagingFee = useMemo(() => {
    if (totalItems === 0) return 0;
    return Math.ceil(totalItems / 3) * 5;
  }, [totalItems]);

  const deliveryFee = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      if (!i.store_id || i.distance_km == null) return;
      map.set(i.store_id, i.distance_km);
    });

    let total = 0;
    map.forEach((km) => {
      total += Math.ceil((km * 1000) / 500) * 4;
    });

    return total;
  }, [items]);

  const projectedAmount = useMemo(() => {
    return derivedSubtotal + convFee + packagingFee + deliveryFee;
  }, [derivedSubtotal, convFee, packagingFee, deliveryFee]);

  const finalPayable = useMemo(() => {
    return Math.max(projectedAmount - discount, 0);
  }, [projectedAmount, discount]);

  const storeIds = Array.from(new Set(items.map((i) => i.store_id)));
  const isMultiStore = storeIds.length > 1;

  const ordersPayload = useMemo(() => {
    const grouped: Record<string, typeof items> = {};

    items.forEach((item) => {
      if (!grouped[item.store_id]) grouped[item.store_id] = [];
      grouped[item.store_id].push(item);
    });

    return Object.entries(grouped).map(([store_id, storeItems]) => ({
      store_id,
      items: storeItems.map((i) => ({
        product_id: i.product_id,
        product_name: i.name,
        unit: i.unit ?? null,
        unit_price: i.price,
        quantity: i.quantity,
        image_url: i.image_url ?? null,
      })),
    }));
  }, [items]);

  const hasValidLocation =
    location &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number";

  /* ───────── SLIDE TO PAY ───────── */
  const placeOrder = async () => {
    if (!location) {
      alert("Please select a delivery location");
      return;
    }

    if (items.length === 0) {
      alert("Cart is empty");
      return;
    }

    try {
      // 🔹 Group items by store
      const grouped: Record<string, typeof items> = {};

      items.forEach((item) => {
        if (!grouped[item.store_id]) grouped[item.store_id] = [];
        grouped[item.store_id].push(item);
      });

      const ordersPayload = Object.entries(grouped).map(
        ([store_id, storeItems]) => ({
          store_id,
          items: storeItems.map((i) => ({
            product_id: i.product_id,
            product_name: i.name,
            unit: i.unit ?? null,
            unit_price: i.price,
            quantity: i.quantity,
            image_url: i.image_url ?? null,
          })),
        }),
      );

      // 🔒 HARD SAFETY (UI already blocks this)
      if (ordersPayload.length > 2) {
        alert("You can order from a maximum of 2 stores");
        return;
      }

      const session = await getSession();
      if (!session?.token) {
        alert("Session expired. Please login again.");
        return;
      }

      const res = await fetch(`${API_BASE}/customer/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          payment_method: payment,
          delivery_address: location.label,
          delivery_latitude: location.latitude,
          delivery_longitude: location.longitude,
          notes: null,
          orders: ordersPayload,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        console.error("ORDER_FAILED", json);
        alert("Failed to place order. Please try again.");
        return;
      }

      clearCart();
      setShowSuccess(true);
    } catch (err) {
      console.error("PLACE_ORDER_ERROR", err);
      alert("Something went wrong while placing the order.");
    }
  };

  const slideX = useRef(new Animated.Value(0)).current;
  const SLIDE_WIDTH = 260;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        if (g.dx >= 0 && g.dx <= SLIDE_WIDTH) slideX.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > SLIDE_WIDTH * 0.8) {
          Animated.timing(slideX, {
            toValue: SLIDE_WIDTH,
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            placeOrder();
          });
        } else {
          Animated.spring(slideX, {
            toValue: 0,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ITEMS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>

          {items.map((item) => (
            <View key={item.product_id} style={styles.itemRow}>
              {item.image_url ? (
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.itemImage}
                />
              ) : (
                <View style={styles.imagePlaceholder} />
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.itemMeta}>
                  ₹{item.price} × {item.quantity}
                </Text>
              </View>

              <Text style={styles.itemTotal}>
                ₹{(item.price * item.quantity).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        {/* COUPON */}
        <TouchableOpacity
          style={styles.couponCard}
          activeOpacity={0.85}
          onPress={() => router.push("../product/coupons")}
        >
          <View style={styles.couponLeft}>
            <MaterialCommunityIcons
              name="ticket-percent-outline"
              size={20}
              color="#fff"
            />
            <Text style={styles.couponText}>
              {appliedCoupon
                ? `Coupon Applied: ${appliedCoupon.code}`
                : "View Coupons"}
            </Text>
          </View>

          {appliedCoupon ? (
            <TouchableOpacity onPress={removeCoupon}>
              <Text style={styles.removeCoupon}>Remove</Text>
            </TouchableOpacity>
          ) : (
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#fff"
            />
          )}
        </TouchableOpacity>

        {isMultiStore && (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              backgroundColor: "#1C1636",
              borderWidth: 1,
              borderColor: "#392B6A",
            }}
          >
            <Text style={{ color: "#FFD166", fontSize: 12, fontWeight: "700" }}>
              This order will be split into {storeIds.length} orders
            </Text>
            <Text style={{ color: "#9C94D7", fontSize: 11, marginTop: 4 }}>
              Each store will process and deliver items separately.
            </Text>
          </View>
        )}

        {/* BILL */}
        <View style={styles.billCard}>
          <BillRow label="Items Total" value={derivedSubtotal} />
          {convFee > 0 && <BillRow label="Convenience Fee" value={convFee} />}
          {packagingFee > 0 && (
            <BillRow label="Packaging Fee" value={packagingFee} />
          )}
          {deliveryFee > 0 && (
            <BillRow label="Delivery Fee" value={deliveryFee} />
          )}

          {appliedCoupon && (
            <BillRow
              label={`Discount (${appliedCoupon.code})`}
              value={-discount}
              highlight
            />
          )}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <Text style={styles.totalValue}>₹{finalPayable.toFixed(2)}</Text>
          </View>
        </View>

        {/* PAYMENT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>

          <PaymentOption
            label="Pay via UPI"
            icon="qrcode-scan"
            selected={payment === "upi"}
            onPress={() => setPayment("upi")}
          />

          <PaymentOption
            label="Cash on Delivery"
            icon="cash"
            selected={payment === "cod"}
            onPress={() => setPayment("cod")}
          />
        </View>
      </ScrollView>

      {/* SLIDE TO PAY */}
      <View style={styles.slideDock}>
        <Text style={styles.slideHint}>Slide to Pay</Text>
        <View style={styles.slider}>
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.sliderThumb,
              { transform: [{ translateX: slideX }] },
            ]}
          >
            <MaterialCommunityIcons
              name="chevron-right"
              size={32}
              color="#fff"
            />
          </Animated.View>
        </View>
      </View>

      {showSuccess && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              width: "100%",
              backgroundColor: CARD_SOFT,
              borderRadius: 24,
              padding: 24,
              alignItems: "center",
            }}
          >
            <MaterialCommunityIcons
              name="check-circle"
              size={64}
              color={GREEN}
            />

            <Text
              style={{
                color: "#fff",
                fontSize: 18,
                fontWeight: "900",
                marginTop: 16,
              }}
            >
              Order Placed!
            </Text>

            <Text
              style={{
                color: MUTED,
                fontSize: 13,
                textAlign: "center",
                marginTop: 8,
              }}
            >
              Your order has been sent to the store.
            </Text>

            {isMultiStore && (
              <Text
                style={{
                  color: "#FFD166",
                  fontSize: 12,
                  marginTop: 10,
                  fontWeight: "700",
                }}
              >
                {ordersPayload.length} orders created
              </Text>
            )}

            <TouchableOpacity
              style={{
                marginTop: 20,
                backgroundColor: PRIMARY,
                paddingVertical: 12,
                paddingHorizontal: 28,
                borderRadius: 999,
              }}
              onPress={() => {
                setShowSuccess(false);

                // ⏳ small delay so modal closes smoothly
                setTimeout(() => {
                  router.replace("../(tabs)/orders");
                }, 200);
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "800" }}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ───────── SMALL COMPONENTS ───────── */

function BillRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, highlight && { color: GREEN }]}>
        {label}
      </Text>
      <Text style={[styles.billValue, highlight && { color: GREEN }]}>
        {value < 0 ? `−₹${Math.abs(value)}` : `₹${value}`}
      </Text>
    </View>
  );
}

function PaymentOption({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: any;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.paymentRow, selected && styles.paymentActive]}
      onPress={onPress}
    >
      <View style={styles.paymentLeft}>
        <MaterialCommunityIcons name={icon} size={20} color="#fff" />
        <Text style={styles.paymentText}>{label}</Text>
      </View>
      {selected && (
        <MaterialCommunityIcons name="check-circle" size={20} color={GREEN} />
      )}
    </TouchableOpacity>
  );
}

/* ───────── STYLES ───────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  scrollContent: { paddingBottom: 240 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },

  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },

  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },

  itemImage: { width: 48, height: 48, borderRadius: 10, marginRight: 10 },
  imagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#1f1a3a",
    marginRight: 10,
  },

  itemName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  itemMeta: { color: MUTED, fontSize: 11 },
  itemTotal: { color: "#fff", fontWeight: "700" },

  couponCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  couponLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  couponText: { color: "#fff", fontWeight: "800" },
  removeCoupon: { color: "#FFDADA", fontSize: 12, fontWeight: "700" },

  billCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: CARD_SOFT,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  billLabel: { color: MUTED, fontSize: 13 },
  billValue: { color: "#fff", fontSize: 13 },

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  totalLabel: { color: "#fff", fontSize: 15, fontWeight: "800" },
  totalValue: { color: GREEN, fontSize: 20, fontWeight: "900" },

  paymentRow: {
    backgroundColor: CARD,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },

  paymentActive: { borderColor: GREEN },
  paymentLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  paymentText: { color: "#fff", fontSize: 14 },

  slideDock: {
    position: "absolute",
    bottom: 10,
    left: 16,
    right: 16,
    paddingBottom: 30,
  },

  slideHint: {
    color: MUTED,
    fontSize: 12,
    marginBottom: 6,
    textAlign: "center",
  },

  slider: {
    height: 64,
    backgroundColor: PRIMARY,
    borderRadius: 999,
    justifyContent: "center",
    overflow: "hidden",
  },

  sliderThumb: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#9D89FF",
    justifyContent: "center",
    alignItems: "center",
  },
});
