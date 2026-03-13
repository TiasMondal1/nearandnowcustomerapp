import { useRazorpay } from "@codearcade/expo-razorpay/src/hooks/useRazorpay";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getProductStoreDistance } from "../../lib/distanceUtils";
import { createOrder } from "../../lib/orderService";
import { createRazorpayOrder } from "../../lib/razorpayService";
import { getAllProducts, type Product } from "../../lib/productService";

type PaymentMode = "upi" | "cod";

const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart } = useCart();
  const { user, customer } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [placing, setPlacing] = useState(false);
  const { location } = useLocation();
  const [maxDistance, setMaxDistance] = useState<number>(2);
  const [loadingDistance, setLoadingDistance] = useState(false);

  const [gstinClaim, setGstinClaim] = useState(false);
  const [gstin, setGstin] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [tipPreset, setTipPreset] = useState<20 | 30 | 50 | "custom" | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [giftPackaging, setGiftPackaging] = useState(false);
  const [orderingForSomeoneElse, setOrderingForSomeoneElse] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [acceptCancellation, setAcceptCancellation] = useState(false);

  const [recommended, setRecommended] = useState<Product[]>([]);
  const [loadingRecommended, setLoadingRecommended] = useState(false);

  const [payment, setPayment] = useState<PaymentMode>("upi");
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();

  useEffect(() => {
    if (!location || items.length === 0) {
      setMaxDistance(2);
      return;
    }

    const calculateMaxDistance = async () => {
      setLoadingDistance(true);
      try {
        const distances = await Promise.all(
          items.map((item) =>
            getProductStoreDistance(
              item.product_id,
              location.latitude,
              location.longitude,
            ),
          ),
        );
        const max = Math.max(...distances);
        setMaxDistance(Math.min(max, 4));
      } catch {
        setMaxDistance(2);
      } finally {
        setLoadingDistance(false);
      }
    };

    calculateMaxDistance();
  }, [location, items]);

  useEffect(() => {
    const loadRecommended = async () => {
      if (!location || items.length === 0) {
        setRecommended([]);
        return;
      }
      try {
        setLoadingRecommended(true);
        const products = await getAllProducts({
          lat: location.latitude,
          lng: location.longitude,
        });
        const cartIds = new Set(items.map((i) => i.product_id));
        const cartCategories = new Set(
          products
            .filter((p) => cartIds.has(p.id))
            .map((p) => p.category)
            .filter(Boolean),
        );
        const recos = products
          .filter((p) => !cartIds.has(p.id))
          .filter((p) => cartCategories.size === 0 || cartCategories.has(p.category))
          .slice(0, 9);
        setRecommended(recos);
      } catch {
        setRecommended([]);
      } finally {
        setLoadingRecommended(false);
      }
    };

    loadRecommended();
  }, [items, location]);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.price * i.quantity, 0),
    [items],
  );
  const totalItems = useMemo(
    () => items.reduce((s, i) => s + i.quantity, 0),
    [items],
  );
  const { platformFee, handlingFee, convFee, deliveryFee, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems, maxDistance),
    [subtotal, totalItems, maxDistance],
  );
  const baseFinalPayable = useMemo(
    () => Math.max(projected - discount, 0),
    [projected, discount],
  );

  const tipAmount = useMemo(() => {
    if (!tipPreset) return 0;
    if (tipPreset === "custom") {
      const val = parseFloat(customTip.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(val) || !Number.isFinite(val)) return 0;
      return Math.max(val, 0);
    }
    return tipPreset;
  }, [tipPreset, customTip]);

  const finalPayable = useMemo(
    () => baseFinalPayable + tipAmount,
    [baseFinalPayable, tipAmount],
  );

  const doCreateOrder = async (paymentStatus: "pending" | "paid") => {
    if (!user?.id || !location) return;
    const notesParts: string[] = [];
    if (gstinClaim && gstin.trim()) {
      notesParts.push(
        `GSTIN: ${gstin.trim()}${
          invoiceName ? ` (Name: ${invoiceName.trim()})` : ""
        }`,
      );
    }
    if (deliveryInstructions.trim()) {
      notesParts.push(`Delivery Instructions: ${deliveryInstructions.trim()}`);
    }
    if (orderingForSomeoneElse) {
      if (recipientName.trim() || recipientPhone.trim()) {
        notesParts.push(
          `Recipient: ${recipientName.trim() || "N/A"}${
            recipientPhone.trim() ? `, Phone: ${recipientPhone.trim()}` : ""
          }`,
        );
      }
    }
    if (tipAmount > 0) {
      notesParts.push(`Tip for delivery partner: ₹${tipAmount.toFixed(2)}`);
    }

    await createOrder({
      user_id: user.id,
      customer_name: user.name || "Customer",
      customer_phone: user.phone || customer?.phone || "",
      customer_email: user.email || undefined,
      payment_method: payment,
      payment_status: paymentStatus,
      subtotal,
      delivery_fee: deliveryFee,
      order_total: finalPayable,
      delivery_address: location.address ?? location.label ?? "",
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
      notes: notesParts.length ? notesParts.join(" | ") : undefined,
      gstin: gstinClaim && gstin.trim() ? gstin.trim() : undefined,
      tip_amount: tipAmount > 0 ? tipAmount : undefined,
    });
    clearCart();
    setShowSuccess(true);
  };

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
    if (!acceptCancellation) {
      Alert.alert(
        "Cancellation policy",
        "Please review and accept the cancellation & policy information before placing your order.",
      );
      return;
    }
    setPlacing(true);
    try {
      if (payment === "cod") {
        await doCreateOrder("pending");
      } else {
        if (!RAZORPAY_KEY) {
          Alert.alert("Payment not configured", "Razorpay keys are missing. Please contact support.");
          Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
          return;
        }
        const amountPaise = Math.round(finalPayable * 100);
        const { order_id } = await createRazorpayOrder(amountPaise);
        closeCheckout?.();
        openCheckout(
          {
            key: RAZORPAY_KEY,
            amount: amountPaise,
            currency: "INR",
            order_id,
            name: "Near & Now",
            description: "Order payment",
            prefill: {
              name: user.name || "Customer",
              email: user.email || "",
              contact: user.phone || customer?.phone || "",
            },
            theme: { color: C.primary },
          },
          {
            onSuccess: async () => {
              closeCheckout?.();
              try {
                await doCreateOrder("paid");
              } catch (err: any) {
                Alert.alert("Order failed", err?.message || "Payment succeeded but order could not be created. Please contact support.");
              } finally {
                setPlacing(false);
              }
            },
            onFailure: (error: { description?: string }) => {
              closeCheckout?.();
              setPlacing(false);
              Alert.alert("Payment failed", error?.description || "Payment could not be completed.");
              Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
            },
            onClose: () => {
              setPlacing(false);
              Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
            },
          },
        );
        return;
      }
    } catch (err: any) {
      console.error("PLACE_ORDER_ERROR", err);
      Alert.alert("Order failed", err?.message || "Something went wrong. Please try again.");
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
    } finally {
      if (payment === "cod") setPlacing(false);
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

        {recommended.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You might also like</Text>
            <View style={styles.recoGrid}>
              {recommended.map((p) => (
                <View key={p.id} style={styles.recoCard}>
                  {p.image_url ? (
                    <Image source={{ uri: p.image_url }} style={styles.recoImage} />
                  ) : (
                    <View style={styles.recoPlaceholder} />
                  )}
                  <Text style={styles.recoName} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Text style={styles.recoPrice}>
                    ₹{p.price} <Text style={styles.recoUnit}>/{p.unit}</Text>
                  </Text>
                  <TouchableOpacity
                    style={styles.recoAddBtn}
                    activeOpacity={0.85}
                    onPress={() =>
                      addItem({
                        product_id: p.id,
                        name: p.name,
                        price: p.price,
                        unit: p.unit,
                        image_url: p.image_url,
                      })
                    }
                  >
                    <Text style={styles.recoAddText}>ADD</Text>
                    <MaterialCommunityIcons
                      name="plus"
                      size={14}
                      color="#fff"
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.couponCard}
          activeOpacity={0.85}
          onPress={() => router.push("../product/coupons")}
        >
          <View style={styles.couponLeft}>
            <MaterialCommunityIcons
              name="ticket-percent-outline"
              size={20}
              color={C.primary}
            />
            <Text style={styles.couponText}>
              {appliedCoupon ? `Applied: ${appliedCoupon.code}` : "Apply Coupon"}
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
              color={C.textSub}
            />
          )}
        </TouchableOpacity>

        <View style={styles.billCard}>
          <Text style={styles.billTitle}>Invoice & Bill Details</Text>
          <BillRow label="Items subtotal" value={subtotal} />
          <BillRow label="Platform fee" value={platformFee} />
          <BillRow label="Handling fee" value={handlingFee} />
          {convFee > 0 && <BillRow label="Convenience fee" value={convFee} />}
          <BillRow
            label={`Delivery fee (${maxDistance.toFixed(1)} km)`}
            value={deliveryFee}
          />
          {appliedCoupon && (
            <BillRow
              label={`Discount (${appliedCoupon.code})`}
              value={-discount}
              highlight
            />
          )}
          {tipAmount > 0 && (
            <BillRow label="Tip for delivery partner" value={tipAmount} />
          )}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <Text style={styles.totalValue}>₹{finalPayable.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Claim GST Input (Optional)</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.toggleRow, gstinClaim && styles.toggleRowActive]}
            onPress={() => setGstinClaim((v) => !v)}
          >
            <View style={styles.toggleLeft}>
              <View style={styles.toggleIconWrap}>
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={18}
                  color={gstinClaim ? "#fff" : C.textSub}
                />
              </View>
              <View>
                <Text
                  style={[
                    styles.toggleTitle,
                    gstinClaim && { color: C.primary },
                  ]}
                >
                  Add GSTIN details for credit claim
                </Text>
                <Text style={styles.toggleSub}>
                  Get a GST-compliant invoice for eligible business purchases.
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.radioOuter,
                gstinClaim && styles.radioOuterActive,
              ]}
            >
              {gstinClaim && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {gstinClaim && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>GSTIN</Text>
              <TextInput
                placeholder="Enter 15-digit GSTIN"
                placeholderTextColor={C.textLight}
                value={gstin}
                onChangeText={setGstin}
                style={styles.textInput}
                autoCapitalize="characters"
              />
              <Text style={styles.fieldLabel}>Registered business name</Text>
              <TextInput
                placeholder="Name as per GST registration"
                placeholderTextColor={C.textLight}
                value={invoiceName}
                onChangeText={setInvoiceName}
                style={styles.textInput}
              />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Instructions</Text>
          <TextInput
            placeholder="e.g. Don't ring the bell, call on arrival, gate code, etc."
            placeholderTextColor={C.textLight}
            value={deliveryInstructions}
            onChangeText={setDeliveryInstructions}
            style={[styles.textInput, styles.multilineInput]}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tip your delivery partner</Text>
          <View style={styles.tipRow}>
            {[20, 30, 50].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.tipChip,
                  tipPreset === val && styles.tipChipActive,
                ]}
                activeOpacity={0.8}
                onPress={() => setTipPreset(tipPreset === val ? null : val)}
              >
                <Text
                  style={[
                    styles.tipChipText,
                    tipPreset === val && styles.tipChipTextActive,
                  ]}
                >
                  ₹{val}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.tipChip,
                tipPreset === "custom" && styles.tipChipActive,
              ]}
              activeOpacity={0.8}
              onPress={() => setTipPreset("custom")}
            >
              <Text
                style={[
                  styles.tipChipText,
                  tipPreset === "custom" && styles.tipChipTextActive,
                ]}
              >
                Custom
              </Text>
            </TouchableOpacity>
          </View>
          {tipPreset === "custom" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Custom tip amount</Text>
              <TextInput
                placeholder="Enter amount in ₹"
                placeholderTextColor={C.textLight}
                keyboardType="numeric"
                value={customTip}
                onChangeText={setCustomTip}
                style={styles.textInput}
              />
            </View>
          )}
          <Text style={styles.tipNote}>
            100% of your tip goes to the delivery partner.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Extras</Text>

          <TouchableOpacity
            style={[
              styles.toggleRow,
              giftPackaging && styles.toggleRowActive,
            ]}
            activeOpacity={0.8}
            onPress={() => setGiftPackaging((v) => !v)}
          >
            <View style={styles.toggleLeft}>
              <View style={styles.toggleIconWrap}>
                <MaterialCommunityIcons
                  name="gift-outline"
                  size={18}
                  color={giftPackaging ? "#fff" : C.textSub}
                />
              </View>
              <View>
                <Text
                  style={[
                    styles.toggleTitle,
                    giftPackaging && { color: C.primary },
                  ]}
                >
                  Gift packaging
                </Text>
                <Text style={styles.toggleSub}>
                  Make it look special. Currently optional and may vary by store.
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.radioOuter,
                giftPackaging && styles.radioOuterActive,
              ]}
            >
              {giftPackaging && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleRow,
              orderingForSomeoneElse && styles.toggleRowActive,
            ]}
            activeOpacity={0.8}
            onPress={() => setOrderingForSomeoneElse((v) => !v)}
          >
            <View style={styles.toggleLeft}>
              <View style={styles.toggleIconWrap}>
                <MaterialCommunityIcons
                  name="account-heart-outline"
                  size={18}
                  color={orderingForSomeoneElse ? "#fff" : C.textSub}
                />
              </View>
              <View>
                <Text
                  style={[
                    styles.toggleTitle,
                    orderingForSomeoneElse && { color: C.primary },
                  ]}
                >
                  Ordering for someone else?
                </Text>
                <Text style={styles.toggleSub}>
                  Add their details so the partner can contact them if needed.
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.radioOuter,
                orderingForSomeoneElse && styles.radioOuterActive,
              ]}
            >
              {orderingForSomeoneElse && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {orderingForSomeoneElse && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Recipient name</Text>
              <TextInput
                placeholder="Who will receive the order?"
                placeholderTextColor={C.textLight}
                value={recipientName}
                onChangeText={setRecipientName}
                style={styles.textInput}
              />
              <Text style={styles.fieldLabel}>Recipient phone</Text>
              <TextInput
                placeholder="10-digit mobile number"
                placeholderTextColor={C.textLight}
                keyboardType="phone-pad"
                value={recipientPhone}
                onChangeText={setRecipientPhone}
                style={styles.textInput}
              />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cancellation & Policies</Text>

          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>Cancellation policy</Text>
            <Text style={styles.policyText}>
              Orders can usually be cancelled before the store accepts them. After
              acceptance, cancellation may not be possible and charges may apply.
            </Text>
          </View>

          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>System policy & FAQs</Text>
            <Text style={styles.policyText}>
              Learn more about refunds, delivery, order issues and more in our
              help section.
            </Text>
            <TouchableOpacity
              style={styles.policyLinkBtn}
              onPress={() => router.push("/settings/support")}
            >
              <Text style={styles.policyLinkText}>View FAQs & Support</Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={16}
                color={C.primary}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.acceptRow,
              acceptCancellation && styles.acceptRowActive,
            ]}
            activeOpacity={0.8}
            onPress={() => setAcceptCancellation((v) => !v)}
          >
            <MaterialCommunityIcons
              name={
                acceptCancellation ? "checkbox-marked" : "checkbox-blank-outline"
              }
              size={20}
              color={acceptCancellation ? C.primary : C.textSub}
            />
            <Text style={styles.acceptText}>
              I’ve reviewed the cancellation policy and FAQs.
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>

          <PaymentOption
            label="Pay via UPI / Card"
            sublabel="Razorpay — UPI, cards & wallets"
            icon="credit-card-outline"
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

      {RazorpayUI}

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

