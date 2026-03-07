import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
    Alert,
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

import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { createOrder } from "../../lib/orderService";

type PaymentMode = "upi" | "cod";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart } = useCart();
  const { user, customer } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [placing, setPlacing] = useState(false);
  const { location } = useLocation();

  const [payment, setPayment] = useState<PaymentMode>("upi");

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.price * i.quantity, 0),
    [items],
  );
  const totalItems = useMemo(
    () => items.reduce((s, i) => s + i.quantity, 0),
    [items],
  );
  const { convFee, packagingFee, deliveryFee, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems),
    [subtotal, totalItems],
  );
  const finalPayable = useMemo(
    () => Math.max(projected - discount, 0),
    [projected, discount],
  );

  const placeOrder = async () => {
    if (!location) {
      Alert.alert("No location", "Please select a delivery location.");
      return;
    }
    if (items.length === 0) {
      Alert.alert("Empty cart", "Add items to your cart before checking out.");
      return;
    }
    if (!user?.id) {
      Alert.alert("Session expired", "Please login again.");
      return;
    }
    setPlacing(true);
    try {
      await createOrder({
        user_id: user.id,
        customer_name: user.name || "Customer",
        customer_phone: user.phone || customer?.phone || "",
        customer_email: user.email || undefined,
        payment_method: payment,
        payment_status: "pending",
        subtotal,
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
      Alert.alert("Order failed", err?.message || "Something went wrong. Please try again.");
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
    } finally {
      setPlacing(false);
    }
  };

  const slideX = useRef(new Animated.Value(0)).current;
  const SLIDE_WIDTH = 260;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => !placing,
      onPanResponderMove: (_, g) => {
        if (!placing && g.dx >= 0 && g.dx <= SLIDE_WIDTH) slideX.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (placing) return;
        if (g.dx > SLIDE_WIDTH * 0.8) {
          Animated.timing(slideX, {
            toValue: SLIDE_WIDTH,
            duration: 200,
            useNativeDriver: false,
          }).start(() => placeOrder());
        } else {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
        }
      },
    }),
  ).current;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Location</Text>
          <TouchableOpacity
            style={styles.locationCard}
            onPress={() => router.push("/location")}
            activeOpacity={0.7}
          >
            <View style={styles.locationIconWrap}>
              <MaterialCommunityIcons name="map-marker" size={24} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {location ? (
                <>
                  <Text style={styles.locationLabel}>{location.label || "Delivery Address"}</Text>
                  <Text style={styles.locationAddress} numberOfLines={2}>
                    {location.address || "No address details"}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.locationLabel}>No location selected</Text>
                  <Text style={styles.locationAddress}>Tap to select delivery address</Text>
                </>
              )}
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={C.textSub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addAddressBtn}
            onPress={() => router.push("/location/add")}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={18} color={C.primary} />
            <Text style={styles.addAddressText}>Add new address</Text>
          </TouchableOpacity>
        </View>

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
            <MaterialCommunityIcons name="ticket-percent-outline" size={20} color={C.primary} />
            <Text style={styles.couponText}>
              {appliedCoupon ? `Applied: ${appliedCoupon.code}` : "Apply Coupon"}
            </Text>
          </View>
          {appliedCoupon ? (
            <TouchableOpacity onPress={removeCoupon}>
              <Text style={styles.removeCoupon}>Remove</Text>
            </TouchableOpacity>
          ) : (
            <MaterialCommunityIcons name="chevron-right" size={20} color={C.textSub} />
          )}
        </TouchableOpacity>

        <View style={styles.billCard}>
          <Text style={styles.billTitle}>Bill Details</Text>
          <BillRow label="Items subtotal" value={subtotal} />
          {convFee > 0 && <BillRow label="Convenience fee" value={convFee} />}
          {packagingFee > 0 && <BillRow label="Packaging fee" value={packagingFee} />}
          <BillRow label="Delivery fee" value={deliveryFee} />
          {appliedCoupon && (
            <BillRow label={`Discount (${appliedCoupon.code})`} value={-discount} highlight />
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
        {location && (
          <View style={styles.deliveryInfo}>
            <MaterialCommunityIcons name="map-marker" size={14} color={C.primary} />
            <Text style={styles.deliveryText} numberOfLines={1}>{location.label}</Text>
          </View>
        )}
        <Text style={styles.slideHint}>
          {placing ? "Placing your order…" : "Slide to confirm & pay"}
        </Text>
        <View style={[styles.slider, placing && styles.sliderPlacing]}>
          <Animated.View
            {...panResponder.panHandlers}
            style={[styles.sliderThumb, { transform: [{ translateX: slideX }] }]}
          >
            {placing ? (
              <MaterialCommunityIcons name="loading" size={28} color="#fff" />
            ) : (
              <MaterialCommunityIcons name="chevron-double-right" size={28} color="#fff" />
            )}
          </Animated.View>
          {!placing && (
            <Text style={styles.sliderLabel}>₹{finalPayable.toFixed(0)}</Text>
          )}
        </View>
      </View>

      {showSuccess && (
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={56} color={C.success} />
            </View>
            <Text style={styles.successTitle}>Order Placed!</Text>
            <Text style={styles.successSub}>Your order has been sent to the store. We'll notify you when it's accepted.</Text>
            <TouchableOpacity
              style={styles.successBtn}
              onPress={() => {
                setShowSuccess(false);
                setTimeout(() => router.replace("../(tabs)/orders"), 200);
              }}
            >
              <Text style={styles.successBtnText}>Track Order</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function BillRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, highlight && { color: C.success }]}>{label}</Text>
      <Text style={[styles.billValue, highlight && { color: C.success }]}>
        {value < 0 ? `−₹${Math.abs(value).toFixed(2)}` : `₹${value.toFixed(2)}`}
      </Text>
    </View>
  );
}

