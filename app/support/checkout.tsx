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

import { useAuth } from "../../context/AuthContext";
import { createOrder } from "../../lib/orderService";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";

const BG = "#f9fafb";
const CARD = "#ffffff";
const CARD_SOFT = "#f3f4f6";
const PRIMARY = "#059669";
const SECONDARY = "#047857";
const GREEN = "#10b981";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

type PaymentMode = "upi" | "cod";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart } = useCart();
  const { user, customer } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const { location } = useLocation();

  const [payment, setPayment] = useState<PaymentMode>("upi");

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

  const deliveryFee = 30;

  const projectedAmount = useMemo(
    () => derivedSubtotal + convFee + packagingFee + deliveryFee,
    [derivedSubtotal, convFee, packagingFee],
  );

  const finalPayable = useMemo(
    () => Math.max(projectedAmount - discount, 0),
    [projectedAmount, discount],
  );

  const placeOrder = async () => {
    if (!location) {
      alert("Please select a delivery location");
      return;
    }
    if (items.length === 0) {
      alert("Cart is empty");
      return;
    }
    if (!user?.id) {
      alert("Session expired. Please login again.");
      return;
    }

    try {
      await createOrder({
        user_id: user.id,
        customer_name: user.name || "Customer",
        customer_phone: user.phone || customer?.phone || "",
        customer_email: user.email || undefined,
        payment_method: payment,
        payment_status: "pending",
        subtotal: derivedSubtotal,
        delivery_fee: deliveryFee,
        order_total: finalPayable,
        delivery_address: location.label ?? "",
        delivery_latitude: location.latitude,
        delivery_longitude: location.longitude,
        items: items.map((i) => ({
          product_id: i.product_id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          image: i.image_url,
          unit: i.unit,
        })),
      });

      clearCart();
      setShowSuccess(true);
    } catch (err: any) {
      console.error("PLACE_ORDER_ERROR", err);
      alert(err?.message || "Something went wrong while placing the order.");
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
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

        <TouchableOpacity
          style={styles.couponCard}
          activeOpacity={0.85}
          onPress={() => router.push("../product/coupons")}
        >
          <View style={styles.couponLeft}>
            <MaterialCommunityIcons
              name="ticket-percent-outline"
              size={20}
              color={PRIMARY}
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
              color="#1f2937"
            />
          )}
        </TouchableOpacity>


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
                color: "#1f2937",
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

            <TouchableOpacity
              style={{
                marginTop: 20,
                backgroundColor: PRIMARY,
                paddingVertical: 12,
                paddingHorizontal: 28,
                borderRadius: 12,
              }}
              onPress={() => {
                setShowSuccess(false);

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
        <MaterialCommunityIcons name={icon} size={20} color="#1f2937" />
        <Text style={styles.paymentText}>{label}</Text>
      </View>
      {selected && (
        <MaterialCommunityIcons name="check-circle" size={20} color={GREEN} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  scrollContent: { paddingBottom: 240 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  headerTitle: { color: "#1f2937", fontSize: 18, fontWeight: "700" },

  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  itemImage: { width: 48, height: 48, borderRadius: 8, marginRight: 10 },
  imagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    marginRight: 10,
  },

  itemName: { color: "#1f2937", fontSize: 14, fontWeight: "600" },
  itemMeta: { color: MUTED, fontSize: 12 },
  itemTotal: { color: PRIMARY, fontWeight: "700" },

  couponCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: "#dcfce7",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },

  couponLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  couponText: { color: PRIMARY, fontWeight: "800" },
  removeCoupon: { color: "#ef4444", fontSize: 12, fontWeight: "700" },

  billCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  billLabel: { color: MUTED, fontSize: 14 },
  billValue: { color: "#1f2937", fontSize: 14 },

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

  totalLabel: { color: "#1f2937", fontSize: 16, fontWeight: "800" },
  totalValue: { color: PRIMARY, fontSize: 22, fontWeight: "900" },

  paymentRow: {
    backgroundColor: CARD,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 2,
    borderColor: BORDER,
  },

  paymentActive: { borderColor: PRIMARY, backgroundColor: "#dcfce7" },
  paymentLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  paymentText: { color: "#1f2937", fontSize: 15, fontWeight: "600" },

  slideDock: {
    position: "absolute",
    bottom: 10,
    left: 16,
    right: 16,
    paddingBottom: 30,
  },

  slideHint: {
    color: MUTED,
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
    fontWeight: "600",
  },

  slider: {
    height: 64,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    justifyContent: "center",
    overflow: "hidden",
  },

  sliderThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: SECONDARY,
    justifyContent: "center",
    alignItems: "center",
  },
});