function PaymentOption({
  label,
  sublabel,
  icon,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  sublabel?: string;
  icon: any;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.paymentRow, selected && styles.paymentActive, disabled && styles.paymentDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={styles.paymentLeft}>
        <View style={[styles.paymentIconWrap, selected && styles.paymentIconActive, disabled && styles.paymentIconDisabled]}>
          <MaterialCommunityIcons name={icon} size={20} color={disabled ? C.textLight : selected ? "#fff" : C.textSub} />
        </View>
        <View>
          <Text style={[styles.paymentText, selected && { color: C.primary }, disabled && { color: C.textLight }]}>{label}</Text>
          {sublabel ? <Text style={styles.paymentSublabel}>{sublabel}</Text> : null}
        </View>
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive, disabled && styles.radioDisabled]}>
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

  recoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  recoCard: {
    width: "31%",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  recoImage: {
    width: "100%",
    height: 70,
    borderRadius: 8,
    marginBottom: 6,
  },
  recoPlaceholder: {
    width: "100%",
    height: 70,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    marginBottom: 6,
  },
  recoName: {
    color: C.text,
    fontSize: 11,
    fontWeight: "600",
    minHeight: 28,
  },
  recoPrice: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  recoUnit: {
    color: C.textSub,
    fontSize: 10,
    fontWeight: "500",
  },
  recoAddBtn: {
    marginTop: 6,
    backgroundColor: C.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  recoAddText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

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
  paymentIconDisabled: { backgroundColor: C.bgSoft },
  paymentDisabled: { opacity: 0.5 },
  paymentText: { color: C.text, fontSize: 15, fontWeight: "600" },
  paymentSublabel: { color: C.textLight, fontSize: 11, marginTop: 2 },
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
  radioDisabled: { borderColor: C.border },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  toggleRow: {
    backgroundColor: C.card,
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleRowActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },
  toggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  toggleIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
  },
  toggleSub: {
    color: C.textLight,
    fontSize: 11,
    marginTop: 2,
  },

  fieldGroup: {
    marginTop: 10,
    gap: 6,
  },
  fieldLabel: {
    color: C.textSub,
    fontSize: 12,
    fontWeight: "600",
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },

  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  tipChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  tipChipActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },
  tipChipText: {
    fontSize: 12,
    color: C.textSub,
    fontWeight: "600",
  },
  tipChipTextActive: {
    color: C.primary,
  },
  tipNote: {
    color: C.textLight,
    fontSize: 11,
  },

  policyCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  policyTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  policyText: {
    color: C.textSub,
    fontSize: 12,
    lineHeight: 18,
  },
  policyLinkBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  policyLinkText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  acceptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  acceptRowActive: {},
  acceptText: {
    color: C.textSub,
    fontSize: 12,
    flex: 1,
  },

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