function PaymentOption({ label, icon, selected, onPress }: { label: string; icon: any; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.paymentRow, selected && styles.paymentActive]} onPress={onPress}>
      <View style={styles.paymentLeft}>
        <View style={[styles.paymentIconWrap, selected && styles.paymentIconActive]}>
          <MaterialCommunityIcons name={icon} size={20} color={selected ? "#fff" : C.textSub} />
        </View>
        <Text style={[styles.paymentText, selected && { color: C.primary }]}>{label}</Text>
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected && <View style={styles.radioInner} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 180 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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

  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginBottom: 12 },

  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    gap: 12,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  locationIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  locationLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: 13,
    color: C.textSub,
    lineHeight: 18,
  },
  addAddressBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    borderStyle: "dashed",
  },
  addAddressText: {
    fontSize: 14,
    fontWeight: "700",
    color: C.primary,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  itemImage: { width: 48, height: 48, borderRadius: 8, marginRight: 10 },
  imagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    marginRight: 10,
  },
  itemName: { color: C.text, fontSize: 14, fontWeight: "600" },
  itemMeta: { color: C.textSub, fontSize: 12, marginTop: 2 },
  itemTotal: { color: C.primary, fontWeight: "700", fontSize: 14 },

  couponCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: C.primaryXLight,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.primaryLight,
  },
  couponLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  couponText: { color: C.primary, fontWeight: "700", fontSize: 14 },
  removeCoupon: { color: C.danger, fontSize: 12, fontWeight: "700" },

  billCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  billTitle: { color: C.text, fontSize: 14, fontWeight: "800", marginBottom: 14 },
  billRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  billLabel: { color: C.textSub, fontSize: 14 },
  billValue: { color: C.text, fontSize: 14, fontWeight: "500" },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { color: C.text, fontSize: 16, fontWeight: "800" },
  totalValue: { color: C.primary, fontSize: 22, fontWeight: "900" },

  paymentRow: {
    backgroundColor: C.card,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
  },
  paymentActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  paymentLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  paymentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentIconActive: { backgroundColor: C.primary },
  paymentText: { color: C.text, fontSize: 15, fontWeight: "600" },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: { borderColor: C.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  slideDock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 10,
  },
  deliveryInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
    display: "none",
  },
  deliveryText: { color: C.textSub, fontSize: 13, flex: 1 },
  slideHint: {
    color: C.textSub,
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
    fontWeight: "600",
  },
  slider: {
    height: 60,
    backgroundColor: C.primary,
    borderRadius: 16,
    justifyContent: "center",
    overflow: "hidden",
  },
  sliderPlacing: { opacity: 0.7 },
  sliderThumb: {
    width: 60,
    height: 60,
    borderRadius: 13,
    backgroundColor: C.primaryDark,
    justifyContent: "center",
    alignItems: "center",
  },
  sliderLabel: {
    position: "absolute",
    right: 20,
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
    fontWeight: "800",
  },

  successOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  successCard: {
    width: "100%",
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 8,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.successLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  successSub: { color: C.textSub, fontSize: 14, textAlign: "center", lineHeight: 20 },
  successBtn: {
    marginTop: 12,
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 14,
  },
  successBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
