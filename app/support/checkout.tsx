import { useRazorpay } from "@codearcade/expo-razorpay";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
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
import { getAllProducts, type Product } from "../../lib/productService";
import { createRazorpayOrder } from "../../lib/razorpayService";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type PaymentMode = "upi" | "cod";

const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart, addItem, updateQty } = useCart();
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

  // "Ordering for someone else" — toggle + expandable details
  const [orderingForSomeoneElse, setOrderingForSomeoneElse] = useState(false);
  const [showRecipientDetails, setShowRecipientDetails] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientLocation, setRecipientLocation] = useState("");

  const [acceptCancellation, setAcceptCancellation] = useState(false);
  const [recommended, setRecommended] = useState<Product[]>([]);
  const [loadingRecommended, setLoadingRecommended] = useState(false);
  const [payment, setPayment] = useState<PaymentMode>("upi");
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();

  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (showSuccess) {
      Animated.spring(successAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 8,
      }).start();
    } else {
      successAnim.setValue(0);
    }
  }, [showSuccess]);

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
            getProductStoreDistance(item.product_id, location.latitude, location.longitude),
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

        // Get all available products
        const allProducts = await getAllProducts({ lat: location.latitude, lng: location.longitude });
        const cartIds = new Set(items.map((i) => i.product_id));

        // Get cart products with their details
        const cartProducts = allProducts.filter((p) => cartIds.has(p.id));

        // Extract categories from cart items, weighted by quantity
        const categoryWeights = new Map<string, number>();
        cartProducts.forEach((product) => {
          const cartItem = items.find((i) => i.product_id === product.id);
          const weight = cartItem ? cartItem.quantity : 1;
          if (product.category) {
            categoryWeights.set(product.category, (categoryWeights.get(product.category) || 0) + weight);
          }
        });

        // Sort categories by weight (most frequently purchased)
        const sortedCategories = Array.from(categoryWeights.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([category]) => category);

        // Get products not in cart
        const availableProducts = allProducts.filter((p) => !cartIds.has(p.id));

        // Score products based on:
        // 1. Same category as cart items (higher score for categories with more weight)
        // 2. Similar price range to cart items
        // 3. In stock
        // 4. Good ratings
        const cartAvgPrice = cartProducts.length > 0
          ? cartProducts.reduce((sum, p) => {
              const cartItem = items.find((i) => i.product_id === p.id);
              const quantity = cartItem ? cartItem.quantity : 1;
              return sum + (p.price * quantity);
            }, 0) / items.reduce((sum, i) => sum + i.quantity, 0)
          : 0;

        const scoredProducts = availableProducts
          .filter((p) => p.in_stock)
          .map((product) => {
            let score = 0;

            // Category matching (highest priority)
            if (product.category && sortedCategories.includes(product.category)) {
              const categoryIndex = sortedCategories.indexOf(product.category);
              const categoryWeight = categoryWeights.get(product.category) || 0;
              score += (sortedCategories.length - categoryIndex) * 10 + categoryWeight * 2;
            }

            // Price similarity (moderate priority)
            if (cartAvgPrice > 0) {
              const priceDiff = Math.abs(product.price - cartAvgPrice);
              const priceSimilarity = Math.max(0, 1 - priceDiff / cartAvgPrice);
              score += priceSimilarity * 5;
            }

            // Rating bonus (low priority)
            if (product.avgRating) {
              score += product.avgRating * 2;
            }

            // Review count bonus
            if (product.reviewCount) {
              score += Math.min(product.reviewCount / 10, 3);
            }

            return { product, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 9)
          .map(({ product }) => product);

        setRecommended(scoredProducts);
      } catch {
        setRecommended([]);
      } finally {
        setLoadingRecommended(false);
      }
    };
    loadRecommended();
  }, [items, location]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const totalItems = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const { platformFee, handlingFee, convFee, deliveryFee, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems, maxDistance),
    [subtotal, totalItems, maxDistance],
  );
  const baseFinalPayable = useMemo(() => Math.max(projected - discount, 0), [projected, discount]);

  const tipAmount = useMemo(() => {
    if (!tipPreset) return 0;
    if (tipPreset === "custom") {
      const val = parseFloat(customTip.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(val) || !Number.isFinite(val)) return 0;
      return Math.max(val, 0);
    }
    return tipPreset;
  }, [tipPreset, customTip]);

  const finalPayable = useMemo(() => baseFinalPayable + tipAmount, [baseFinalPayable, tipAmount]);

  const toggleRecipientDetails = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowRecipientDetails((v) => !v);
  };

  const toggleOrderingForSomeoneElse = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !orderingForSomeoneElse;
    setOrderingForSomeoneElse(next);
    if (!next) {
      setShowRecipientDetails(false);
      setRecipientName("");
      setRecipientPhone("");
      setRecipientLocation("");
    }
  };

  const doCreateOrder = async (paymentStatus: "pending" | "paid") => {
    if (!user?.id || !location) return;
    const notesParts: string[] = [];
    if (gstinClaim && gstin.trim()) {
      notesParts.push(
        `GSTIN: ${gstin.trim()}${invoiceName ? ` (Name: ${invoiceName.trim()})` : ""}`,
      );
    }
    if (deliveryInstructions.trim()) {
      notesParts.push(`Delivery Instructions: ${deliveryInstructions.trim()}`);
    }
    if (orderingForSomeoneElse) {
      const parts = [];
      if (recipientName.trim()) parts.push(`Name: ${recipientName.trim()}`);
      if (recipientPhone.trim()) parts.push(`Phone: ${recipientPhone.trim()}`);
      if (recipientLocation.trim()) parts.push(`Location: ${recipientLocation.trim()}`);
      if (parts.length) notesParts.push(`Recipient — ${parts.join(", ")}`);
    }
    if (tipAmount > 0) notesParts.push(`Tip for delivery partner: ₹${tipAmount.toFixed(2)}`);

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
    if (orderingForSomeoneElse) {
      if (!recipientName.trim()) {
        Alert.alert("Recipient name required", "Please enter the name of the person you're ordering for.");
        return;
      }
      if (recipientPhone.length !== 10) {
        Alert.alert("Recipient phone required", "Please enter a valid 10-digit mobile number for the recipient.");
        return;
      }
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
          setPlacing(false);
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
                Alert.alert(
                  "Order failed",
                  err?.message || "Payment succeeded but order could not be created. Please contact support.",
                );
              } finally {
                setPlacing(false);
              }
            },
            onFailure: (error: { description?: string }) => {
              closeCheckout?.();
              setPlacing(false);
              Alert.alert("Payment failed", error?.description || "Payment could not be completed.");
            },
            onClose: () => {
              setPlacing(false);
            },
          },
        );
        return;
      }
    } catch (err: any) {
      console.error("PLACE_ORDER_ERROR", err);
      Alert.alert("Order failed", err?.message || "Something went wrong. Please try again.");
    } finally {
      if (payment === "cod") setPlacing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Checkout</Text>
          <Text style={styles.headerSub}>{totalItems} item{totalItems !== 1 ? "s" : ""}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── You May Also Like ─── */}
        {recommended.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="You may also like" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recoScroll}>
              {recommended.map((p) => (
                <View key={p.id} style={styles.recoCard}>
                  {p.image_url ? (
                    <Image source={{ uri: p.image_url }} style={styles.recoImage} />
                  ) : (
                    <View style={styles.recoPlaceholder}>
                      <MaterialCommunityIcons name="image-outline" size={22} color={C.border} />
                    </View>
                  )}
                  <Text style={styles.recoName} numberOfLines={2}>{p.name}</Text>
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
                    <MaterialCommunityIcons name="plus" size={14} color="#fff" />
                    <Text style={styles.recoAddText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ─── Delivery Location ─── */}
        <View style={styles.section}>
          <SectionHeader title="Delivery Location" />
          <TouchableOpacity style={styles.locationCard} onPress={() => router.push("/location")} activeOpacity={0.7}>
            <View style={styles.locationIconWrap}>
              <MaterialCommunityIcons name="map-marker" size={22} color={C.primary} />
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
                  <Text style={[styles.locationLabel, { color: C.textSub }]}>No location selected</Text>
                  <Text style={styles.locationAddress}>Tap to select delivery address</Text>
                </>
              )}
            </View>
            <View style={styles.locationChevron}>
              <MaterialCommunityIcons name="pencil-outline" size={16} color={C.primary} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addAddressBtn}
            onPress={() => router.push("/location/add")}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={16} color={C.primary} />
            <Text style={styles.addAddressText}>Add new address</Text>
          </TouchableOpacity>
        </View>

        {/* ─── Items ─── */}
        <View style={styles.section}>
          <SectionHeader title="Your Items" />
          <View style={styles.itemsCard}>
            {items.map((item, idx) => (
              <View key={item.product_id}>
                <View style={styles.itemRow}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.itemImage} />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <MaterialCommunityIcons name="leaf" size={20} color={C.border} />
                    </View>
                  )}
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.itemMeta}>
                      ₹{item.price} {item.unit}
                    </Text>
                  </View>
                  <View style={styles.quantityControls}>
                    <TouchableOpacity
                      style={styles.quantityBtn}
                      onPress={() => updateQty(item.product_id, item.quantity - 1)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="minus" size={16} color={C.primary} />
                    </TouchableOpacity>
                    <Text style={styles.quantityText}>{item.quantity}</Text>
                    <TouchableOpacity
                      style={styles.quantityBtn}
                      onPress={() => updateQty(item.product_id, item.quantity + 1)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color={C.primary} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(0)}</Text>
                </View>
                {idx < items.length - 1 && <View style={styles.itemDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* ─── Coupon ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.couponCard}
            activeOpacity={0.85}
            onPress={() => router.push("../product/coupons")}
          >
            <View style={styles.couponLeft}>
              <View style={styles.couponIconWrap}>
                <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={C.primary} />
              </View>
              <View>
                <Text style={styles.couponText}>
                  {appliedCoupon ? `${appliedCoupon.code} applied` : "Apply Coupon"}
                </Text>
                {appliedCoupon && (
                  <Text style={styles.couponSavings}>−₹{discount.toFixed(0)} saved</Text>
                )}
              </View>
            </View>
            {appliedCoupon ? (
              <TouchableOpacity
                style={styles.removeCouponBtn}
                onPress={(e) => { e.stopPropagation(); removeCoupon(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeCoupon}>Remove</Text>
              </TouchableOpacity>
            ) : (
              <MaterialCommunityIcons name="chevron-right" size={18} color={C.primary} />
            )}
          </TouchableOpacity>
        </View>

        {/* ─── Bill Details ─── */}
        <View style={styles.section}>
          <SectionHeader title="Bill Details" />
          <View style={styles.billCard}>
            <BillRow label="Items subtotal" value={subtotal} />
            <BillRow label="Platform fee" value={platformFee} />
            <BillRow label="Handling fee" value={handlingFee} />
            {convFee > 0 && <BillRow label="Convenience fee" value={convFee} />}
            <BillRow label={`Delivery fee (${maxDistance.toFixed(1)} km)`} value={deliveryFee} />
            {appliedCoupon && (
              <BillRow label={`Discount (${appliedCoupon.code})`} value={-discount} highlight />
            )}
            {tipAmount > 0 && <BillRow label="Tip for delivery partner" value={tipAmount} />}
            <View style={styles.billDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Payable</Text>
              <Text style={styles.totalValue}>₹{finalPayable.toFixed(0)}</Text>
            </View>
          </View>
        </View>

        {/* ─── Delivery Instructions ─── */}
        <View style={styles.section}>
          <SectionHeader title="Delivery Instructions" optional />
          <TextInput
            placeholder="e.g. Don't ring the bell, call on arrival, gate code…"
            placeholderTextColor={C.textLight}
            value={deliveryInstructions}
            onChangeText={setDeliveryInstructions}
            style={[styles.textInput, styles.multilineInput]}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* ─── Tip ─── */}
        <View style={styles.section}>
          <SectionHeader title="Tip Your Delivery Partner" optional />
          <View style={styles.tipRow}>
            {([20, 30, 50] as const).map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.tipChip, tipPreset === val && styles.tipChipActive]}
                activeOpacity={0.8}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setTipPreset(tipPreset === val ? null : val);
                }}
              >
                <Text style={[styles.tipChipText, tipPreset === val && styles.tipChipTextActive]}>
                  ₹{val}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.tipChip, tipPreset === "custom" && styles.tipChipActive]}
              activeOpacity={0.8}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setTipPreset("custom");
              }}
            >
              <Text style={[styles.tipChipText, tipPreset === "custom" && styles.tipChipTextActive]}>
                Custom
              </Text>
            </TouchableOpacity>
          </View>
          {tipPreset === "custom" && (
            <TextInput
              placeholder="Enter tip amount in ₹"
              placeholderTextColor={C.textLight}
              keyboardType="numeric"
              value={customTip}
              onChangeText={setCustomTip}
              style={[styles.textInput, { marginTop: 8 }]}
            />
          )}
          <Text style={styles.tipNote}>100% of your tip goes directly to delivery partner</Text>
        </View>

        {/* ─── Ordering for Someone Else ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.someoneElseToggle, orderingForSomeoneElse && styles.someoneElseToggleActive]}
            onPress={toggleOrderingForSomeoneElse}
            activeOpacity={0.8}
          >
            <View style={[styles.someoneElseIconWrap, orderingForSomeoneElse && styles.someoneElseIconActive]}>
              <MaterialCommunityIcons
                name="account-heart-outline"
                size={18}
                color={orderingForSomeoneElse ? "#fff" : C.textSub}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.someoneElseLabel, orderingForSomeoneElse && styles.someoneElseLabelActive]}>
                Ordering for someone else?
              </Text>
              <Text style={styles.someoneElseSublabel}>
                Add recipient details for the delivery partner
              </Text>
            </View>
            <View style={[styles.someoneElseSwitch, orderingForSomeoneElse && styles.someoneElseSwitchActive]}>
              <View style={[styles.someoneElseSwitchKnob, orderingForSomeoneElse && styles.someoneElseSwitchKnobActive]} />
            </View>
          </TouchableOpacity>

          {orderingForSomeoneElse && (
            <View style={styles.recipientBox}>
              <View style={styles.recipientBoxHeader}>
                <MaterialCommunityIcons name="gift-outline" size={15} color={C.primary} />
                <Text style={styles.recipientBoxTitle}>Recipient Details</Text>
                <Text style={styles.recipientBoxNote}>Shared with delivery partner</Text>
              </View>

              <View style={styles.recipientFieldRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <View style={styles.inputIconRow}>
                    <MaterialCommunityIcons name="account-outline" size={14} color={C.textSub} />
                    <Text style={styles.fieldLabel}>Name <Text style={{ color: C.error ?? "#e53e3e" }}>*</Text></Text>
                  </View>
                  <TextInput
                    placeholder="Recipient's full name"
                    placeholderTextColor={C.textLight}
                    value={recipientName}
                    onChangeText={setRecipientName}
                    style={[styles.textInput, recipientName.trim().length > 0 && styles.textInputFilled]}
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.inputIconRow}>
                  <MaterialCommunityIcons name="phone-outline" size={14} color={C.textSub} />
                  <Text style={styles.fieldLabel}>Phone <Text style={{ color: C.error ?? "#e53e3e" }}>*</Text></Text>
                </View>
                <View style={styles.phoneInputRow}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>🇮🇳 +91</Text>
                  </View>
                  <TextInput
                    placeholder="10-digit mobile number"
                    placeholderTextColor={C.textLight}
                    keyboardType="phone-pad"
                    value={recipientPhone}
                    onChangeText={(t) => setRecipientPhone(t.replace(/[^0-9]/g, ""))}
                    style={[styles.textInput, styles.phoneInputField, recipientPhone.length === 10 && styles.textInputFilled]}
                    maxLength={10}
                    returnKeyType="next"
                  />
                </View>
                {recipientPhone.length > 0 && recipientPhone.length < 10 && (
                  <Text style={styles.fieldHint}>
                    <MaterialCommunityIcons name="information-outline" size={11} color={C.textLight} />
                    {" "}{10 - recipientPhone.length} more digits needed
                  </Text>
                )}
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.inputIconRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={C.textSub} />
                  <Text style={styles.fieldLabel}>Delivery note for recipient</Text>
                  <Text style={styles.optionalTag}>Optional</Text>
                </View>
                <TextInput
                  placeholder="e.g. Ring bell twice, call on arrival, 3rd floor…"
                  placeholderTextColor={C.textLight}
                  value={recipientLocation}
                  onChangeText={setRecipientLocation}
                  style={[styles.textInput, styles.multilineInput, recipientLocation.trim().length > 0 && styles.textInputFilled]}
                  multiline
                  numberOfLines={2}
                />
              </View>

              {(recipientName.trim() || recipientPhone.length === 10) && (
                <View style={styles.recipientPreview}>
                  <MaterialCommunityIcons name="check-circle-outline" size={14} color={C.success} />
                  <Text style={styles.recipientPreviewText}>
                    Delivering to <Text style={{ fontWeight: "800", color: C.text }}>{recipientName.trim() || "recipient"}</Text>
                    {recipientPhone.length === 10 ? ` · +91 ${recipientPhone}` : ""}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ─── GST ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.toggleRow, gstinClaim && styles.toggleRowActive]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setGstinClaim((v) => !v);
            }}
          >
            <View style={styles.toggleLeft}>
              <View style={[styles.toggleIconWrap, gstinClaim && styles.toggleIconActive]}>
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={16}
                  color={gstinClaim ? "#fff" : C.textSub}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, gstinClaim && { color: C.primary }]}>
                  Claim GST Input
                </Text>
                <Text style={styles.toggleSub}>Get GST-compliant invoice for business purchases</Text>
              </View>
            </View>
            <MaterialCommunityIcons
              name={gstinClaim ? "check-circle" : "circle-outline"}
              size={20}
              color={gstinClaim ? C.primary : C.border}
            />
          </TouchableOpacity>

          {gstinClaim && (
            <View style={styles.expandedCard}>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>GSTIN</Text>
                <TextInput
                  placeholder="Enter 15-digit GSTIN"
                  placeholderTextColor={C.textLight}
                  value={gstin}
                  onChangeText={setGstin}
                  style={styles.textInput}
                  autoCapitalize="characters"
                  maxLength={15}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Registered Business Name</Text>
                <TextInput
                  placeholder="Name as per GST registration"
                  placeholderTextColor={C.textLight}
                  value={invoiceName}
                  onChangeText={setInvoiceName}
                  style={styles.textInput}
                />
              </View>
            </View>
          )}
        </View>

        {/* ─── Cancellation Policy ─── */}
        <View style={styles.section}>
          <SectionHeader title="Policies" />
          <View style={styles.policyCard}>
            <View style={styles.policyItem}>
              <MaterialCommunityIcons name="cancel" size={16} color={C.textSub} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.policyTitle}>Cancellation Policy</Text>
                <Text style={styles.policyText}>
                  Orders can be cancelled before the store accepts them. After acceptance, cancellation
                  may not be possible and charges may apply.
                </Text>
              </View>
            </View>
            <View style={styles.policyDivider} />
            <View style={styles.policyItem}>
              <MaterialCommunityIcons name="help-circle-outline" size={16} color={C.textSub} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.policyTitle}>FAQs & Support</Text>
                <Text style={styles.policyText}>
                  Learn about refunds, delivery issues, and more.
                </Text>
                <TouchableOpacity
                  style={styles.policyLink}
                  onPress={() => router.push("/settings/support")}
                >
                  <Text style={styles.policyLinkText}>View Support →</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.acceptRow}
            activeOpacity={0.8}
            onPress={() => setAcceptCancellation((v) => !v)}
          >
            <View style={[styles.checkbox, acceptCancellation && styles.checkboxActive]}>
              {acceptCancellation && (
                <MaterialCommunityIcons name="check" size={13} color="#fff" />
              )}
            </View>
            <Text style={styles.acceptText}>
              I've reviewed and accept the cancellation policy & FAQs.
            </Text>
          </TouchableOpacity>
        </View>

        {/* ─── Payment Method ─── */}
        <View style={styles.section}>
          <SectionHeader title="Payment Method" />
          <PaymentOption
            label="UPI / Card / Wallet"
            sublabel="Pay securely via Razorpay"
            icon="credit-card-outline"
            selected={payment === "upi"}
            onPress={() => setPayment("upi")}
          />
          <PaymentOption
            label="Cash on Delivery"
            sublabel="Pay when your order arrives"
            icon="cash-multiple"
            selected={payment === "cod"}
            onPress={() => setPayment("cod")}
          />
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ─── Pay Dock ─── */}
      <View style={styles.payDock}>
        <View style={styles.payDockSummary}>
          <View>
            <Text style={styles.payDockLabel}>Total to pay</Text>
            <Text style={styles.payDockAmount}>₹{finalPayable.toFixed(0)}</Text>
          </View>
          {location && (
            <View style={styles.payDockLocation}>
              <MaterialCommunityIcons name="map-marker" size={12} color={C.primary} />
              <Text style={styles.payDockLocationText} numberOfLines={1}>
                {location.label || "Delivery address"}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.payButton, placing && styles.payButtonPlacing]}
          onPress={placeOrder}
          disabled={placing}
          activeOpacity={0.85}
        >
          {placing ? (
            <>
              <MaterialCommunityIcons name="loading" size={20} color="#fff" />
              <Text style={styles.payButtonText}>Placing your order…</Text>
            </>
          ) : (
            <>
              <Text style={styles.payButtonText}>
                {payment === "cod" ? "Place Order" : "Pay Now"}
              </Text>
              <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>

      {RazorpayUI}

      {/* ─── Success Overlay ─── */}
      {showSuccess && (
        <Animated.View
          style={[
            styles.successOverlay,
            {
              opacity: successAnim,
              transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
            },
          ]}
        >
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={52} color={C.success} />
            </View>
            <Text style={styles.successTitle}>Order Placed!</Text>
            <Text style={styles.successSub}>
              Your order is on its way to the store. We'll notify you once it's accepted.
            </Text>
            <TouchableOpacity
              style={styles.successBtn}
              activeOpacity={0.85}
              onPress={() => {
                setShowSuccess(false);
                setTimeout(() => router.replace("../(tabs)/orders"), 200);
              }}
            >
              <MaterialCommunityIcons name="map-clock-outline" size={18} color="#fff" />
              <Text style={styles.successBtnText}>Track Order</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, optional }: { title: string; optional?: boolean }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {optional && <Text style={styles.optionalTag}>Optional</Text>}
    </View>
  );
}

function BillRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, highlight && { color: C.success }]}>{label}</Text>
      <Text style={[styles.billValue, highlight && { color: C.success, fontWeight: "700" }]}>
        {value < 0 ? `−₹${Math.abs(value).toFixed(0)}` : `₹${value.toFixed(0)}`}
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
        <View style={[styles.paymentIconWrap, selected && styles.paymentIconActive]}>
          <MaterialCommunityIcons
            name={icon}
            size={18}
            color={selected ? "#fff" : disabled ? C.textLight : C.textSub}
          />
        </View>
        <View>
          <Text style={[styles.paymentText, selected && { color: C.primary }, disabled && { color: C.textLight }]}>
            {label}
          </Text>
          {sublabel && <Text style={styles.paymentSublabel}>{sublabel}</Text>}
        </View>
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected && <View style={styles.radioInner} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 200 },

  // Header
  header: {
    flexDirection: "row",
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
    borderWidth: 1,
    borderColor: C.border,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  headerSub: { color: C.textSub, fontSize: 11, marginTop: 2 },

  // Section
  section: { paddingHorizontal: 16, marginTop: 22 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  sectionTitle: { color: C.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3, textTransform: "uppercase" },
  optionalTag: {
    color: C.textLight,
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
  },

  // Location
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    gap: 12,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  locationIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  locationLabel: { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 3 },
  locationAddress: { fontSize: 12, color: C.textSub, lineHeight: 17 },
  locationChevron: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  addAddressBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    borderStyle: "dashed",
  },
  addAddressText: { fontSize: 13, fontWeight: "700", color: C.primary },

  // Items
  itemsCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  itemDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 12 },
  itemImage: { width: 46, height: 46, borderRadius: 9 },
  imagePlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 9,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  itemDetails: { flex: 1 },
  itemName: { color: C.text, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  itemMeta: { color: C.textSub, fontSize: 11, marginTop: 2 },
  itemTotal: { color: C.primary, fontWeight: "800", fontSize: 14 },

  // Quantity Controls
  quantityControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  quantityBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.primaryXLight,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityText: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    minWidth: 20,
    textAlign: "center",
  },

  // Coupon
  couponCard: {
    backgroundColor: C.primaryXLight,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.primaryLight,
  },
  couponLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  couponIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  couponText: { color: C.primary, fontWeight: "700", fontSize: 13 },
  couponSavings: { color: C.success, fontSize: 11, fontWeight: "600", marginTop: 1 },
  removeCouponBtn: { paddingHorizontal: 4 },
  removeCoupon: { color: C.danger, fontSize: 12, fontWeight: "700" },

  // Bill
  billCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  billRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  billLabel: { color: C.textSub, fontSize: 13 },
  billValue: { color: C.text, fontSize: 13, fontWeight: "500" },
  billDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { color: C.text, fontSize: 15, fontWeight: "900" },
  totalValue: { color: C.primary, fontSize: 22, fontWeight: "900" },

  // Inputs
  textInput: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 12,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 14,
    height: 44,
  },
  multilineInput: { minHeight: 74, height: undefined, textAlignVertical: "top" },
  inputGroup: { marginBottom: 12 },
  inputIconRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 7 },
  fieldLabel: { color: C.textSub, fontSize: 12, fontWeight: "700" },

  // Tip
  tipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  tipChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  tipChipActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  tipChipText: { fontSize: 13, color: C.textSub, fontWeight: "600" },
  tipChipTextActive: { color: C.primary },
  tipNote: { color: C.textLight, fontSize: 11, marginTop: 4 },

  // Ordering for someone else
  someoneElseToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 12,
  },
  someoneElseToggleActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  someoneElseIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  someoneElseIconActive: { backgroundColor: C.primary },
  someoneElseLabel: { color: C.text, fontSize: 14, fontWeight: "700" },
  someoneElseLabelActive: { color: C.primary },
  someoneElseSublabel: { color: C.textLight, fontSize: 11, marginTop: 2 },
  someoneElseSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.border,
    padding: 2,
    justifyContent: "center",
  },
  someoneElseSwitchActive: { backgroundColor: C.primary },
  someoneElseSwitchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  someoneElseSwitchKnobActive: { alignSelf: "flex-end" },

  recipientBox: {
    marginTop: 10,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    gap: 2,
  },
  recipientBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  recipientBoxTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  recipientBoxNote: {
    color: C.textLight,
    fontSize: 10,
    fontWeight: "500",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  recipientFieldRow: { flexDirection: "row", gap: 10 },
  phoneInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  phonePrefix: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  phonePrefixText: { fontSize: 13, fontWeight: "600", color: C.text },
  phoneInputField: { flex: 1, marginBottom: 0 },
  textInputFilled: { borderColor: C.primary },
  fieldHint: { color: C.textLight, fontSize: 11, marginTop: 4, marginLeft: 2 },
  recipientPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#f0fff4",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  recipientPreviewText: { color: C.textSub, fontSize: 12, flex: 1 },

  // Toggle rows (GST)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 13,
    padding: 13,
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 10,
  },
  toggleRowActive: { borderColor: C.primaryLight, backgroundColor: C.primaryXLight },
  toggleLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  toggleIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleIconActive: { backgroundColor: C.primary },
  toggleTitle: { color: C.text, fontSize: 13, fontWeight: "700" },
  toggleSub: { color: C.textLight, fontSize: 11, marginTop: 2, lineHeight: 15 },
  expandedCard: {
    marginTop: 8,
    backgroundColor: C.card,
    borderRadius: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },

  // Policy
  policyCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  policyItem: { flexDirection: "row", gap: 10 },
  policyDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  policyTitle: { color: C.text, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  policyText: { color: C.textSub, fontSize: 12, lineHeight: 17 },
  policyLink: { marginTop: 8 },
  policyLinkText: { color: C.primary, fontSize: 12, fontWeight: "700" },

  acceptRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxActive: { backgroundColor: C.primary, borderColor: C.primary },
  acceptText: { color: C.textSub, fontSize: 12, flex: 1, lineHeight: 18 },

  // Payment
  paymentRow: {
    backgroundColor: C.card,
    padding: 13,
    borderRadius: 13,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
  },
  paymentActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  paymentDisabled: { opacity: 0.45 },
  paymentLeft: { flexDirection: "row", alignItems: "center", gap: 11 },
  paymentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentIconActive: { backgroundColor: C.primary },
  paymentText: { color: C.text, fontSize: 14, fontWeight: "700" },
  paymentSublabel: { color: C.textLight, fontSize: 11, marginTop: 2 },
  radioOuter: {
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: { borderColor: C.primary },
  radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.primary },

  // Pay dock
  payDock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  payDockSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  payDockLabel: { color: C.textSub, fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  payDockAmount: { color: C.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  payDockLocation: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "55%" },
  payDockLocationText: { color: C.textSub, fontSize: 11, flex: 1 },
  payButton: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  payButtonPlacing: { opacity: 0.65 },
  payButtonText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // Recommended
  recoScroll: { marginHorizontal: -4 },
  recoCard: {
    width: 120,
    backgroundColor: C.card,
    borderRadius: 13,
    padding: 9,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  recoImage: { width: "100%", height: 72, borderRadius: 9, marginBottom: 6 },
  recoPlaceholder: {
    width: "100%",
    height: 72,
    borderRadius: 9,
    backgroundColor: C.bgSoft,
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  recoName: { color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 15, minHeight: 30 },
  recoPrice: { color: C.primary, fontSize: 12, fontWeight: "800", marginTop: 2 },
  recoUnit: { color: C.textSub, fontSize: 10, fontWeight: "400" },
  recoAddBtn: {
    marginTop: 7,
    backgroundColor: C.primary,
    borderRadius: 999,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  recoAddText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  // Success
  successOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
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
    gap: 10,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.successLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  successSub: { color: C.textSub, fontSize: 13, textAlign: "center", lineHeight: 20 },
  successBtn: {
    marginTop: 10,
    backgroundColor: C.primary,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  successBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});